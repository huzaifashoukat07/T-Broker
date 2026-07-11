# NovaTrade 📈

A **Quotex-style online trading platform** — binary options trading with live simulated markets, real-time candlestick charts, demo & live accounts, and instant trade settlement.

> ⚠️ **Simulation only.** All markets are simulated and all money is virtual. This project is for education, portfolio and demo purposes — it does not handle real funds and is not financial advice.

![Platform](https://img.shields.io/badge/stack-Node.js%20%2B%20Vanilla%20JS-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

**Trading**
- 📊 Real-time candlestick chart (custom canvas engine — pan, zoom, live ticks at 2 ticks/sec)
- ⏱ 5 chart timeframes: 5s, 15s, 30s, 1m, 5m
- 🔼🔽 Up/Down binary trades with expiries from 5 seconds to 10 minutes
- 💰 Per-asset payouts from 75% up to **90%**
- 📍 On-chart trade markers: entry price line, expiry countdown line, stake badge
- 🧾 Open-trades panel with live countdowns + full trade history per account

**Markets** — 16 assets across 4 groups with independent live price feeds:
- Currencies: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, EUR/GBP
- Crypto: Bitcoin, Ethereum, Solana
- Commodities: Gold, Silver, Brent Oil
- Stocks: Apple, Tesla, Amazon, Microsoft

**Accounts & wallet**
- 🔐 Email/password auth (scrypt-hashed passwords, HMAC-signed session tokens)
- 🎓 Free **$10,000 demo account** — refillable in one click
- 💳 Live account with simulated deposits & withdrawals (card / crypto / bank)
- 🧾 Transaction history
- 🏆 Daily top-traders leaderboard

**Engine**
- 🔴 **Real live crypto prices from Binance** — Bitcoin, Ethereum and Solana stream real market data (public endpoints, no API key needed); real candle history is loaded on startup and live assets show a pulsing LIVE badge
- Automatic fallback: if Binance is unreachable (offline, blocked network), those assets seamlessly switch to the built-in simulator and recover when the feed returns
- Simulated price feeds for the remaining assets with momentum, news spikes and mean reversion — charts trend and consolidate like real markets
- WebSocket live feed (ticks + trade settlement pushes)
- Server-side candle aggregation and trade settlement — no client-side price trust
- JSON-file persistence; open trades survive server restarts

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3000**, sign up (any email works — it's all local), and start trading on the demo account.

### Live market data

Crypto assets (BTC, ETH, SOL) automatically connect to Binance's public market-data endpoints — no account or API key required. If your network can't reach `data-api.binance.vision`, you can point the feed elsewhere:

```bash
BINANCE_REST=https://api.binance.com BINANCE_WS=wss://stream.binance.com:9443 npm start
```

If Binance can't be reached at all, those assets fall back to simulated prices automatically (and keep retrying in the background).

## Tech stack

| Layer      | Tech |
|------------|------|
| Backend    | Node.js, Express, `ws` (WebSockets) |
| Frontend   | Vanilla JS, custom canvas chart — zero frontend dependencies |
| Auth       | scrypt password hashing + HMAC-signed tokens (Node `crypto`) |
| Storage    | JSON file (`data/db.json`) |

## Project structure

```
server/
  index.js    # REST API, WebSocket feed, trade settlement
  market.js   # price engine: random-walk feeds + candle aggregation
  store.js    # users, auth, balances, persistence
public/
  index.html  # auth screen, trading UI, modals
  css/style.css
  js/chart.js # canvas candlestick chart engine
  js/app.js   # application logic
```

## API overview

| Method | Endpoint            | Description |
|--------|---------------------|-------------|
| POST   | `/api/register`     | Create account (gets $10k demo balance) |
| POST   | `/api/login`        | Log in, returns bearer token |
| GET    | `/api/assets`       | Assets, payouts, timeframes, durations |
| GET    | `/api/candles`      | OHLC history (`asset`, `tf`, `limit`) |
| POST   | `/api/trade`        | Place a trade (`asset`, `direction`, `amount`, `duration`, `account`) |
| GET    | `/api/trades`       | Trade history |
| POST   | `/api/deposit`      | Simulated deposit to live account |
| POST   | `/api/withdraw`     | Simulated withdrawal |
| POST   | `/api/reset-demo`   | Refill demo balance to $10,000 |
| GET    | `/api/leaderboard`  | Top traders today |
| WS     | `/ws?token=…`       | Live ticks + trade settlement events |

## License

MIT
