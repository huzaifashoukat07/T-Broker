// Live forex / metals / stock prices from Twelve Data (API key required).
//
// Twelve Data's WebSocket stream is a Pro-plan feature, so this connector uses
// the REST quote endpoint instead and stays inside a credits-per-minute budget.
// Polling alone would make the chart freeze between requests, so the price is
// not written directly: each poll sets a TARGET and the market simulator keeps
// ticking every 500ms while converging on it. The result is a smooth, live
// chart whose price always tracks the real market.
//
// Real OHLC history (1m / 5m / 1h / 1D) is loaded once at startup. The
// sub-minute timeframes have no real source on any plan, so their simulated
// history is rescaled to the true price level instead.
//
// Without TWELVEDATA_API_KEY nothing here runs and assets stay simulated.

const https = require('https');

let HttpsProxyAgent = null;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch { /* optional */ }

const API_BASE = process.env.TWELVEDATA_URL || 'https://api.twelvedata.com';
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
const agent = proxyUrl && HttpsProxyAgent ? new HttpsProxyAgent(proxyUrl) : undefined;

// assetId -> Twelve Data symbol. Brent stays on the Alpha Vantage anchor:
// commodity futures aren't part of the forex/stock plans.
const SYMBOLS = {
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD',
  USDCAD: 'USD/CAD',
  EURGBP: 'EUR/GBP',
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  AAPL: 'AAPL',
  TSLA: 'TSLA',
  AMZN: 'AMZN',
  MSFT: 'MSFT',
};

// Timeframe (seconds) -> Twelve Data interval, for the history load.
const HISTORY_INTERVALS = { 60: '1min', 300: '5min', 3600: '1h', 86400: '1day' };

const MIN_POLL_MS = 5000;
const MAX_POLL_MS = 120000;

function getJSON(url) {
  const lib = url.startsWith('https:') ? https : require('http');
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { agent: url.startsWith('https:') ? agent : undefined, timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

// Twelve Data reports errors in the JSON body with a 200 status.
function apiError(payload) {
  if (payload && payload.status === 'error') return new Error(`${payload.code || ''} ${payload.message || 'API error'}`.trim());
  return null;
}

// "2026-07-24 15:30:00" / "2026-07-24" (requested in UTC) -> epoch seconds
function parseTime(dt) {
  const iso = dt.includes(' ') ? `${dt.replace(' ', 'T')}Z` : `${dt}T00:00:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

class FxFeed {
  constructor(market) {
    this.market = market;
    this.key = process.env.TWELVEDATA_API_KEY || '';
    this.symbols = new Map(); // assetId -> 'EUR/USD'
    for (const [assetId, symbol] of Object.entries(SYMBOLS)) {
      if (market.getAsset(assetId)) this.symbols.set(assetId, symbol);
    }
    // Credits-per-minute budget: each polled symbol costs 1 credit per poll.
    // Defaults to the Grow plan's 55/min; set TWELVEDATA_CREDITS_PER_MIN to
    // match your plan (Basic/free is 8).
    this.budget = Number(process.env.TWELVEDATA_CREDITS_PER_MIN) || 55;
    this.pollMs = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.ceil((this.symbols.size * 60000) / this.budget)));
    this.basePollMs = this.pollMs;
    this.stopped = false;
    this.lastOk = 0;
  }

  async start() {
    if (!this.key) {
      console.log('[fx] TWELVEDATA_API_KEY not set — forex/metals/stocks stay simulated');
      return;
    }
    if (!this.symbols.size) return;
    console.log(`[fx] Twelve Data enabled for ${this.symbols.size} assets — polling every ${Math.round(this.pollMs / 1000)}s (${this.budget} credits/min budget)`);
    await this.seedAll();
    this.poll();
    // Watchdog: if quotes stop arriving, drop the assets back to plain
    // simulation so the "live" badge never lies.
    this.watchdog = setInterval(() => {
      // Measured against the *base* interval, not the backed-off one, so the
      // badge clears promptly instead of stretching with each retry.
      if (this.lastOk && Date.now() - this.lastOk > this.basePollMs * 3 + 15000) {
        for (const assetId of this.symbols.keys()) this.market.setGuided(assetId, false);
      }
    }, 10000);
    this.watchdog.unref?.();
  }

  // Load genuine OHLC history for the timeframes Twelve Data can serve.
  // Runs once at startup; a failure for one asset just leaves it simulated.
  async seedAll() {
    for (const [assetId, symbol] of this.symbols) {
      try {
        const price = await this.fetchPrice(symbol);
        if (price) this.market.anchorPrice(assetId, price); // lift simulated history to the real level
        const candles = {};
        for (const [tf, interval] of Object.entries(HISTORY_INTERVALS)) {
          const series = await this.fetchSeries(symbol, interval);
          if (series.length) candles[tf] = series;
        }
        if (Object.keys(candles).length) {
          this.market.replaceCandles(assetId, candles);
          console.log(`[fx] ${assetId}: loaded real history from Twelve Data (${symbol})`);
        }
      } catch (e) {
        console.log(`[fx] ${assetId}: history unavailable (${e.message}) — using simulated history`);
      }
    }
  }

  async fetchPrice(symbol) {
    const url = `${API_BASE}/price?symbol=${encodeURIComponent(symbol)}&apikey=${this.key}`;
    const data = await getJSON(url);
    const err = apiError(data);
    if (err) throw err;
    const p = parseFloat(data.price);
    return Number.isFinite(p) ? p : null;
  }

  async fetchSeries(symbol, interval) {
    const url = `${API_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}`
      + `&outputsize=600&timezone=UTC&apikey=${this.key}`;
    const data = await getJSON(url);
    const err = apiError(data);
    if (err) throw err;
    const values = Array.isArray(data.values) ? data.values : [];
    return values
      .map((v) => ({
        t: parseTime(v.datetime),
        o: parseFloat(v.open), h: parseFloat(v.high), l: parseFloat(v.low), c: parseFloat(v.close),
      }))
      .filter((c) => c.t && Number.isFinite(c.o) && Number.isFinite(c.c))
      .sort((a, b) => a.t - b.t); // Twelve Data returns newest first
  }

  // One batched quote request for every symbol (1 credit per symbol), then
  // hand each price to the market as a convergence target.
  async tick() {
    const symbols = [...this.symbols.values()];
    const url = `${API_BASE}/price?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${this.key}`;
    const data = await getJSON(url);
    const err = apiError(data);
    if (err) throw err;
    let applied = 0;
    for (const [assetId, symbol] of this.symbols) {
      // batched responses are keyed by symbol; a single symbol returns bare
      const entry = symbols.length === 1 ? data : data[symbol];
      const price = parseFloat(entry && entry.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      this.market.setTarget(assetId, price);
      applied++;
    }
    if (!applied) throw new Error('no prices in response');
    this.lastOk = Date.now();
  }

  poll() {
    if (this.stopped) return;
    this.tick()
      .then(() => {
        if (this.pollMs !== this.basePollMs) {
          this.pollMs = this.basePollMs;
          console.log('[fx] quotes recovered — back to normal polling');
        }
      })
      .catch((e) => {
        // Rate limits and quota exhaustion back off instead of hammering the API.
        const rateLimited = /429|limit|credits/i.test(e.message);
        this.pollMs = Math.min(MAX_POLL_MS, Math.max(this.pollMs * 2, this.basePollMs));
        console.log(`[fx] quote fetch failed (${e.message})${rateLimited ? ' — rate limited' : ''}; retrying in ${Math.round(this.pollMs / 1000)}s (simulation active meanwhile)`);
      })
      .finally(() => {
        if (this.stopped) return;
        this.timer = setTimeout(() => this.poll(), this.pollMs);
        this.timer.unref?.();
      });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
  }
}

module.exports = { FxFeed };
