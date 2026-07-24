// OTC mode — the synthetic fallback every asset drops into whenever real
// market data isn't available: weekends, exchange closing hours, an exhausted
// API quota, or a feed outage. It is not a separate set of instruments; the
// same EUR/USD simply trades as "EUR/USD OTC" while its feed is down, exactly
// like the big binary brokers do.
//
// FAIRNESS INVARIANT (do not break this):
//   A segment's price path is a pure function of (daily seed, asset id,
//   segment start tick, opening price). It NEVER reads balances, open trades,
//   direction, stake or any other user state. Nothing here may take a user as
//   input. The house edge comes from the payout being below 100% on a roughly
//   50/50 outcome — not from moving the price against anyone.
//
// The daily seed is derived from a master secret via HMAC, so:
//   - SHA-256(seed) is published *in advance* as a commitment,
//   - the seed is revealed once the day is over,
//   - each OTC segment records its start tick and opening price,
// which together let anyone regenerate the exact prices that traded and check
// them against the commitment they were shown beforehand. Revealing one day's
// seed never exposes the master secret, so future days stay unpredictable.

const crypto = require('crypto');

const TICK_MS = 500;
const TICKS_PER_DAY = (24 * 60 * 60 * 1000) / TICK_MS; // 172800
const KEEP_DAYS = 30;          // days of seeds/segments retained for audit
const MAX_SEGMENTS_PER_DAY = 400;
// OTC runs a little livelier than the real feed it stands in for, so charts
// don't visibly go quiet when a market closes.
const VOL_MULTIPLIER = 1.25;

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

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10); // UTC date
const dayStartMs = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`);

// One OTC segment's price chain. Deterministic given (seed, assetId, start,
// open, vol) — replaying it reproduces exactly what users traded against.
class Chain {
  constructor(seedHex, assetId, start, open, vol) {
    const h = crypto.createHash('sha256').update(`${seedHex}:${assetId}:${start}`).digest('hex');
    this.rng = mulberry32(parseInt(h.slice(0, 8), 16));
    this.start = start;
    this.open = open;
    this.price = open;
    this.vol = vol;
    this.momentum = 0;
    this.n = start;
  }

  advance() {
    const r = gaussFrom(this.rng);
    this.momentum = this.momentum * 0.98 + r * this.vol * 0.1;
    // occasional bursts, then a pull back toward the segment's open so the
    // series stays in a believable range instead of wandering off
    if (this.rng() < 0.001) this.momentum += (this.rng() < 0.5 ? -1 : 1) * this.vol * 2;
    const reversion = ((this.open - this.price) / this.open) * 0.0015;
    this.price = this.price * (1 + r * this.vol + this.momentum + reversion);
    this.n++;
    return this.price;
  }
}

class OtcEngine {
  constructor(market, store) {
    this.market = market;
    this.store = store;
    this.chains = new Map(); // assetId -> Chain (only while in OTC mode)
    this.days = {};          // 'YYYY-MM-DD' -> { commitment, segments: [] }
    this.date = null;
    this.master = null;
    this.saveTimer = null;
  }

  async init() {
    await this.load();
    this.ensureDay(dayKey(Date.now()));
    this.market.setOtcEngine(this);
    console.log('[otc] fallback engine ready — assets trade as OTC whenever their live feed is unavailable');
  }

  // Master secret: env var wins, otherwise generated once and persisted so
  // published commitments stay verifiable across restarts and deploys.
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
      console.log('[otc] generated a master secret — set OTC_MASTER_SECRET to keep commitments stable across redeploys');
    }
    this.persist();
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 1000);
    this.saveTimer.unref?.();
  }

  async flush() {
    const meta = this.store?.db?.collection('meta');
    if (!meta) return;
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

  ensureDay(dateStr) {
    this.date = dateStr;
    const rec = this.days[dateStr];
    if (!rec) {
      this.days[dateStr] = { commitment: this.commitmentFor(dateStr), segments: [] };
      this.persist();
    } else if (!Array.isArray(rec.segments)) {
      // Records persisted by an earlier version of this engine have no
      // segments array — bring them forward rather than crashing on them.
      rec.segments = [];
      this.persist();
    }
  }

  tickIndex(ms) {
    return Math.floor((ms - dayStartMs(this.date)) / TICK_MS);
  }

  // Enter OTC mode for an asset, continuing from whatever price it last
  // traded at so the switch doesn't jump the chart.
  enter(assetId, openPrice, vol) {
    const now = Date.now();
    this.ensureDay(dayKey(now));
    const start = Math.min(this.tickIndex(now), TICKS_PER_DAY - 1);
    const open = Number.isFinite(openPrice) && openPrice > 0 ? openPrice : 1;
    const v = (Number.isFinite(vol) && vol > 0 ? vol : 0.0001) * VOL_MULTIPLIER;
    this.chains.set(assetId, new Chain(this.seedFor(this.date), assetId, start, open, v));
    const segs = this.days[this.date]?.segments;
    if (Array.isArray(segs) && segs.length < MAX_SEGMENTS_PER_DAY) {
      segs.push({ asset: assetId, start, open, vol: v, end: null });
      this.persist();
    }
    console.log(`[otc] ${assetId}: live feed unavailable — trading as OTC from ${open}`);
  }

  // Leave OTC mode: the real feed has come back and takes over again.
  release(assetId) {
    if (!this.chains.has(assetId)) return;
    const chain = this.chains.get(assetId);
    this.chains.delete(assetId);
    const seg = [...(this.days[this.date]?.segments || [])].reverse()
      .find((s) => s.asset === assetId && s.end === null);
    if (seg) {
      seg.end = chain.n;
      this.persist();
    }
    console.log(`[otc] ${assetId}: live feed restored — leaving OTC mode`);
  }

  isActive(assetId) {
    return this.chains.has(assetId);
  }

  // Advance an asset's chain to the current wall-clock tick, recording EVERY
  // tick into the candles so the served series is exactly the published one.
  drive(assetId) {
    const now = Date.now();
    if (dayKey(now) !== this.date) {
      // Midnight UTC: close the segment and restart under the new day's seed,
      // carrying the price forward.
      const prev = this.chains.get(assetId);
      if (!prev) return null; // not in OTC mode; the tick loop will re-enter
      const { price, vol } = prev;
      this.release(assetId);
      this.ensureDay(dayKey(now));
      this.enter(assetId, price, vol / VOL_MULTIPLIER);
    }
    const chain = this.chains.get(assetId);
    if (!chain) return null;
    const target = Math.min(this.tickIndex(now), TICKS_PER_DAY);
    const start = dayStartMs(this.date);
    while (chain.n < target) {
      const n = chain.n; // index of the tick about to be produced
      const price = chain.advance();
      this.market.applyOtcTick(assetId, price, Math.floor((start + n * TICK_MS) / 1000));
    }
    return chain.price;
  }

  // Public audit trail. Today's seed stays secret until the day closes;
  // finished days are revealed so their prices can be regenerated and checked.
  fairness() {
    const today = dayKey(Date.now());
    const past = Object.keys(this.days)
      .filter((d) => d < today)
      .sort().reverse().slice(0, KEEP_DAYS)
      .map((d) => ({
        date: d,
        commitment: this.days[d].commitment,
        seed: this.seedFor(d),
        segments: this.days[d].segments,
      }));
    return {
      algorithm: {
        summary: 'Within an OTC segment: price[n] = price[n-1] * (1 + g*vol + momentum + reversion), starting from the segment open',
        prng: 'mulberry32 seeded with the first 8 hex chars of sha256(dailySeed + ":" + assetId + ":" + segmentStartTick)',
        gaussian: 'Box-Muller over two successive PRNG outputs',
        momentum: 'momentum = momentum*0.98 + g*vol*0.1, plus a +/- vol*2 burst when rng() < 0.001',
        reversion: 'reversion = (open - price)/open * 0.0015',
        dailySeed: 'HMAC-SHA256(masterSecret, "otc:" + YYYY-MM-DD)',
        commitment: 'SHA-256(dailySeed), published before the day begins',
        tickMs: TICK_MS,
        ticksPerDay: TICKS_PER_DAY,
        volMultiplier: VOL_MULTIPLIER,
        note: 'A segment depends only on the seed, the asset id, its start tick and its opening price. No user data is an input.',
      },
      today: {
        date: today,
        commitment: this.days[today]?.commitment,
        segments: this.days[today]?.segments || [],
        activeNow: [...this.chains.keys()],
      },
      tomorrow: {
        date: dayKey(Date.now() + 86400000),
        commitment: this.commitmentFor(dayKey(Date.now() + 86400000)),
      },
      revealed: past,
    };
  }
}

module.exports = { OtcEngine, TICK_MS, TICKS_PER_DAY };
