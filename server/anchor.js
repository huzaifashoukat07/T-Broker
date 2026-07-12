// Alpha Vantage price anchoring.
// The free tier allows ~25 requests/day, which is far too few to stream, so
// instead each non-crypto asset is re-anchored to its real market price about
// once a day: the whole candle history is rescaled to the real level and the
// simulator keeps ticking around it. Anchors persist across restarts so the
// daily quota isn't wasted.
//
// Enable with: ALPHAVANTAGE_KEY=<your key> npm start

const fs = require('fs');
const path = require('path');
const https = require('https');

let HttpsProxyAgent = null;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch { /* optional */ }

const KEY = process.env.ALPHAVANTAGE_KEY;
const BASE = process.env.ALPHAVANTAGE_URL || 'https://www.alphavantage.co';
const REFRESH_MS = 20 * 3600 * 1000;          // re-anchor each asset ~daily
const SPACING_MS = Number(process.env.ALPHAVANTAGE_SPACING_MS) || 20000; // free tier: max 5 req/min
const ANCHORS_FILE = path.join(__dirname, '..', 'data', 'anchors.json');

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
const agent = proxyUrl && HttpsProxyAgent ? new HttpsProxyAgent(proxyUrl) : undefined;

// Which platform assets map to which Alpha Vantage lookups.
const SOURCES = [
  { id: 'EURUSD', type: 'fx', from: 'EUR', to: 'USD' },
  { id: 'GBPUSD', type: 'fx', from: 'GBP', to: 'USD' },
  { id: 'USDJPY', type: 'fx', from: 'USD', to: 'JPY' },
  { id: 'AUDUSD', type: 'fx', from: 'AUD', to: 'USD' },
  { id: 'USDCAD', type: 'fx', from: 'USD', to: 'CAD' },
  { id: 'EURGBP', type: 'fx', from: 'EUR', to: 'GBP' },
  { id: 'XAUUSD', type: 'fx', from: 'XAU', to: 'USD' },
  { id: 'XAGUSD', type: 'fx', from: 'XAG', to: 'USD' },
  { id: 'AAPL', type: 'stock', symbol: 'AAPL' },
  { id: 'TSLA', type: 'stock', symbol: 'TSLA' },
  { id: 'AMZN', type: 'stock', symbol: 'AMZN' },
  { id: 'MSFT', type: 'stock', symbol: 'MSFT' },
  { id: 'UKBRENT', type: 'brent' },
];

function getJSON(url) {
  const lib = url.startsWith('https:') ? https : require('http');
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { agent: url.startsWith('https:') ? agent : undefined, timeout: 15000 }, (res) => {
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

class AnchorFeed {
  constructor(market, onAnchor) {
    this.market = market;
    this.onAnchor = onAnchor; // called with assetId after a live re-anchor
    this.anchors = {}; // assetId -> { price, at }
    this.stopped = false;
    try { this.anchors = JSON.parse(fs.readFileSync(ANCHORS_FILE, 'utf8')); } catch { /* first run */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(ANCHORS_FILE), { recursive: true });
      fs.writeFileSync(ANCHORS_FILE, JSON.stringify(this.anchors));
    } catch (e) {
      console.error('[anchor] save failed:', e.message);
    }
  }

  async start() {
    if (!KEY) {
      console.log('[anchor] ALPHAVANTAGE_KEY not set — forex/stock prices stay simulated (crypto is live via Binance)');
      return;
    }
    console.log('[anchor] Alpha Vantage anchoring enabled (each asset refreshed ~daily, free-tier friendly)');
    // re-apply persisted anchors immediately so restarts don't spend quota
    for (const [id, a] of Object.entries(this.anchors)) {
      if (Date.now() - a.at < REFRESH_MS) this.market.anchorPrice(id, a.price);
    }
    this.loop();
  }

  async loop() {
    while (!this.stopped) {
      const due = SOURCES.filter((s) => {
        const a = this.anchors[s.id];
        return !a || Date.now() - a.at >= REFRESH_MS;
      });
      for (const src of due) {
        if (this.stopped) return;
        try {
          const price = await this.fetchPrice(src);
          this.anchors[src.id] = { price, at: Date.now() };
          this.save();
          this.market.anchorPrice(src.id, price);
          this.onAnchor?.(src.id);
          console.log(`[anchor] ${src.id}: anchored to real price ${price}`);
        } catch (e) {
          if (/rate limit|premium|Note|Information/i.test(e.message)) {
            console.log(`[anchor] API limit reached (${e.message.slice(0, 80)}) — pausing until tomorrow`);
            await sleep(6 * 3600 * 1000);
            break;
          }
          console.log(`[anchor] ${src.id}: fetch failed (${e.message}) — will retry later`);
        }
        await sleep(SPACING_MS);
      }
      await sleep(30 * 60 * 1000); // check for due assets every 30 min
    }
  }

  async fetchPrice(src) {
    let url;
    if (src.type === 'fx') {
      url = `${BASE}/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${src.from}&to_currency=${src.to}&apikey=${KEY}`;
    } else if (src.type === 'stock') {
      url = `${BASE}/query?function=GLOBAL_QUOTE&symbol=${src.symbol}&apikey=${KEY}`;
    } else {
      url = `${BASE}/query?function=BRENT&interval=daily&apikey=${KEY}`;
    }
    const data = await getJSON(url);
    if (data.Note || data.Information) throw new Error(data.Note || data.Information);
    let price;
    if (src.type === 'fx') price = parseFloat(data['Realtime Currency Exchange Rate']?.['5. Exchange Rate']);
    else if (src.type === 'stock') price = parseFloat(data['Global Quote']?.['05. price']);
    else price = parseFloat((data.data || []).find((d) => d.value !== '.')?.value);
    if (!Number.isFinite(price) || price <= 0) throw new Error('no price in response');
    return price;
  }

  stop() {
    this.stopped = true;
  }
}

function sleep(ms) {
  return new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
}

module.exports = { AnchorFeed };
