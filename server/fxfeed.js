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
// Backoff ceiling. Kept short deliberately: while quotes are down the assets
// trade as OTC, so this is how long a pair can stay synthetic after its real
// market reopens (Monday morning, or a quota reset).
const MAX_POLL_MS = 60000;
// A quote that hasn't moved for this long is treated as a closed market.
const FROZEN_MS = 20 * 60 * 1000;
// A market we know is closed only needs checking often enough to notice it
// reopening. Polling it at full rate burns the daily credit allowance on
// symbols that cannot move — which is what used to leave nothing in the
// budget by the time the session actually opened.
// 3 minutes: cheap enough that a whole weekend costs only a few hundred
// credits, quick enough that traders aren't left on OTC long after the
// session opens.
const CLOSED_RECHECK_MS = Number(process.env.TWELVEDATA_CLOSED_RECHECK_MS) || 3 * 60 * 1000;

const utcDay = () => new Date().toISOString().slice(0, 10);

// "09:00-17:00" -> { from, to } in minutes past UTC midnight (may wrap).
function parseWindow(spec) {
  const m = String(spec || '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const from = (+m[1]) * 60 + (+m[2]);
  const to = (+m[3]) * 60 + (+m[4]);
  return from === to ? null : { from, to };
}

function windowLengthMs({ from, to }) {
  return ((to > from ? to - from : 1440 - from + to)) * 60000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

// Paces every request — history seeding and quote polling alike — against the
// plan's credits-per-minute allowance, one credit per symbol.
//
// Deliberately spaces requests evenly instead of allowing an initial burst:
// the API enforces a *rolling* window, so spending a full minute's allowance
// up front still trips the limit on the very next request.
class CreditBucket {
  constructor(perMin) {
    // 15% headroom: the server measures its window on arrival times, so
    // spacing exactly at the limit still clips the boundary now and then.
    this.spacingMs = 60000 / (Math.max(1, perMin) * 0.85);
    this.nextAt = 0;
  }

  async take(n) {
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.spacingMs * n;
    if (at > now) await sleep(at - now);
  }
}

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
  constructor(market, onHistory, store) {
    this.market = market;
    this.onHistory = onHistory; // tell connected charts to reload this asset
    this.store = store;         // credit usage survives restarts via Mongo
    this.key = process.env.TWELVEDATA_API_KEY || '';
    this.symbols = new Map(); // assetId -> 'EUR/USD'
    // TWELVEDATA_SYMBOLS can narrow the live set (e.g. "EURUSD,GBPUSD,XAUUSD"),
    // which is how you stay inside a small plan's daily quota.
    const only = String(process.env.TWELVEDATA_SYMBOLS || '')
      .toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
    for (const [assetId, symbol] of Object.entries(SYMBOLS)) {
      if (only.length && !only.includes(assetId)) continue;
      if (market.getAsset(assetId)) this.symbols.set(assetId, symbol);
    }
    // Credits-per-minute budget: each polled symbol costs 1 credit per poll.
    // Defaults to the Grow plan's 55/min; set TWELVEDATA_CREDITS_PER_MIN to
    // match your plan (Basic/free is 8).
    this.budget = Number(process.env.TWELVEDATA_CREDITS_PER_MIN) || 55;
    this.bucket = new CreditBucket(this.budget);
    // A batch request costs one credit per symbol, so it must never ask for
    // more symbols than a minute's allowance — bigger sets are split and the
    // chunks are spent across the cycle.
    this.chunk = Math.max(1, Math.min(this.symbols.size, Math.floor(this.budget)));
    // Optional UTC window to concentrate the budget in, e.g. "09:00-17:00".
    this.window = parseWindow(process.env.TWELVEDATA_ACTIVE_HOURS);
    // Daily credit allowance (Basic/free = 800; paid plans have no daily cap).
    // Spending is tracked per UTC day so an exhausted budget waits for the
    // reset instead of hammering the API for 429s. Must be read BEFORE the
    // poll interval is derived — it is one of that calculation's inputs.
    this.dailyCap = Number(process.env.TWELVEDATA_CREDITS_PER_DAY) || 0;

    // Polling is sized to ~70% of the per-minute allowance so the background
    // history load still gets credits; at 100% the seeding queue never drains.
    const rateMs = Math.ceil((this.symbols.size * 60000) / (this.budget * 0.7));
    // ...but the per-minute rate is not the real constraint on a capped plan.
    // Spread the DAILY allowance evenly across the hours we intend to be live,
    // otherwise the whole budget is gone within the first couple of hours —
    // and cutting symbols just makes it poll faster, not last longer.
    let budgetMs = 0;
    if (this.dailyCap) {
      const activeMs = this.window ? windowLengthMs(this.window) : 86400000;
      const pollsAffordable = Math.max(1, Math.floor(this.dailyCap / this.symbols.size));
      budgetMs = Math.ceil(activeMs / pollsAffordable);
    }
    this.pollMs = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, rateMs, budgetMs));
    this.basePollMs = this.pollMs;
    this.stopped = false;
    this.lastOk = 0;
    this.stale = new Map(); // assetId -> { price, since } for frozen-quote detection
    this.recheckAt = new Map(); // assetId -> when a closed market is next checked
    this.spentDay = utcDay();
    this.spent = 0;
    this.capWarned = false;
  }

  async start() {
    if (!this.key) {
      console.log('[fx] TWELVEDATA_API_KEY not set — forex/metals/stocks stay simulated');
      return;
    }
    if (!this.symbols.size) return;
    await this.loadSpend();
    const win = this.window ? ` within ${process.env.TWELVEDATA_ACTIVE_HOURS} UTC` : '';
    console.log(`[fx] Twelve Data enabled for ${this.symbols.size} assets — polling every ${Math.round(this.pollMs / 1000)}s${win} (${this.budget} credits/min${this.dailyCap ? `, ${this.dailyCap}/day` : ''})`);
    if (this.dailyCap) {
      const activeMs = this.window ? windowLengthMs(this.window) : 86400000;
      const coversMs = Math.floor(this.dailyCap / this.symbols.size) * this.pollMs;
      const covered = Math.min(coversMs, activeMs) / 3600000;
      console.log(`[fx] budget: ${this.dailyCap} credits/day ÷ ${this.symbols.size} symbols = ${Math.floor(this.dailyCap / this.symbols.size)} polls, covering ~${covered.toFixed(1)}h${win ? ' of the window' : ' per day'}. Fewer symbols does NOT extend this on its own — the interval scales with them.`);
    }
    // Quotes first so prices go live straight away, then backfill history in
    // the background — on a small plan seeding takes minutes, and waiting for
    // it would leave the whole board simulated until it finished.
    this.poll();
    this.seedAll().catch((e) => console.log(`[fx] history load stopped: ${e.message}`));
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
  // Runs once at startup, paced by the credit budget, so on a small plan it
  // fills in gradually rather than failing outright. The newest close doubles
  // as the real price, which saves a quote request per asset.
  async seedAll() {
    for (const [assetId, symbol] of this.symbols) {
      // Don't buy history we can't use: outside the live window these assets
      // trade as OTC anyway, and a free host that restarts often would spend
      // a slice of the allowance on every boot.
      if (!this.inActiveWindow()) {
        console.log('[fx] outside the live window — skipping history load to preserve credits');
        return;
      }
      try {
        const candles = {};
        for (const [tf, interval] of Object.entries(HISTORY_INTERVALS)) {
          const series = await this.fetchSeries(symbol, interval);
          if (series.length) candles[tf] = series;
        }
        const minute = candles[60];
        if (minute && minute.length) {
          // lift the simulated sub-minute history to the real price level
          this.market.anchorPrice(assetId, minute[minute.length - 1].c);
        }
        if (Object.keys(candles).length) {
          this.market.replaceCandles(assetId, candles);
          this.onHistory?.(assetId);
          console.log(`[fx] ${assetId}: loaded real history from Twelve Data (${symbol})`);
        }
      } catch (e) {
        console.log(`[fx] ${assetId}: history unavailable (${e.message}) — using simulated history`);
      }
    }
  }

  async fetchSeries(symbol, interval) {
    // History costs credits too — without this the backfill could quietly
    // drain a small daily allowance before any quote was ever fetched.
    if (!this.canSpend(1)) throw new Error('daily credit allowance spent');
    await this.bucket.take(1);
    this.spend(1);
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

  // Batched quote requests (1 credit per symbol), split into chunks that fit
  // the plan's per-minute allowance. Each price becomes a convergence target.
  //
  // Uses /quote rather than /price because it carries is_market_open. A closed
  // market keeps serving its last close forever, which would otherwise look
  // like a perfectly healthy feed and leave a frozen "LIVE" chart all weekend.
  async tick() {
    const now = Date.now();
    // Only poll symbols that are actually worth a credit: everything open,
    // plus closed markets that are due a reopening check.
    const entries = [...this.symbols.entries()].filter(([assetId]) => {
      const next = this.recheckAt.get(assetId);
      return !next || now >= next;
    });
    // Outside the configured live window we buy nothing at all, so the whole
    // allowance is available when it matters.
    if (!this.inActiveWindow()) {
      if (!this.windowIdle) {
        this.windowIdle = true;
        console.log(`[fx] outside the live window (${process.env.TWELVEDATA_ACTIVE_HOURS} UTC) — assets trade as OTC, no credits spent`);
        for (const [assetId] of this.symbols) this.market.setGuided(assetId, false);
      }
      this.lastOk = now;
      return;
    }
    if (this.windowIdle) {
      this.windowIdle = false;
      console.log('[fx] live window open — buying quotes again');
    }

    if (!entries.length) { this.lastOk = now; return; } // all closed, none due
    if (!this.canSpend(entries.length)) {
      // No budget left to prove these markets are live, so stop claiming they
      // are: hand them to OTC now instead of leaving a stale "LIVE" badge
      // until the staleness watchdog trips.
      for (const [assetId] of this.symbols) this.market.setGuided(assetId, false);
      this.lastOk = now;
      return;
    }

    let applied = 0;
    let closed = 0;
    let lastError = null;
    for (let i = 0; i < entries.length; i += this.chunk) {
      const group = entries.slice(i, i + this.chunk);
      const symbols = group.map(([, s]) => s);
      try {
        await this.bucket.take(symbols.length);
        this.spend(symbols.length);
        const url = `${API_BASE}/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${this.key}`;
        const data = await getJSON(url);
        const err = apiError(data);
        if (err) throw err;
        for (const [assetId, symbol] of group) {
          // batched responses are keyed by symbol; a single symbol returns bare
          const entry = symbols.length === 1 ? data : data[symbol];
          if (!entry) continue;
          const price = parseFloat(entry.close ?? entry.price);
          // Market shut (weekend, exchange hours): hand straight over to OTC
          // rather than waiting for the staleness watchdog.
          if (entry.is_market_open === false) {
            if (this.market.isGuided(assetId)) {
              console.log(`[fx] ${assetId}: market closed — handing over to OTC`);
            }
            this.market.setGuided(assetId, false);
            this.stale.delete(assetId);
            // don't spend further credits on it until it might have reopened
            this.recheckAt.set(assetId, Date.now() + CLOSED_RECHECK_MS);
            closed++;
            continue;
          }
          if (!Number.isFinite(price) || price <= 0) continue;
          if (this.isFrozen(assetId, price)) {
            this.recheckAt.set(assetId, Date.now() + CLOSED_RECHECK_MS);
            closed++;
            continue;
          }
          if (this.recheckAt.delete(assetId)) {
            console.log(`[fx] ${assetId}: market reopened — back to live prices`);
          }
          this.market.setTarget(assetId, price, this.pollMs);
          applied++;
        }
      } catch (e) {
        lastError = e;
      }
    }
    // An all-closed market is a success, not a failure — don't back off for it.
    if (!applied && !closed) throw lastError || new Error('no prices in response');
    this.lastOk = Date.now();
  }

  // --- daily credit budget ----------------------------------------------
  // Plans with a daily cap (Basic/free = 800) are tracked per UTC day so the
  // allowance is spent on open markets rather than exhausted overnight.

  // Credit usage is persisted: without it every redeploy starts the count at
  // zero while the provider's own counter keeps running, so the server
  // immediately overspends and gets 429s it has no way to anticipate.
  async loadSpend() {
    const meta = this.store?.db?.collection('meta');
    if (!meta) return;
    try {
      const doc = await meta.findOne({ _id: 'fx' });
      if (doc && doc.day === utcDay()) {
        this.spentDay = doc.day;
        this.spent = doc.spent || 0;
        if (this.spent) console.log(`[fx] resuming today's credit usage: ${this.spent}${this.dailyCap ? `/${this.dailyCap}` : ''} already spent`);
      }
    } catch (e) {
      console.log(`[fx] could not read credit usage (${e.message})`);
    }
  }

  saveSpend() {
    const meta = this.store?.db?.collection('meta');
    if (!meta) return;
    clearTimeout(this.spendTimer);
    this.spendTimer = setTimeout(() => {
      meta.updateOne({ _id: 'fx' }, { $set: { day: this.spentDay, spent: this.spent } }, { upsert: true })
        .catch((e) => console.log(`[fx] could not persist credit usage (${e.message})`));
    }, 2000);
    this.spendTimer.unref?.();
  }

  rollDay() {
    const today = utcDay();
    if (today !== this.spentDay) {
      if (this.spent) console.log(`[fx] daily credit usage reset (${this.spent} used on ${this.spentDay})`);
      this.spentDay = today;
      this.spent = 0;
      this.capWarned = false;
      this.saveSpend();
    }
  }

  // Optional daily window (UTC) during which live prices are bought, e.g.
  // TWELVEDATA_ACTIVE_HOURS=09:00-17:00. Outside it nothing is polled, so the
  // whole allowance is spent when your traders are actually online.
  inActiveWindow(now = new Date()) {
    if (!this.window) return true;
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const { from, to } = this.window;
    return from <= to ? (mins >= from && mins < to) : (mins >= from || mins < to);
  }

  canSpend(n) {
    this.rollDay();
    if (!this.dailyCap) return true;
    if (this.spent + n <= this.dailyCap) return true;
    if (!this.capWarned) {
      this.capWarned = true;
      console.log(`[fx] daily credit allowance spent (${this.spent}/${this.dailyCap}) — assets trade as OTC until it resets at 00:00 UTC`);
    }
    return false;
  }

  spend(n) {
    this.rollDay();
    this.spent += n;
    this.saveSpend();
  }

  // Safety net for symbols the provider doesn't flag: a price that hasn't
  // moved at all for a long stretch means the market isn't trading, so the
  // asset goes to OTC instead of showing a flat "live" chart. The window is
  // deliberately generous — wrongly demoting a live market is worse than
  // being slow to spot a closed one.
  isFrozen(assetId, price) {
    const prev = this.stale.get(assetId);
    if (!prev || prev.price !== price) {
      this.stale.set(assetId, { price, since: Date.now() });
      return false;
    }
    if (Date.now() - prev.since < FROZEN_MS) return false;
    if (this.market.isGuided(assetId)) {
      console.log(`[fx] ${assetId}: quote unchanged for ${Math.round(FROZEN_MS / 60000)}min — treating as closed, handing over to OTC`);
    }
    this.market.setGuided(assetId, false);
    return true;
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
