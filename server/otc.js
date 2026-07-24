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
// OTC runs livelier than the real feed it stands in for. The drama comes from
// the v2 dynamics (storms, jumps, traps) rather than raw scale — tuned by
// simulation to a ~2.3% day range and 3x storm/calm contrast on EURUSD, with
// direction persistence and revert-to-open both at a coin flip.
const VOL_MULTIPLIER = 1.1;

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

// One OTC segment's price chain (algorithm v2). Deterministic given (seed,
// assetId, start, open, vol) — replaying it reproduces exactly what users
// traded against.
//
// v1 was too tame: one flat volatility level, and a constant pull back to the
// segment's opening price — which made "it always comes back" a winning bet.
// v2 layers four effects, every one drawn from the same seeded PRNG stream:
//   - regime machine: ranging / up-trend / down-trend spells (1-9 min)
//   - volatility clustering: calm stretches and 'storms' up to 4x base vol
//   - jumps: sudden 2-7x spikes, roughly every couple of minutes
//   - trend traps: a trend that abruptly reverses mid-run
// and reversion targets a slowly *drifting* anchor rather than the fixed
// open, so the path wanders instead of oscillating around one level.
class Chain {
  constructor(seedHex, assetId, start, open, vol) {
    const h = crypto.createHash('sha256').update(`${seedHex}:${assetId}:${start}`).digest('hex');
    this.rng = mulberry32(parseInt(h.slice(0, 8), 16));
    this.start = start;
    this.open = open;
    this.price = open;
    this.anchor = open;
    this.vol = vol;
    this.momentum = 0;
    this.volState = 1;  // volatility-clustering multiplier, bounded [0.35, 6]
    this.trend = 0;     // current regime: -1 down, 0 range, +1 up
    this.left = 0;      // ticks remaining in the current regime
    this.n = start;
  }

  // Parameters tuned by simulation (scratch tune.js sweep, set H3): full-day
  // EURUSD stats — day range ~2.3%, 1-min range median 0.076% / p95 0.23%
  // (storms 3.1x calm), drift-back-to-open 48%, direction persistence 48.6%.
  advance() {
    const rng = this.rng;
    // regime machine: pick ranging or a directional spell for the next 1-9min
    if (this.left <= 0) {
      const r = rng();
      this.trend = r < 0.45 ? 0 : r < 0.725 ? 1 : -1;
      this.left = 120 + Math.floor(rng() * 960);
      // one regime in five opens as a storm: volatility leaps immediately
      if (rng() < 0.2) this.volState = Math.min(6, this.volState + 3 + rng() * 3);
    }
    this.left--;

    const g = gaussFrom(rng);
    // volatility clustering: |g| feeds volState so violence begets violence,
    // decaying back toward a calm floor well below the old baseline — the
    // contrast between quiet and storm is what makes storms feel violent
    this.volState = Math.max(0.35, Math.min(6, this.volState * 0.988 + Math.abs(g) * 0.007));
    const v = this.vol * this.volState;

    // momentum: noise-driven with the regime's directional drift folded in
    this.momentum = Math.max(-3 * v, Math.min(3 * v,
      this.momentum * 0.95 + g * v * 0.05 + this.trend * v * 0.003));
    // trend trap: occasionally the run snaps and reverses hard
    if (rng() < 0.0025) { this.momentum = -this.momentum * (1.2 + rng()); this.trend = -this.trend; }
    // jump: a sudden outsized spike
    const jump = rng() < 0.004 ? (rng() < 0.5 ? -1 : 1) * v * (2 + rng() * 5) : 0;

    // reversion targets a drifting anchor, not the fixed open — keeps the
    // price from exploding without making its destination guessable
    this.anchor += (this.price - this.anchor) * 0.0008;
    const reversion = ((this.anchor - this.price) / this.anchor) * 0.0025;

    this.price = this.price * (1 + g * v + this.momentum + jump + reversion);
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
      segs.push({ asset: assetId, start, open, vol: v, end: null, algo: 2 });
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
        version: 2,
        summary: 'Within an OTC segment: price[n] = price[n-1] * (1 + g*v + momentum + jump + reversion), starting from the segment open. Segments record which algo version generated them.',
        prng: 'mulberry32 seeded with the first 8 hex chars of sha256(dailySeed + ":" + assetId + ":" + segmentStartTick); all draws below consume this single stream in the order listed',
        perTick: [
          'if regimeLeft <= 0: r = rng(); trend = r<0.45 ? 0 : r<0.725 ? +1 : -1; regimeLeft = 120 + floor(rng()*960); if rng() < 0.2 then volState = min(6, volState + 3 + rng()*3)',
          'regimeLeft -= 1',
          'g = Box-Muller gaussian over successive rng() pairs (draws discarded while zero)',
          'volState = clamp(volState*0.988 + |g|*0.007, 0.35, 6); v = segmentVol * volState',
          'momentum = clamp(momentum*0.95 + g*v*0.05 + trend*v*0.003, -3v, +3v)',
          'if rng() < 0.0025: momentum = -momentum*(1.2 + rng()); trend = -trend',
          'jump = rng() < 0.004 ? (rng() < 0.5 ? -1 : +1) * v * (2 + rng()*5) : 0',
          'anchor += (price - anchor)*0.0008; reversion = (anchor - price)/anchor * 0.0025',
          'price *= 1 + g*v + momentum + jump + reversion',
        ],
        initialState: 'price = anchor = segment open; momentum = 0; volState = 1; trend = 0; regimeLeft = 0',
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
