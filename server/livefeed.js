// Live market data from Binance public endpoints (no API key required).
// Crypto assets get real prices: historical klines via REST, then a live
// trade stream over WebSocket. If Binance is unreachable (offline, blocked
// network, region), the affected assets automatically fall back to the
// built-in simulator so the platform keeps working.

const https = require('https');
const WebSocket = require('ws');

let HttpsProxyAgent = null;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch { /* optional */ }

// data-api.binance.vision / data-stream.binance.vision are Binance's official
// public market-data-only endpoints (fewer geo restrictions than api.binance.com).
const REST_BASE = process.env.BINANCE_REST || 'https://data-api.binance.vision';
const WS_BASE = process.env.BINANCE_WS || 'wss://data-stream.binance.vision';
const STALE_MS = 15000; // no trade for this long -> treat feed as stale
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
const agent = proxyUrl && HttpsProxyAgent ? new HttpsProxyAgent(proxyUrl) : undefined;

function getJSON(url) {
  const lib = url.startsWith('https:') ? https : require('http');
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { agent: url.startsWith('https:') ? agent : undefined, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

// Aggregate Binance klines ([openTime, o, h, l, c, ...]) into tf-second candles.
// Klines are sorted first: batched fetches can overlap at the edges, and the
// chart requires strictly ascending candle times.
function aggregate(klines, tf) {
  klines = [...klines].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const k of klines) {
    const t = Math.floor(k[0] / 1000 / tf) * tf;
    const o = +k[1], h = +k[2], l = +k[3], c = +k[4];
    const last = out[out.length - 1];
    if (!last || last.t !== t) {
      out.push({ t, o, h, l, c });
    } else {
      last.c = c;
      if (h > last.h) last.h = h;
      if (l < last.l) last.l = l;
    }
  }
  return out;
}

class LiveFeed {
  constructor(market) {
    this.market = market;
    // assets that declare a Binance symbol take part in the live feed
    this.symbols = new Map(); // 'BTCUSDT' -> assetId
    for (const a of market.assets.values()) {
      if (a.binance) this.symbols.set(a.binance, a.id);
    }
    this.lastTrade = new Map(); // assetId -> timestamp of last live trade
    this.retryMs = 2000;
    this.ws = null;
    this.stopped = false;
  }

  async start() {
    if (!this.symbols.size) return;
    await this.seedAll();
    this.connect();
    // watchdog: drop assets back to simulation if the stream goes quiet
    this.watchdog = setInterval(() => {
      const now = Date.now();
      for (const [, assetId] of this.symbols) {
        if (this.market.isExternal(assetId) && (now - (this.lastTrade.get(assetId) || 0)) > STALE_MS) {
          console.log(`[livefeed] ${assetId}: stream stale, falling back to simulation`);
          this.market.setExternalMode(assetId, false);
        }
      }
    }, 5000);
    this.watchdog.unref?.();
  }

  // Fetch real history so charts show actual market candles on load:
  // 1s klines (~50 min) cover the 5s-60s timeframes, 1m klines cover 1m/5m,
  // and 1h/1d klines give ~25 days and ~20 months of genuine history.
  async seedAll() {
    for (const [symbol, assetId] of this.symbols) {
      try {
        const now = Date.now();
        const oneSec = [];
        for (let i = 3; i >= 1; i--) {
          const start = now - i * 1000 * 1000; // 1000 seconds per batch
          const batch = await getJSON(`${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=1s&limit=1000&startTime=${start}`);
          oneSec.push(...batch);
        }
        const oneMin = await getJSON(`${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=1m&limit=600`);
        const oneHour = await getJSON(`${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=1h&limit=600`);
        const oneDay = await getJSON(`${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=600`);
        const candles = {
          5: aggregate(oneSec, 5),
          15: aggregate(oneSec, 15),
          30: aggregate(oneSec, 30),
          60: aggregate(oneMin, 60),
          300: aggregate(oneMin, 300),
          3600: aggregate(oneHour, 3600),
          86400: aggregate(oneDay, 86400),
        };
        this.market.replaceCandles(assetId, candles);
        console.log(`[livefeed] ${assetId}: loaded real history from Binance (${symbol}, incl. 1h/1D)`);
      } catch (e) {
        console.log(`[livefeed] ${assetId}: history unavailable (${e.message}) — using simulated history`);
      }
    }
  }

  connect() {
    if (this.stopped) return;
    const streams = [...this.symbols.keys()].map((s) => `${s.toLowerCase()}@trade`).join('/');
    const url = `${WS_BASE}/stream?streams=${streams}`;
    const ws = new WebSocket(url, { agent: url.startsWith('wss:') ? agent : undefined, handshakeTimeout: 10000 });
    this.ws = ws;

    ws.on('open', () => {
      this.retryMs = 2000;
      console.log('[livefeed] connected to Binance stream');
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const d = msg.data;
      if (!d || d.e !== 'trade') return;
      const assetId = this.symbols.get(d.s);
      if (!assetId) return;
      const price = parseFloat(d.p);
      if (!Number.isFinite(price)) return;
      if (!this.market.isExternal(assetId)) {
        console.log(`[livefeed] ${assetId}: live prices active`);
        this.market.setExternalMode(assetId, true);
      }
      this.lastTrade.set(assetId, Date.now());
      this.market.setExternalPrice(assetId, price, d.T || Date.now());
    });

    const onDown = (why) => () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const [, assetId] of this.symbols) this.market.setExternalMode(assetId, false);
      if (this.stopped) return;
      console.log(`[livefeed] stream ${why} — retrying in ${Math.round(this.retryMs / 1000)}s (simulation active meanwhile)`);
      setTimeout(() => this.connect(), this.retryMs).unref?.();
      this.retryMs = Math.min(this.retryMs * 2, 60000);
    };
    ws.on('close', onDown('closed'));
    ws.on('error', (e) => {
      console.log(`[livefeed] stream error: ${e.message}`);
      ws.terminate();
    });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    if (this.ws) this.ws.terminate();
  }
}

module.exports = { LiveFeed };
