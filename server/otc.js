// OTC market engine — synthetic instruments that stay open 24/7, including
// weekends when the real forex market is closed.
//
// FAIRNESS INVARIANT (do not break this):
//   The price path is a pure function of (daily seed, asset, tick index).
//   It NEVER reads balances, open trades, direction, stake or any other user
//   state. Nothing in this file may take a user as input. The house edge comes
//   from the payout being below 100% on a roughly 50/50 outcome — not from
//   moving the price against anyone.
//
// The daily seed is derived from a master secret via HMAC, so:
//   - SHA-256(seed) is published *in advance* as a commitment,
//   - the seed itself is revealed once the day is over,
//   - anyone can then regenerate the exact price series and check it against
//     the commitment they were shown earlier.
// Revealing one day's seed never exposes the master secret, so future days
// stay unpredictable while past days stay verifiable.

const crypto = require('crypto');

const TICK_MS = 500;
const TICKS_PER_DAY = (24 * 60 * 60 * 1000) / TICK_MS; // 172800
const KEEP_DAYS = 30; // how many past days of seeds/opens we retain for audit

// Small, fast, fully specified PRNG so third parties can reimplement it.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFrom(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10); // UTC date
}

function dayStartMs(dateStr) {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

// Per-asset price chain for one UTC day. Deterministic given (seed, assetId,
// open) — advancing tick by tick reproduces exactly what users saw.
class Chain {
  constructor(seedHex, assetId, open, vol) {
    const h = crypto.createHash('sha256').update(`${seedHex}:${assetId}`).digest('hex');
    this.rng = mulberry32(parseInt(h.slice(0, 8), 16));
    this.open = open;
    this.price = open;
    this.vol = vol;
    this.momentum = 0;
    this.n = 0;
  }

  advance() {
    const r = gaussFrom(this.rng);
    this.momentum = this.momentum * 0.98 + r * this.vol * 0.1;
    // occasional bursts, then a pull back toward the day's open so the series
    // stays in a believable range instead of wandering off
    if (this.rng() < 0.001) this.momentum += (this.rng() < 0.5 ? -1 : 1) * this.vol * 2;
    const reversion = ((this.open - this.price) / this.open) * 0.0015;
    this.price = this.price * (1 + r * this.vol + this.momentum + reversion);
    this.n++;
    return this.price;
  }

  advanceTo(target) {
    // bounded catch-up: a restart regenerates the day from its start
    const max = Math.min(target, TICKS_PER_DAY);
    while (this.n < max) this.advance();
    return this.price;
  }
}

class OtcEngine {
  constructor(market, store) {
    this.market = market;
    this.store = store;
    this.assets = [...market.assets.values()].filter((a) => a.otc);
    this.chains = new Map(); // assetId -> Chain
    this.days = {};          // 'YYYY-MM-DD' -> { commitment, open, revealed? }
    this.date = null;
    this.master = null;
  }

  async init() {
    if (!this.assets.length) return;
    await this.load();
    this.startDay(dayKey(Date.now()));
    this.market.setOtcDriver((assetId) => this.priceFor(assetId));
    console.log(`[otc] engine active for ${this.assets.length} instruments (24/7, provably fair)`);
  }

  // Master secret: env var wins, otherwise generated once and persisted so
  // commitments stay verifiable across restarts and deploys.
  async load() {
    this.master = process.env.OTC_MASTER_SECRET || null;
    const meta = this.store?.db?.collection('meta');
    if (meta) {
      try {
        const doc = await meta.findOne({ _id: 'otc' });
        if (doc) {
          if (!this.master && doc.master) this.master = doc.master;
          this.days = doc.days || {};
        }
      } catch (e) {
        console.log(`[otc] could not read state (${e.message}) — starting fresh`);
      }
    }
    if (!this.master) {
      this.master = crypto.randomBytes(32).toString('hex');
      console.log('[otc] generated a master secret — set OTC_MASTER_SECRET to keep it stable across redeploys');
    }
    await this.persist();
  }

  async persist() {
    const meta = this.store?.db?.collection('meta');
    if (!meta) return;
    // keep the audit trail bounded
    const keep = Object.keys(this.days).sort().slice(-KEEP_DAYS);
    this.days = Object.fromEntries(keep.map((d) => [d, this.days[d]]));
    try {
      await meta.updateOne({ _id: 'otc' }, { $set: { master: this.master, days: this.days } }, { upsert: true });
    } catch (e) {
      console.log(`[otc] could not persist state (${e.message})`);
    }
  }

  seedFor(dateStr) {
    return crypto.createHmac('sha256', this.master).update(`otc:${dateStr}`).digest('hex');
  }

  commitmentFor(dateStr) {
    return crypto.createHash('sha256').update(this.seedFor(dateStr)).digest('hex');
  }

  // Begin (or resume) a UTC day: fix each instrument's opening price, publish
  // the commitment, and rebuild the chains up to the current tick.
  startDay(dateStr) {
    this.date = dateStr;
    let rec = this.days[dateStr];
    if (!rec) {
      const open = {};
      for (const a of this.assets) {
        // carry yesterday's close forward when we have it, so days join up
        const prev = this.chains.get(a.id);
        open[a.id] = prev ? prev.price : a.price;
      }
      rec = { commitment: this.commitmentFor(dateStr), open };
      this.days[dateStr] = rec;
      this.persist();
    }
    const seed = this.seedFor(dateStr);
    for (const a of this.assets) {
      this.chains.set(a.id, new Chain(seed, a.id, rec.open[a.id] ?? a.price, a.vol));
    }
    this.rebuildHistory(dateStr);
  }

  tickIndex(ms) {
    return Math.floor((ms - dayStartMs(this.date)) / TICK_MS);
  }

  // Called by the market tick loop. Anchored to the wall clock rather than to
  // call count, so a lagging or restarted server lands on the same series.
  priceFor(assetId) {
    const now = Date.now();
    const today = dayKey(now);
    if (today !== this.date) this.startDay(today);
    const chain = this.chains.get(assetId);
    if (!chain) return null;
    const target = Math.min(this.tickIndex(now), TICKS_PER_DAY);
    const start = dayStartMs(this.date);
    // Record EVERY tick the chain produces. The loop may fire late or coalesce
    // ticks, but the candles must still contain the full published series.
    while (chain.n < target) {
      const n = chain.n; // index of the tick about to be produced
      const price = chain.advance();
      this.market.applyOtcTick(assetId, price, Math.floor((start + n * TICK_MS) / 1000));
    }
    return chain.price;
  }

  // Replay today from its open to now and write real candles, so a restart
  // (or a user scrolling back) sees the series that actually traded rather
  // than fresh noise. Timeframes longer than the elapsed day keep the
  // cosmetic backdrop the market engine seeded at boot.
  rebuildHistory(dateStr) {
    const start = dayStartMs(dateStr);
    const elapsed = Math.min(this.tickIndex(Date.now()), TICKS_PER_DAY);
    if (elapsed < 2) return;
    const seed = this.seedFor(dateStr);
    const rec = this.days[dateStr];
    for (const a of this.assets) {
      const chain = new Chain(seed, a.id, rec.open[a.id] ?? a.price, a.vol);
      const byTf = {};
      for (const tf of this.market.timeframes) {
        if (tf * 1000 > elapsed * TICK_MS) continue; // not enough of the day yet
        byTf[tf] = [];
      }
      for (let n = 0; n < elapsed; n++) {
        const price = chain.advance();
        const tSec = Math.floor((start + n * TICK_MS) / 1000);
        for (const tf of Object.keys(byTf)) {
          const bucket = Math.floor(tSec / tf) * tf;
          const arr = byTf[tf];
          const last = arr[arr.length - 1];
          if (!last || bucket > last.t) arr.push({ t: bucket, o: price, h: price, l: price, c: price });
          else {
            last.c = price;
            if (price > last.h) last.h = price;
            if (price < last.l) last.l = price;
          }
        }
      }
      if (Object.keys(byTf).length) this.market.replaceCandles(a.id, byTf);
      // resume the live chain where the replay ended
      this.chains.set(a.id, Object.assign(chain, { n: elapsed }));
    }
  }

  // Public audit data. Today's seed stays secret until the day closes;
  // everything already finished is revealed so it can be checked.
  fairness() {
    const today = dayKey(Date.now());
    const past = Object.keys(this.days)
      .filter((d) => d < today)
      .sort()
      .reverse()
      .slice(0, KEEP_DAYS)
      .map((d) => ({ date: d, commitment: this.days[d].commitment, seed: this.seedFor(d), open: this.days[d].open }));
    return {
      algorithm: {
        summary: 'price[n] = price[n-1] * (1 + g*vol + momentum + reversion), starting from the published open',
        prng: 'mulberry32 seeded with the first 8 hex chars of sha256(dailySeed + ":" + assetId)',
        gaussian: 'Box-Muller over two successive PRNG outputs',
        momentum: 'momentum = momentum*0.98 + g*vol*0.1, plus a +/- vol*2 burst when rng() < 0.001',
        reversion: 'reversion = (open - price)/open * 0.0015',
        dailySeed: 'HMAC-SHA256(masterSecret, "otc:" + YYYY-MM-DD)',
        commitment: 'SHA-256(dailySeed), published before the day begins',
        tickMs: TICK_MS,
        ticksPerDay: TICKS_PER_DAY,
        note: 'The series depends only on the seed, the asset id and the tick index. No user data is an input.',
      },
      today: { date: today, commitment: this.days[today]?.commitment, open: this.days[today]?.open },
      tomorrow: { date: dayKey(Date.now() + 86400000), commitment: this.commitmentFor(dayKey(Date.now() + 86400000)) },
      revealed: past,
    };
  }
}

module.exports = { OtcEngine, TICK_MS, TICKS_PER_DAY };
