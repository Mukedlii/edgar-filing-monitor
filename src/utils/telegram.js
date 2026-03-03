/**
 * Telegram alerts for EDGAR Filing Monitor.
 * Always sends exactly 1 summary message per run.
 */

import fetch from 'node-fetch';
import { log } from 'apify';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function sendTelegramAlerts({ botToken, chatId, filings, runUrl }) {
    if (!botToken || !chatId || filings.length === 0) return;

    const byType = {
        '8k_event':     filings.filter(f => f.alert_type === '8k_event'),
        'insider_trade': filings.filter(f => f.alert_type === 'insider_trade'),
        '13f_holdings':  filings.filter(f => f.alert_type === '13f_holdings'),
        'filing':        filings.filter(f => f.alert_type === 'filing'),
    };

    const sections = [];

    if (byType['8k_event'].length > 0) {
        sections.push(
            `📋 *8-K Material Events (${byType['8k_event'].length}):*\n` +
            byType['8k_event'].slice(0, 10).map(format8K).join('\n')
        );
    }

    if (byType['insider_trade'].length > 0) {
        sections.push(
            `👤 *Insider Trades (${byType['insider_trade'].length}):*\n` +
            byType['insider_trade'].slice(0, 10).map(formatInsider).join('\n')
        );
    }

    if (byType['13f_holdings'].length > 0) {
        sections.push(
            `🏦 *13F Holdings (${byType['13f_holdings'].length}):*\n` +
            byType['13f_holdings'].slice(0, 5).map(format13F).join('\n')
        );
    }

    if (sections.length === 0) return;

    const date    = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const header  = `📊 *SEC EDGAR Filing Alert*\n${date} — ${filings.length} new filing(s)\n\n`;
    const footer  = runUrl ? `\n\n[View full dataset](${runUrl})` : '';
    const body    = sections.join('\n\n');

    let message = header + body + footer;

    // Hard cap at 3800 chars — always 1 message per run
    if (message.length > 3800) {
        message = message.substring(0, 3750) + `\n_...truncated. See full dataset._${footer}`;
    }

    await sendMessage(botToken, chatId, message);
    log.info(`Telegram: 1 summary message sent (${filings.length} filings)`);
}

function format8K(f) {
    const ticker  = f.ticker ? `$${f.ticker}` : f.company_name ?? 'Unknown';
    const summary = f.event_summary ? `\n  _${escMD(f.event_summary.substring(0, 80))}_` : '';
    const link    = f.document_url ? ` — [Filing](${f.document_url})` : '';
    return `• *${escMD(ticker)}* | ${f.filing_date}${summary}${link}`;
}

function formatInsider(f) {
    const ticker  = f.ticker ? `$${f.ticker}` : f.company_name ?? 'Unknown';
    const name    = f.insider_name ? escMD(f.insider_name) : 'Unknown insider';
    const title   = f.insider_title ? ` (${escMD(f.insider_title)})` : '';
    const txs     = (f.transactions ?? []).slice(0, 2).map(t => {
        const val = t.value_usd ? ` $${Math.round(t.value_usd).toLocaleString()}` : '';
        return `${t.transaction_code_label ?? t.transaction_code}${val}`;
    }).join(', ');
    const link    = f.document_url ? ` — [Filing](${f.document_url})` : '';
    return `• *${escMD(ticker)}* | ${name}${title}\n  ${txs}${link}`;
}

function format13F(f) {
    const name = escMD(f.company_name ?? f.ticker ?? 'Unknown');
    const link = f.document_url ? ` — [Filing](${f.document_url})` : '';
    return `• *${name}* | ${f.filing_date} | Period: ${f.period_of_report ?? 'N/A'}${link}`;
}

async function sendMessage(botToken, chatId, text) {
    try {
        const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id:                  chatId,
                text,
                parse_mode:               'Markdown',
                disable_web_page_preview: true,
            }),
            timeout: 10000,
        });
        if (!res.ok) {
            const err = await res.text();
            log.warning('Telegram error', { status: res.status, body: err.substring(0, 200) });
        }
    } catch (err) {
        log.warning('Telegram request failed', { error: err.message });
    }
}

function escMD(text) {
    return String(text ?? '').replace(/[_*[\]()~`>#+=|{}.!-]/g, c => `\\${c}`);
}
