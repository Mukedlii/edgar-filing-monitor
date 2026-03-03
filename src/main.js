/**
 * SEC EDGAR Filing Monitor
 * Apify Actor — main.js
 *
 * Flow:
 *   1. Resolve tickers → CIK numbers via EDGAR API
 *   2. Fetch 8-K, Form 4, 13F filings per ticker
 *   3. Enrich Form 4 with insider transaction details
 *   4. Delta dedup via KV Store
 *   5. Save to Dataset
 *   6. Send 1 Telegram summary message
 *   7. POST webhook
 */

import { Actor, log } from 'apify';
import { scrapeEdgar }          from './scrapers/edgar.js';
import { deduplicateFilings }   from './utils/dedup.js';
import { sendTelegramAlerts }   from './utils/telegram.js';
import fetch from 'node-fetch';

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    tickers                  = [],
    form_types               = ['8-K', '4', '13F-HR'],
    delta_mode               = true,
    days_back                = 7,
    max_filings_per_ticker   = 10,
    insider_transaction_types = [],
    min_insider_value_usd    = 0,
    telegram_bot_token       = null,
    telegram_chat_id         = null,
    webhook_url              = null,
} = input;

// ─── Validation ───────────────────────────────────────────────────────────────
if (telegram_bot_token && !telegram_chat_id) {
    log.warning('telegram_bot_token is set but telegram_chat_id is missing — Telegram alerts will NOT be sent.');
}
if (!telegram_bot_token && telegram_chat_id) {
    log.warning('telegram_chat_id is set but telegram_bot_token is missing — Telegram alerts will NOT be sent.');
}

log.info('SEC EDGAR Filing Monitor starting', {
    tickers:                 tickers.length ? tickers : 'ALL (latest)',
    form_types,
    delta_mode,
    days_back,
    max_filings_per_ticker,
    insider_transaction_types: insider_transaction_types.length ? insider_transaction_types : 'ALL',
    min_insider_value_usd,
    telegram_configured:     !!(telegram_bot_token && telegram_chat_id),
});

const dataset = await Actor.openDataset();
const kvStore = await Actor.openKeyValueStore();

// ─── 1. Scrape EDGAR ──────────────────────────────────────────────────────────
let filings = [];
try {
    filings = await scrapeEdgar({
        tickers,
        formTypes:               form_types,
        daysBack:                days_back,
        maxFilingsPerTicker:     max_filings_per_ticker,
        insiderTransactionTypes: insider_transaction_types,
        minInsiderValueUsd:      min_insider_value_usd,
    });
    log.info(`Scraped ${filings.length} total filings`);
} catch (err) {
    log.error('Scraping failed', { error: err.message });
    await Actor.exit(1);
}

if (filings.length === 0) {
    log.info('No filings found for the given criteria and time range.');
    await Actor.exit();
}

// ─── 2. Delta deduplication ───────────────────────────────────────────────────
const { newFilings, seenCount } = await deduplicateFilings(filings, kvStore, delta_mode);
log.info(`Delta: ${filings.length} total → ${newFilings.length} new (${seenCount} previously seen)`);

if (newFilings.length === 0) {
    log.info('No new filings since last run.');
    await Actor.exit();
}

// ─── 3. Save to dataset ───────────────────────────────────────────────────────
for (const filing of newFilings) {
    await dataset.pushData(filing);
}
log.info(`Saved ${newFilings.length} filings to dataset`);

// ─── 4. Telegram — 1 summary message per run ─────────────────────────────────
if (telegram_bot_token && telegram_chat_id) {
    const runUrl = `https://console.apify.com/storage/datasets/${dataset.id}`;
    await sendTelegramAlerts({
        botToken: telegram_bot_token,
        chatId:   telegram_chat_id,
        filings:  newFilings,
        runUrl,
    });
} else {
    log.info('Telegram not configured — skipping alerts.');
}

// ─── 5. Webhook ───────────────────────────────────────────────────────────────
if (webhook_url) {
    try {
        await fetch(webhook_url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timestamp:      new Date().toISOString(),
                total_scraped:  filings.length,
                new_filings:    newFilings.length,
                filings:        newFilings,
            }),
            timeout: 15000,
        });
        log.info('Webhook delivered');
    } catch (err) {
        log.warning('Webhook failed', { error: err.message });
    }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const byType = newFilings.reduce((acc, f) => {
    acc[f.form_type] = (acc[f.form_type] ?? 0) + 1;
    return acc;
}, {});

log.info(`✅ Done.
  Total scraped  : ${filings.length}
  New filings    : ${newFilings.length}
  By type        : ${JSON.stringify(byType)}
  Telegram sent  : ${!!(telegram_bot_token && telegram_chat_id)}
`);

await Actor.exit();
