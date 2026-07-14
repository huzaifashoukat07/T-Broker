// IP → country lookup for user flags. Uses the free ipwho.is HTTPS API
// (no key), with an in-memory cache and a short timeout. Private/localhost
// IPs and failures fall back to the globe emoji.

const https = require('https');

let HttpsProxyAgent = null;
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch { /* optional */ }
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
const agent = proxyUrl && HttpsProxyAgent ? new HttpsProxyAgent(proxyUrl) : undefined;

const cache = new Map();

// ISO country code (e.g. "PK") -> flag emoji via regional indicator symbols.
function flagFromCC(cc) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

function isPrivate(ip) {
  return !ip || /^(::1|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(ip);
}

function lookupCountry(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (isPrivate(ip)) return Promise.resolve({ code: '', flag: '🌐' });
  if (cache.has(ip)) return Promise.resolve(cache.get(ip));
  return new Promise((resolve) => {
    const done = (out) => { cache.set(ip, out); resolve(out); };
    const req = https.get(`https://ipwho.is/${encodeURIComponent(ip)}`, { agent, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j && j.success !== false && j.country_code) {
            return done({ code: j.country_code, flag: flagFromCC(j.country_code) });
          }
        } catch { /* ignore */ }
        done({ code: '', flag: '🌐' });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ code: '', flag: '🌐' })); // don't cache failures
  });
}

module.exports = { lookupCountry, flagFromCC };
