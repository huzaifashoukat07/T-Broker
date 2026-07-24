// Market engine: simulated live price feeds + candle aggregation.
// Prices follow a random walk with occasional momentum bursts so charts
// look like real markets (trends, spikes, consolidation).

const ASSETS = [
  { id: 'EURUSD',  name: 'EUR/USD',        group: 'Currencies',   price: 1.0852,  vol: 0.00006, decimals: 5, payout: 0.85 },
  { id: 'GBPUSD',  name: 'GBP/USD',        group: 'Currencies',   price: 1.2648,  vol: 0.00007, decimals: 5, payout: 0.84 },
  { id: 'USDJPY',  name: 'USD/JPY',        group: 'Currencies',   price: 156.42,  vol: 0.00006, decimals: 3, payout: 0.82 },
  { id: 'AUDUSD',  name: 'AUD/USD',        group: 'Currencies',   price: 0.6553,  vol: 0.00007, decimals: 5, payout: 0.80 },
  { id: 'USDCAD',  name: 'USD/CAD',        group: 'Currencies',   price: 1.3724,  vol: 0.00006, decimals: 5, payout: 0.80 },
  { id: 'EURGBP',  name: 'EUR/GBP',        group: 'Currencies',   price: 0.8579,  vol: 0.00005, decimals: 5, payout: 0.78 },
  { id: 'BTCUSD',  name: 'Bitcoin',        group: 'Crypto',       price: 64230,   vol: 0.00030, decimals: 2, payout: 0.90, binance: 'BTCUSDT' },
  { id: 'ETHUSD',  name: 'Ethereum',       group: 'Crypto',       price: 3412.5,  vol: 0.00035, decimals: 2, payout: 0.88, binance: 'ETHUSDT' },
  { id: 'SOLUSD',  name: 'Solana',         group: 'Crypto',       price: 146.8,   vol: 0.00045, decimals: 3, payout: 0.85, binance: 'SOLUSDT' },
  { id: 'XAUUSD',  name: 'Gold',           group: 'Commodities',  price: 2352.4,  vol: 0.00010, decimals: 2, payout: 0.86 },
  { id: 'XAGUSD',  name: 'Silver',         group: 'Commodities',  price: 29.54,   vol: 0.00016, decimals: 3, payout: 0.82 },
  { id: 'UKBRENT', name: 'Brent Oil',      group: 'Commodities',  price: 84.12,   vol: 0.00020, decimals: 3, payout: 0.80 },
  { id: 'AAPL',    name: 'Apple',          group: 'Stocks',       price: 211.30,  vol: 0.00018, decimals: 2, payout: 0.76 },
  { id: 'TSLA',    name: 'Tesla',          group: 'Stocks',       price: 189.70,  vol: 0.00040, decimals: 2, payout: 0.78 },
  { id: 'AMZN',    name: 'Amazon',         group: 'Stocks',       price: 186.20,  vol: 0.00022, decimals: 2, payout: 0.75 },
  { id: 'MSFT',    name: 'Microsoft',      group: 'Stocks',       price: 447.60,  vol: 0.00016, decimals: 2, payout: 0.75 },
];

const TIMEFRAMES = [5, 15, 30, 60, 300, 3600, 86400]; // seconds (5s … 1h, 1D)
const MAX_CANDLES = 600; // per timeframe: 600×1D ≈ 20 months of history
const TICK_MS = 500;

function gauss() {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Market {
  constructor() {
    this.assets = new Map();
    for (const def of ASSETS) {
      this.assets.set(def.id, {
        ...def,
        base: def.price,
        momentum: 0,
        external: false, // true while a real live feed is driving this asset
        candles: Object.fromEntries(TIMEFRAMES.map((tf) => [tf, []])),
      });
    }
    this.listeners = new Set();
    this.seedHistory();
  }

  // Backfill a full MAX_CANDLES of history for EVERY timeframe of every
  // asset, so charts are never empty no matter how far back you scroll —
  // 600 daily candles reach ~20 months into the past. Each timeframe is
  // generated as its own random walk (volatility scaled by candle length,
  // capped so daily moves stay realistic) and rescaled so all timeframes
  // end exactly at the asset's current price. Live feeds later overwrite
  // crypto with real Binance history.
  seedHistory() {
    const now = Math.floor(Date.now() / 1000);
    for (const a of this.assets.values()) {
      for (const tf of TIMEFRAMES) {
        const effVol = a.vol * Math.min(Math.sqrt(tf), 60);
        const lastBucket = Math.floor(now / tf) * tf;
        const arr = [];
        let price = a.base;
        let momentum = 0;
        for (let i = MAX_CANDLES - 1; i >= 0; i--) {
          const t = lastBucket - i * tf;
          const o = price;
          momentum = momentum * 0.9 + gauss() * effVol * 0.2;
          const reversion = ((a.base - o) / a.base) * 0.01;
          const c = o * (1 + gauss() * effVol + momentum + reversion);
          const h = Math.max(o, c) * (1 + Math.abs(gauss()) * effVol * 0.5);
          const l = Math.min(o, c) * (1 - Math.abs(gauss()) * effVol * 0.5);
          arr.push({ t, o, h, l, c });
          price = c;
        }
        // pin the end of history to the live price
        const ratio = a.price / arr[arr.length - 1].c;
        for (const c of arr) {
          c.o *= ratio; c.h *= ratio; c.l *= ratio; c.c *= ratio;
        }
        a.candles[tf] = arr;
      }
    }
  }

  step(a) {
    // Momentum decays and gets random kicks -> trending behaviour
    a.momentum = a.momentum * 0.98 + gauss() * a.vol * 0.1;
    if (Math.random() < 0.001) a.momentum += (Math.random() < 0.5 ? -1 : 1) * a.vol * 2; // news spike
    // Pull toward the latest real quote when a polled feed is guiding this
    // asset (strong, so the gap closes within a few seconds), otherwise a
    // gentle drift back to the seed price.
    const anchor = a.guided && a.target ? a.target : a.base;
    const pull = a.guided && a.target ? 0.12 : 0.002;
    const reversion = (anchor - a.price) / anchor * pull;
    const change = gauss() * a.vol + a.momentum + reversion;
    a.price = a.price * (1 + change);
  }

  applyTick(a, tSec) {
    for (const tf of TIMEFRAMES) {
      const bucket = Math.floor(tSec / tf) * tf;
      const arr = a.candles[tf];
      const last = arr[arr.length - 1];
      if (!last || bucket > last.t) {
        const open = last ? last.c : a.price;
        arr.push({ t: bucket, o: open, h: Math.max(open, a.price), l: Math.min(open, a.price), c: a.price });
        if (arr.length > MAX_CANDLES) arr.shift();
      } else {
        // bucket <= last.t: update the newest candle. Never push backwards —
        // live feeds are stamped with Binance's clock while the tick loop uses
        // the local clock, and any skew would otherwise create out-of-order
        // candles (which breaks the chart).
        last.c = a.price;
        if (a.price > last.h) last.h = a.price;
        if (a.price < last.l) last.l = a.price;
      }
    }
  }

  start() {
    this.timer = setInterval(() => {
      const tSec = Math.floor(Date.now() / 1000);
      const ticks = [];
      for (const a of this.assets.values()) {
        if (!a.external) this.step(a);
        this.applyTick(a, tSec); // for external assets this just keeps candle buckets contiguous
        const prev = a.lastSent ?? a.price;
        a.lastSent = a.price;
        ticks.push({
          asset: a.id,
          price: round(a.price, a.decimals),
          dir: a.price > prev ? 1 : a.price < prev ? -1 : 0,
          live: a.external || !!a.guided,
        });
      }
      const payload = { time: Date.now(), ticks };
      for (const fn of this.listeners) fn(payload);
    }, TICK_MS);
    this.timer.unref?.();
  }

  // --- live feed integration ---------------------------------------------

  isExternal(id) {
    const a = this.assets.get(id);
    return !!(a && a.external);
  }

  setExternalMode(id, on) {
    const a = this.assets.get(id);
    if (!a || a.external === on) return;
    a.external = on;
    // re-anchor the simulator to the current (real) price so a feed dropout
    // continues smoothly instead of reverting toward the old base
    a.base = a.price;
    a.momentum = 0;
  }

  // Guided mode: a polled quote feed (e.g. Twelve Data) supplies the real
  // price every few seconds while the simulator keeps ticking in between, so
  // the chart moves smoothly and still tracks the true market. Unlike
  // setExternalPrice this never freezes the price between updates.
  setTarget(id, price) {
    const a = this.assets.get(id);
    if (!a || a.external || !Number.isFinite(price) || price <= 0) return;
    if (!a.guided) {
      // first real quote: lift the whole chart to the true price level
      this.anchorPrice(id, price);
      a.guided = true;
    }
    a.target = price;
  }

  setGuided(id, on) {
    const a = this.assets.get(id);
    if (!a || a.guided === on) return;
    a.guided = on;
    if (!on) {
      a.target = null;
      a.base = a.price; // keep drifting from where the real feed left off
      a.momentum = 0;
    }
  }

  setExternalPrice(id, price, timeMs) {
    const a = this.assets.get(id);
    if (!a || !a.external) return;
    a.price = price;
    this.applyTick(a, Math.floor(timeMs / 1000));
  }

  // Re-anchor a simulated asset to a real market price (e.g. a daily quote
  // from Alpha Vantage): rescale the entire candle history by the ratio so
  // the chart keeps its shape but sits at the true price level.
  anchorPrice(id, price) {
    const a = this.assets.get(id);
    // Guided assets already carry a realtime quote — don't let a slower daily
    // anchor (Alpha Vantage) pull them off it.
    if (!a || a.external || a.guided || !Number.isFinite(price) || price <= 0) return;
    const ratio = price / a.price;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    for (const tf of TIMEFRAMES) {
      for (const c of a.candles[tf]) {
        c.o *= ratio; c.h *= ratio; c.l *= ratio; c.c *= ratio;
      }
    }
    a.price = price;
    a.base = price;
    a.momentum = 0;
  }

  replaceCandles(id, candlesByTf) {
    const a = this.assets.get(id);
    if (!a) return;
    for (const tf of TIMEFRAMES) {
      if (candlesByTf[tf] && candlesByTf[tf].length) {
        a.candles[tf] = candlesByTf[tf].slice(-MAX_CANDLES);
      }
    }
    const newest = a.candles[TIMEFRAMES[0]];
    if (newest.length) {
      a.price = newest[newest.length - 1].c;
      a.base = a.price;
    }
  }

  onTick(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getAsset(id) {
    return this.assets.get(id);
  }

  price(id) {
    const a = this.assets.get(id);
    return a ? round(a.price, a.decimals) : null;
  }

  listAssets() {
    return [...this.assets.values()].map((a) => ({
      id: a.id,
      name: a.name,
      group: a.group,
      payout: a.payout,
      decimals: a.decimals,
      price: round(a.price, a.decimals),
      live: a.external || !!a.guided,
    }));
  }

  candles(id, tf, limit = 200) {
    const a = this.assets.get(id);
    if (!a || !a.candles[tf]) return null;
    const arr = a.candles[tf].slice(-limit);
    return arr.map((c) => ({
      t: c.t,
      o: round(c.o, a.decimals),
      h: round(c.h, a.decimals),
      l: round(c.l, a.decimals),
      c: round(c.c, a.decimals),
    }));
  }
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

module.exports = { Market, TIMEFRAMES, TICK_MS };
