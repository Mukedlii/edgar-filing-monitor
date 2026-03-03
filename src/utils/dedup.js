/**
 * Delta deduplication for EDGAR filings.
 * Stores seen accession numbers in KV Store.
 */

import { log } from 'apify';

const KV_KEY = 'SEEN_FILINGS';

export async function deduplicateFilings(filings, kvStore, deltaMode) {
    if (!deltaMode) return { newFilings: filings, seenCount: 0 };

    let seen = new Set();
    try {
        const stored = await kvStore.getValue(KV_KEY);
        if (Array.isArray(stored)) seen = new Set(stored);
    } catch (err) {
        log.warning('Could not load seen filings', { error: err.message });
    }

    const seenCount  = seen.size;
    const newFilings = filings.filter(f => !seen.has(f.id));

    // Update seen set
    for (const f of newFilings) seen.add(f.id);

    // Cap at 50k to avoid KV size limits
    const capped = [...seen].slice(-50000);
    try {
        await kvStore.setValue(KV_KEY, capped);
    } catch (err) {
        log.warning('Could not save seen filings', { error: err.message });
    }

    return { newFilings, seenCount };
}
