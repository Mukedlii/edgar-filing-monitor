# 📊 SEC EDGAR Filing Monitor — 8-K, Insider Trading & 13F

**Track SEC filings by ticker in real-time. Get Telegram alerts when executives buy or sell stock, when material events hit, or when institutional investors update their portfolios.**

> No proxy needed. Uses the official SEC EDGAR REST API. Free plan compatible.

---

## 🔍 What it monitors

| Form | What it means | Why it matters |
|---|---|---|
| **8-K** | Material company events | Earnings, M&A, CEO changes, bankruptcy |
| **Form 4** | Insider trades | Executives buying/selling their own stock |
| **13F** | Institutional holdings | What hedge funds & funds hold each quarter |

---

## ✅ Key features

- **Ticker-based monitoring** — watch any US-listed stock (AAPL, TSLA, NVDA, etc.)
- **Delta mode** — KV Store tracks seen filings; only new ones processed each run
- **Form 4 enrichment** — extracts insider name, title, transaction type, shares, USD value
- **8-K item classification** — maps item numbers to human-readable event descriptions
- **Telegram alerts** — 1 summary message per run, never spammy
- **Webhook support** — push to Zapier, Make, n8n, or any custom endpoint
- **No proxy needed** — uses official `data.sec.gov` REST API (free, stable)

---

## 📦 Output fields

### All filings
```json
{
  "id": "abc123",
  "ticker": "AAPL",
  "company_name": "Apple Inc.",
  "form_type": "8-K",
  "filing_date": "2025-04-15",
  "accession_number": "0000320193-25-000041",
  "document_url": "https://www.sec.gov/Archives/...",
  "alert_type": "8k_event",
  "event_summary": "Results of operations (earnings); Departure/appointment of executives",
  "scraped_at": "2025-04-15T08:00:00.000Z"
}
```

### Form 4 (insider trade) additional fields
```json
{
  "insider_name": "Tim Cook",
  "insider_title": "Chief Executive Officer",
  "is_director": false,
  "is_officer": true,
  "transactions": [
    {
      "transaction_code": "S",
      "transaction_code_label": "Open market sale",
      "shares": 50000,
      "price_per_share": 189.50,
      "value_usd": 9475000,
      "shares_owned_after": 3200000,
      "ownership_type": "direct"
    }
  ],
  "total_value_usd": 9475000
}
```

---

## 🚀 Example configurations

### Watch specific tickers — all form types
```json
{
  "tickers": ["AAPL", "NVDA", "MSFT", "TSLA"],
  "form_types": ["8-K", "4", "13F-HR"],
  "delta_mode": true,
  "days_back": 7
}
```

### Insider buying only — large transactions
```json
{
  "tickers": ["AAPL", "GOOGL", "META"],
  "form_types": ["4"],
  "insider_transaction_types": ["P"],
  "min_insider_value_usd": 100000,
  "telegram_bot_token": "@TELEGRAM_TOKEN",
  "telegram_chat_id": "YOUR_CHAT_ID"
}
```

### 8-K events only — earnings and M&A signals
```json
{
  "tickers": ["TSLA", "AMZN", "NFLX"],
  "form_types": ["8-K"],
  "delta_mode": true,
  "telegram_bot_token": "@TELEGRAM_TOKEN",
  "telegram_chat_id": "YOUR_CHAT_ID"
}
```

### Full market scan — latest 13F filings
```json
{
  "tickers": [],
  "form_types": ["13F-HR"],
  "days_back": 1,
  "max_filings_per_ticker": 50
}
```

---

## 📱 Telegram setup (4 steps)

**Step 1 — Create your bot**
Open Telegram → search **@BotFather** → send `/newbot` → follow prompts → copy your token.

**Step 2 — Get your Chat ID**
Search **@userinfobot** → send `/start` → copy your numeric ID. For groups: add the bot to the group first.

**Step 3 — Store token securely**
Apify Console → **Settings → Secrets** → add secret `TELEGRAM_TOKEN` → paste your bot token.

**Step 4 — Add to input**
```json
{
  "telegram_bot_token": "@TELEGRAM_TOKEN",
  "telegram_chat_id": "5080373675"
}
```

**Example alert:**
```
📊 SEC EDGAR Filing Alert
Apr 15, 2025 — 3 new filing(s)

👤 Insider Trades (2):
• $AAPL | Tim Cook (CEO)
  Open market sale $9,475,000 — Filing
• $NVDA | Jensen Huang (CEO)
  Open market purchase $2,100,000 — Filing

📋 8-K Material Events (1):
• $TSLA | 2025-04-15
  Results of operations (earnings) — Filing

View full dataset
```

---

## 📅 Recommended schedule

| Use case | Frequency |
|---|---|
| Insider trade alerts | Daily (after market close) |
| 8-K event monitoring | Every 4–6 hours |
| 13F portfolio tracking | Weekly (filings due 45 days after quarter end) |

---

## ⚡ Pricing

Pay-per-result. Typical daily run: 5–30 new filings.

| Volume | Est. cost |
|---|---|
| 50 filings/day | ~$0.03 |
| 500 filings/day | ~$0.25 |

---

## 🛡️ Legal & rate limits

Uses the official [SEC EDGAR REST API](https://www.sec.gov/developer). The SEC requires a descriptive User-Agent header (included). Fair-use rate limit: 10 requests/second — this Actor stays well under that limit.

---

## 🐛 Issues & roadmap

- [ ] 10-K / 10-Q annual and quarterly reports
- [ ] S-1 IPO filings monitor
- [ ] DEF 14A proxy statement alerts
- [ ] CIK-based monitoring (alternative to ticker)
