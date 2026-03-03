/**
 * Scraper: SEC EDGAR Filing Monitor
 *
 * Uses the official EDGAR REST API — no proxy, no Playwright needed.
 *
 * Key endpoints:
 *   Ticker → CIK:   https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK={ticker}&type=&dateb=&owner=include&count=1&search_text=&output=atom
 *   CIK lookup:     https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&startdt=...&enddt=...&forms=8-K
 *   Company facts:  https://data.sec.gov/submissions/CIK{cik10}.json
 *   Full-text search: https://efts.sec.gov/LATEST/search-index?q=...&forms=8-K,4,13F-HR
 *
 * Rate limit: max 10 requests/second per SEC fair-use policy.
 * We stay well under with 200ms delays.
 */

import fetch from 'node-fetch';
import { log } from 'apify';

const EDGAR_BASE     = 'https://data.sec.gov';
const EDGAR_SEARCH   = 'https://efts.sec.gov/LATEST/search-index';
const TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';

// Cache ticker→CIK map for the run
let tickerCikCache = null;

const HEADERS = {
    'User-Agent': 'ApifyBot/1.0 contact@apify.com',  // SEC requires identifying User-Agent
    'Accept':     'application/json',
    'Accept-Encoding': 'gzip, deflate',
};

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function scrapeEdgar({
    tickers = [],
    formTypes = ['8-K', '4', '13F-HR'],
    daysBack = 7,
    maxFilingsPerTicker = 10,
    insiderTransactionTypes = [],
    minInsiderValueUsd = 0,
}) {
    const results = [];

    // Build date range
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr   = endDate.toISOString().split('T')[0];

    log.info(`EDGAR: fetching ${formTypes.join(', ')} from ${startStr} to ${endStr}`);

    if (tickers.length > 0) {
        // Mode A: fetch by ticker
        const cikMap = await loadTickerCikMap();

        for (const ticker of tickers) {
            const upperTicker = ticker.toUpperCase().trim();
            const cik = cikMap[upperTicker];

            if (!cik) {
                log.warning(`EDGAR: CIK not found for ticker ${upperTicker} — skipping`);
                continue;
            }

            log.info(`EDGAR: fetching filings for ${upperTicker} (CIK: ${cik})`);

            for (const formType of formTypes) {
                try {
                    const filings = await fetchFilingsByCik(cik, upperTicker, formType, startStr, maxFilingsPerTicker);
                    log.info(`  ${upperTicker} ${formType}: ${filings.length} filings`);

                    for (const filing of filings) {
                        const enriched = await enrichFiling(filing, formType, insiderTransactionTypes, minInsiderValueUsd);
                        if (enriched) results.push(enriched);
                        await sleep(150); // stay under 10 req/s
                    }
                } catch (err) {
                    log.warning(`EDGAR: failed fetching ${upperTicker} ${formType}`, { error: err.message });
                }
                await sleep(200);
            }
        }
    } else {
        // Mode B: fetch latest filings across all companies
        for (const formType of formTypes) {
            try {
                const filings = await fetchLatestFilings(formType, startStr, endStr, maxFilingsPerTicker * 5);
                log.info(`EDGAR: ${formType} latest: ${filings.length} filings`);
                for (const filing of filings) {
                    const enriched = await enrichFiling(filing, formType, insiderTransactionTypes, minInsiderValueUsd);
                    if (enriched) results.push(enriched);
                    await sleep(150);
                }
            } catch (err) {
                log.warning(`EDGAR: failed fetching latest ${formType}`, { error: err.message });
            }
        }
    }

    log.info(`EDGAR: total ${results.length} filings collected`);
    return results;
}

// ─── CIK lookup ───────────────────────────────────────────────────────────────

async function loadTickerCikMap() {
    if (tickerCikCache) return tickerCikCache;

    try {
        const res = await fetchJSON(TICKER_MAP_URL);
        // Format: { "0": { cik_str: "320193", ticker: "AAPL", title: "Apple Inc." }, ... }
        const map = {};
        for (const entry of Object.values(res)) {
            map[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, '0');
        }
        tickerCikCache = map;
        log.info(`EDGAR: loaded CIK map (${Object.keys(map).length} tickers)`);
        return map;
    } catch (err) {
        log.error('EDGAR: failed to load ticker→CIK map', { error: err.message });
        return {};
    }
}

// ─── Fetch filings by CIK (from company submissions) ─────────────────────────

async function fetchFilingsByCik(cik10, ticker, formType, startDate, maxCount) {
    const url = `${EDGAR_BASE}/submissions/CIK${cik10}.json`;
    const data = await fetchJSON(url);
    if (!data) return [];

    const recent = data.filings?.recent;
    if (!recent) return [];

    const { form, filingDate, accessionNumber, primaryDocument, items } = recent;
    const filings = [];

    for (let i = 0; i < form.length; i++) {
        if (filings.length >= maxCount) break;

        const thisForm = form[i];
        const normalizedForm = normalizeFormType(thisForm);
        if (!matchesFormType(normalizedForm, formType)) continue;
        if (filingDate[i] < startDate) continue;

        const accession = accessionNumber[i].replace(/-/g, '');
        const accessionDashed = accessionNumber[i];
        const docUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik10, 10)}/${accession}/${primaryDocument[i]}`;
        const indexUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&type=${encodeURIComponent(thisForm)}&dateb=&owner=include&count=10`;

        filings.push({
            id:               generateId(ticker, accessionDashed),
            ticker,
            cik:              cik10,
            company_name:     data.name ?? null,
            form_type:        thisForm,
            filing_date:      filingDate[i],
            accession_number: accessionDashed,
            document_url:     docUrl,
            index_url:        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&type=${encodeURIComponent(thisForm)}&dateb=&owner=include&count=10`,
            items:            items?.[i] ?? null,  // 8-K item numbers e.g. "2.02,5.02"
            scraped_at:       new Date().toISOString(),
        });
    }

    return filings;
}

// ─── Fetch latest filings (no ticker filter) via EDGAR full-text search ───────

async function fetchLatestFilings(formType, startDate, endDate, maxCount) {
    const url = `${EDGAR_SEARCH}?forms=${encodeURIComponent(formType)}&dateRange=custom&startdt=${startDate}&enddt=${endDate}&_source=file_date,period_of_report,entity_name,file_num,form_type,period_of_report,biz_location,inc_states&from=0&size=${Math.min(maxCount, 50)}`;

    const data = await fetchJSON(url);
    if (!data?.hits?.hits) return [];

    return data.hits.hits.map(hit => {
        const s = hit._source ?? {};
        return {
            id:               generateId(s.entity_name ?? 'unknown', hit._id),
            ticker:           null,
            cik:              s.file_num ?? null,
            company_name:     s.entity_name ?? null,
            form_type:        s.form_type ?? formType,
            filing_date:      s.file_date ?? null,
            period_of_report: s.period_of_report ?? null,
            accession_number: hit._id ?? null,
            document_url:     hit._id ? `https://www.sec.gov/Archives/edgar/${hit._id.replace(/-/g,'/')}` : null,
            index_url:        null,
            items:            null,
            scraped_at:       new Date().toISOString(),
        };
    });
}

// ─── Enrich filings with form-specific data ───────────────────────────────────

async function enrichFiling(filing, formType, insiderTransactionTypes, minInsiderValueUsd) {
    const normalized = normalizeFormType(filing.form_type);

    // Form 4: parse insider transaction details
    if (normalized === '4') {
        const form4Data = await parseForm4(filing);
        if (!form4Data) return null;

        // Filter by transaction type
        if (insiderTransactionTypes.length > 0) {
            const hasMatch = form4Data.transactions.some(t =>
                insiderTransactionTypes.includes(t.transaction_code)
            );
            if (!hasMatch) return null;
        }

        // Filter by minimum value
        if (minInsiderValueUsd > 0) {
            const maxValue = Math.max(...form4Data.transactions.map(t => t.value_usd ?? 0));
            if (maxValue < minInsiderValueUsd) return null;
        }

        return { ...filing, ...form4Data, alert_type: 'insider_trade' };
    }

    // 8-K: parse item numbers for context
    if (normalized === '8-K') {
        return {
            ...filing,
            alert_type:    '8k_event',
            event_summary: describe8KItems(filing.items),
        };
    }

    // 13F: return as-is with label
    if (normalized === '13F') {
        return { ...filing, alert_type: '13f_holdings' };
    }

    return { ...filing, alert_type: 'filing' };
}

// ─── Form 4 XML parser ────────────────────────────────────────────────────────

async function parseForm4(filing) {
    if (!filing.document_url) return { transactions: [] };

    try {
        // Form 4 primary document is typically an XML file
        const xmlUrl = filing.document_url.endsWith('.xml')
            ? filing.document_url
            : filing.document_url.replace(/\.[^.]+$/, '.xml');

        const res = await fetch(xmlUrl, { headers: HEADERS, timeout: 15000 });
        if (!res.ok) return { transactions: [] };

        const xml = await res.text();

        // Parse key fields with regex (avoids xml2js dependency complexity)
        const reporterName  = extractXML(xml, 'rptOwnerName') ?? extractXML(xml, 'name');
        const reporterTitle = extractXML(xml, 'officerTitle');
        const isDirector    = extractXML(xml, 'isDirector') === '1';
        const isOfficer     = extractXML(xml, 'isOfficer') === '1';

        // Parse non-derivative transactions
        const transactions = [];
        const txBlocks = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)];
        for (const block of txBlocks) {
            const t = block[1];
            const code     = extractXML(t, 'transactionCode');
            const shares   = parseFloat(extractXML(t, 'transactionShares') ?? '0');
            const price    = parseFloat(extractXML(t, 'transactionPricePerShare') ?? '0');
            const sharesOwned = parseFloat(extractXML(t, 'sharesOwnedFollowingTransaction') ?? '0');
            const value_usd = shares * price;

            transactions.push({
                transaction_code:     code,
                transaction_code_label: describeTransactionCode(code),
                shares,
                price_per_share:      price || null,
                value_usd:            value_usd || null,
                shares_owned_after:   sharesOwned || null,
                ownership_type:       extractXML(t, 'ownershipNature') === 'I' ? 'indirect' : 'direct',
            });
        }

        return {
            insider_name:   reporterName,
            insider_title:  reporterTitle,
            is_director:    isDirector,
            is_officer:     isOfficer,
            transactions,
            total_value_usd: transactions.reduce((sum, t) => sum + (t.value_usd ?? 0), 0),
        };
    } catch (err) {
        log.debug(`Form 4 parse failed for ${filing.accession_number}: ${err.message}`);
        return { transactions: [] };
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFormType(form) {
    if (!form) return '';
    const f = form.toUpperCase();
    if (f.startsWith('13F')) return '13F';
    if (f === '4' || f === 'FORM 4') return '4';
    return f;
}

function matchesFormType(normalized, target) {
    const t = target.toUpperCase();
    if (t === '4') return normalized === '4';
    if (t === '13F-HR' || t === '13F') return normalized === '13F';
    return normalized === t;
}

function describe8KItems(items) {
    if (!items) return null;
    const map = {
        '1.01': 'Entry into a material agreement',
        '1.02': 'Termination of a material agreement',
        '1.03': 'Bankruptcy or receivership',
        '2.01': 'Acquisition or disposition of assets',
        '2.02': 'Results of operations (earnings)',
        '2.03': 'Creation of a direct financial obligation',
        '2.04': 'Triggering events for financial obligations',
        '2.05': 'Costs associated with exit activities',
        '2.06': 'Material impairments',
        '3.01': 'Delisting notice',
        '3.02': 'Unregistered sales of equity securities',
        '4.01': 'Changes in registrant\'s certifying accountant',
        '4.02': 'Non-reliance on financial statements',
        '5.01': 'Changes in control',
        '5.02': 'Departure/appointment of executives or directors',
        '5.03': 'Amendments to articles or bylaws',
        '5.07': 'Submission of matters to vote of security holders',
        '5.08': 'Shareholder nominations',
        '7.01': 'Regulation FD disclosure',
        '8.01': 'Other events',
        '9.01': 'Financial statements and exhibits',
    };
    return items.split(',').map(i => map[i.trim()] ?? `Item ${i.trim()}`).join('; ');
}

function describeTransactionCode(code) {
    const map = {
        'P': 'Open market purchase',
        'S': 'Open market sale',
        'A': 'Award / grant',
        'D': 'Disposition to issuer',
        'G': 'Gift',
        'F': 'Tax withholding',
        'M': 'Exercise of derivative',
        'C': 'Conversion of derivative',
        'E': 'Expiration of short derivative',
        'H': 'Expiration of long derivative',
        'I': 'Discretionary transaction',
        'J': 'Other acquisition or disposition',
        'K': 'Transaction in equity swap',
        'L': 'Small acquisition',
        'O': 'Exercise of out-of-money derivative',
        'R': 'Deposit into rule 10b5-1 plan',
        'T': 'Disposed pursuant to tender offer',
        'U': 'Disposition to a trust',
        'W': 'Acquisition by will or inheritance',
        'X': 'Exercise of in-the-money derivative',
        'Z': 'Deposit into or withdrawal from voting trust',
    };
    return map[code] ?? code;
}

function extractXML(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

async function fetchJSON(url) {
    const res = await fetch(url, { headers: HEADERS, timeout: 20000 });
    if (!res.ok) {
        log.debug(`HTTP ${res.status} for ${url}`);
        return null;
    }
    return res.json();
}

function generateId(ticker, accession) {
    const raw = `edgar-${ticker}-${accession}`;
    return Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
