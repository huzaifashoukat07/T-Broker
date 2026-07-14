// NovaTrade server: REST API + WebSocket live feed + trade settlement.

const path = require('path');
const http = require('http');
const crypto = require('crypto');

// Load .env (KEY=value lines) before any module reads process.env.
// Real environment variables take precedence over the file.
try {
  const envFile = require('fs').readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — that's fine */ }
const express = require('express');
const { WebSocketServer } = require('ws');

const { Market, TIMEFRAMES } = require('./market');
const { LiveFeed } = require('./livefeed');
const { AnchorFeed } = require('./anchor');
const { Store, ApiError } = require('./store');
const { sendOtp, sendWalletEmail } = require('./mailer');
const { buildLeaderboard } = require('./leaderboard');
const { lookupCountry } = require('./geo');

const PORT = process.env.PORT || 3000;
const MIN_TRADE = 1;
const MAX_TRADE = 5000;
const DURATIONS = [5, 10, 15, 30, 60, 120, 180, 300, 600]; // seconds

// Crypto deposit wallets. Addresses are env-overridable; QR codes are
// generated at startup so they always match the configured address.
const WALLETS = {
  bep20: {
    address: process.env.USDT_BEP20_ADDRESS || '0xb20e24e7215180475d861708253cca95c9b79747',
    name: 'USDT — BEP20',
    network: 'BNB Smart Chain (BEP20)',
  },
  trc20: {
    address: process.env.USDT_TRC20_ADDRESS || 'TDNoGsUQrVTG8XFi5c4Vwh746AJCd7EoVt',
    name: 'USDT — TRC20',
    network: 'Tron (TRC20)',
  },
};
const walletQr = {};
(async () => {
  try {
    const QRCode = require('qrcode');
    for (const [net, w] of Object.entries(WALLETS)) {
      walletQr[net] = await QRCode.toDataURL(w.address, { width: 440, margin: 2 });
    }
    console.log('[wallet] deposit QR codes generated for', Object.keys(walletQr).join(', '));
  } catch (e) {
    console.log(`[wallet] QR generation unavailable (${e.message}) — addresses shown as text only`);
  }
})();

const market = new Market();
const store = new Store();
const app = express();
app.set('trust proxy', true); // Render/proxies set X-Forwarded-For; read the real client IP
app.use(express.json());

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';

// Record a user's country (and last IP) from their request, once known.
function recordGeo(user, req) {
  user.lastIp = clientIp(req);
  if (user.country && user.country !== '🌐') return; // already resolved
  lookupCountry(user.lastIp).then(({ code, flag }) => {
    if (flag && flag !== '🌐') { user.country = flag; user.countryCode = code; store.save(user); }
  }).catch(() => {});
}
// no-cache: browsers revalidate every file (cheap 304s), so users always get
// the current frontend after the server is updated
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// SPA fallback: client-side routes (/login, /trade, /wallet, ...) all serve
// the app shell; the frontend router takes it from there. API/WS and real
// files (paths with an extension) are excluded.
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws') && !path.extname(req.path)) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// --- helpers ---------------------------------------------------------------

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = store.verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ApiError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// --- auth (two-step: password -> emailed OTP -> JWT) -------------------------

async function dispatchOtp(res, pending, purpose) {
  let emailSent = false;
  try {
    emailSent = await sendOtp(pending.email, pending.code, purpose);
  } catch (e) {
    console.error(`[mail] send failed: ${e.message}`);
    console.log(`[mail] ${purpose} code for ${pending.email}: ${pending.code}`);
  }
  res.json({ otpRequired: true, email: pending.email, emailSent });
}

app.post('/api/register', handle(async (req, res) => {
  const { email, password, name } = req.body || {};
  const pending = store.beginRegister(email, password, name);
  await dispatchOtp(res, pending, 'sign up');
}));

app.post('/api/login', handle(async (req, res) => {
  const { email, password } = req.body || {};
  const pending = store.beginLogin(email, password);
  await dispatchOtp(res, pending, 'login');
}));

app.post('/api/verify-otp', handle((req, res) => {
  const { email, code } = req.body || {};
  const user = store.verifyOtp(email, code);
  recordGeo(user, req); // set country from IP for new signups and existing users
  notifyAdmins(); // new signup / login → refresh the admin users list live
  res.json({ token: store.issueToken(user.id), user: store.publicUser(user) });
}));

// Forgot password: sends an OTP; new password applied on verify-otp.
// Always reports otpRequired so a missing account isn't revealed.
app.post('/api/forgot-password', handle(async (req, res) => {
  const { email, password } = req.body || {};
  const pending = store.beginReset(email, password);
  if (pending) {
    await dispatchOtp(res, pending, 'password reset');
  } else {
    res.json({ otpRequired: true, email: String(email || '').trim().toLowerCase(), emailSent: true });
  }
}));

app.post('/api/resend-otp', handle(async (req, res) => {
  const pending = store.resendOtp(req.body?.email);
  await dispatchOtp(res, pending, 'verification');
}));

app.get('/api/me', auth, handle((req, res) => {
  res.json({ user: store.publicUser(req.user) });
}));

// --- market data -------------------------------------------------------------

app.get('/api/assets', handle((req, res) => {
  res.json({
    assets: market.listAssets(),
    timeframes: TIMEFRAMES,
    durations: DURATIONS,
    wallets: Object.fromEntries(Object.entries(WALLETS).map(([net, w]) => [
      net, { ...w, qr: walletQr[net] || null },
    ])),
  });
}));

app.get('/api/candles', handle((req, res) => {
  const { asset, tf } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 600);
  const candles = market.candles(asset, Number(tf), limit);
  if (!candles) throw new ApiError('Unknown asset or timeframe');
  res.json({ candles });
}));

// --- trading -----------------------------------------------------------------

const openTrades = new Map(); // tradeId -> { trade, userId }

app.post('/api/trade', auth, handle((req, res) => {
  const { asset, direction, amount, duration, account } = req.body || {};
  const a = market.getAsset(asset);
  if (!a) throw new ApiError('Unknown asset');
  if (direction !== 'up' && direction !== 'down') throw new ApiError('Direction must be "up" or "down"');
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt < MIN_TRADE || amt > MAX_TRADE) {
    throw new ApiError(`Trade amount must be between $${MIN_TRADE} and $${MAX_TRADE}`);
  }
  const dur = Number(duration);
  if (!DURATIONS.includes(dur)) throw new ApiError('Invalid trade duration');
  const acct = account === 'live' ? 'live' : 'demo';
  const balance = acct === 'live' ? req.user.liveBalance : req.user.demoBalance;
  if (balance < amt) throw new ApiError('Insufficient balance');

  store.adjust(req.user, acct, -amt);
  const now = Date.now();
  const trade = {
    id: crypto.randomUUID(),
    asset: a.id,
    assetName: a.name,
    direction,
    amount: amt,
    account: acct,
    payout: a.payout,
    entryPrice: market.price(a.id),
    openedAt: now,
    expiresAt: now + dur * 1000,
    duration: dur,
    status: 'open',
    closePrice: null,
    profit: null,
  };
  store.addTrade(req.user, trade);
  openTrades.set(trade.id, { trade, userId: req.user.id });
  res.json({ trade, balances: store.balances(req.user) });
}));

app.get('/api/trades', auth, handle((req, res) => {
  const acct = req.query.account;
  let trades = req.user.trades;
  if (acct === 'demo' || acct === 'live') trades = trades.filter((t) => t.account === acct);
  res.json({ trades: trades.slice(0, 100) });
}));

// --- wallet ------------------------------------------------------------------

const DEPOSIT_METHODS = ['binance', 'usdt-bep20', 'usdt-trc20']; // card & bank: coming soon

// All deposits are real manual transfers (Binance Pay / USDT BEP20 / bank):
// the money lands in the operator's wallet, so balances are NEVER credited
// automatically — claiming to have paid must not mint balance. Requests are
// logged as pending and the admin credits them from the admin panel.
app.post('/api/deposit', auth, handle((req, res) => {
  const amt = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt < 10 || amt > 50000) throw new ApiError('Deposit must be between $10 and $50,000');
  const method = DEPOSIT_METHODS.includes(req.body?.method) ? req.body.method : 'binance';
  store.addTransaction(req.user, { type: 'deposit', amount: amt, method, status: 'pending' });
  notifyAdmins();
  res.json({ pending: true, balances: store.balances(req.user) });
}));

app.post('/api/withdraw', auth, handle((req, res) => {
  const amt = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) throw new ApiError('Enter a valid amount');
  if (req.user.liveBalance < amt) throw new ApiError('Insufficient live balance');
  const method = DEPOSIT_METHODS.includes(req.body?.method) ? req.body.method : 'binance';
  const binanceId = String(req.body?.binanceId || '').trim();
  const address = String(req.body?.address || '').trim();
  if (method === 'binance' && !/^[0-9]{6,15}$/.test(binanceId)) {
    throw new ApiError('Enter a valid Binance ID (the numeric ID from your Binance profile)');
  }
  if (method === 'usdt-bep20' && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new ApiError('Enter a valid BEP20 address (starts with 0x, 42 characters)');
  }
  if (method === 'usdt-trc20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw new ApiError('Enter a valid TRC20 address (starts with T, 34 characters)');
  }
  // Funds are held immediately; the payout is sent manually within 24–48h.
  store.adjust(req.user, 'live', -amt);
  store.addTransaction(req.user, {
    type: 'withdrawal', amount: amt, method, status: 'pending',
    ...(binanceId ? { binanceId } : {}),
    ...(address ? { address } : {}),
  });
  notifyAdmins();
  res.json({ balances: store.balances(req.user), pending: true });
}));

// --- admin: approve / reject deposit & withdrawal requests -------------------

function adminOnly(req, res, next) {
  if (!store.isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' });
  next();
}

// Lightweight counts for both tab badges (so both are correct on open).
app.get('/api/admin/summary', auth, adminOnly, handle((req, res) => {
  let pending = 0;
  for (const u of store.users.values()) {
    for (const tx of u.transactions) if (tx.status === 'pending') pending++;
  }
  res.json({ requests: pending, users: store.users.size });
}));

app.get('/api/admin/requests', auth, adminOnly, handle((req, res) => {
  const requests = [];
  for (const u of store.users.values()) {
    for (const tx of u.transactions) {
      if (tx.status === 'pending') requests.push({ ...tx, userId: u.id, email: u.email, name: u.name });
    }
  }
  requests.sort((a, b) => b.time - a.time);
  res.json({ requests });
}));

app.post('/api/admin/requests/:txId/:action', auth, adminOnly, handle((req, res) => {
  const { txId, action } = req.params;
  if (action !== 'approve' && action !== 'reject') throw new ApiError('Unknown action');
  let tx = null, user = null;
  for (const u of store.users.values()) {
    const found = u.transactions.find((t) => t.id === txId);
    if (found) { tx = found; user = u; break; }
  }
  if (!tx) throw new ApiError('Request not found', 404);
  if (tx.status !== 'pending') throw new ApiError('Request was already processed');

  if (action === 'approve') {
    tx.status = 'completed';
    if (tx.type === 'deposit') store.adjust(user, 'live', tx.amount); // credit now
    notifyUser(user.id, {
      type: 'wallet_update',
      balances: store.balances(user),
      kind: tx.type === 'deposit' ? 'win' : '',
      message: tx.type === 'deposit'
        ? `Deposit approved — $${tx.amount.toFixed(2)} added to your live account`
        : `Withdrawal of $${tx.amount.toFixed(2)} has been sent`,
    });
  } else {
    tx.status = 'rejected';
    if (tx.type === 'withdrawal') store.adjust(user, 'live', tx.amount); // release held funds
    notifyUser(user.id, {
      type: 'wallet_update',
      balances: store.balances(user),
      kind: 'loss',
      message: `Your ${tx.type} request of $${tx.amount.toFixed(2)} was rejected`,
    });
  }
  store.save(user);

  // Email the user (fire-and-forget so the admin action isn't blocked).
  sendWalletEmail(user.email, `${tx.type}-${action === 'approve' ? 'approved' : 'rejected'}`, {
    amount: tx.amount, method: tx.method, address: tx.address, binanceId: tx.binanceId,
    balance: user.liveBalance,
  }).catch((e) => console.error(`[mail] wallet email failed: ${e.message}`));

  notifyAdmins();
  res.json({ ok: true });
}));

// --- admin: user management -------------------------------------------------

app.get('/api/admin/users', auth, adminOnly, handle((req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const users = [...store.users.values()]
    .filter((u) => !q || u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((u) => {
      const wins = u.trades.filter((t) => t.status === 'won').length;
      const losses = u.trades.filter((t) => t.status === 'lost').length;
      const pending = u.transactions.filter((t) => t.status === 'pending').length;
      const deposited = u.transactions
        .filter((t) => t.type === 'deposit' && t.status === 'completed')
        .reduce((s, t) => s + t.amount, 0);
      return {
        id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
        country: u.country || '🌐', countryCode: u.countryCode || '', lastIp: u.lastIp || '',
        demo: round2(u.demoBalance), live: round2(u.liveBalance),
        trades: u.trades.length, wins, losses, pending, deposited: round2(deposited),
        isAdmin: store.isAdmin(u),
      };
    });
  res.json({ users, count: users.length });
}));

// Adjust a user's balance directly (credit or debit). delta may be negative.
app.post('/api/admin/users/:userId/adjust', auth, adminOnly, handle((req, res) => {
  const user = store.get(req.params.userId);
  if (!user) throw new ApiError('User not found', 404);
  const account = req.body?.account === 'demo' ? 'demo' : 'live';
  const delta = Math.round(Number(req.body?.delta) * 100) / 100;
  if (!Number.isFinite(delta) || delta === 0) throw new ApiError('Enter a non-zero amount');
  const current = account === 'live' ? user.liveBalance : user.demoBalance;
  if (current + delta < 0) throw new ApiError('Adjustment would make the balance negative');
  store.adjust(user, account, delta);
  store.addTransaction(user, {
    type: delta > 0 ? 'deposit' : 'withdrawal',
    amount: Math.abs(delta), method: 'admin', status: 'completed',
  });
  notifyUser(user.id, {
    type: 'wallet_update', balances: store.balances(user),
    kind: delta > 0 ? 'win' : 'loss',
    message: `An admin ${delta > 0 ? 'credited' : 'debited'} $${Math.abs(delta).toFixed(2)} ${delta > 0 ? 'to' : 'from'} your ${account} account`,
  });
  res.json({ ok: true, balances: store.balances(user) });
}));

app.post('/api/reset-demo', auth, handle((req, res) => {
  store.resetDemo(req.user);
  res.json({ balances: store.balances(req.user) });
}));

app.get('/api/transactions', auth, handle((req, res) => {
  res.json({ transactions: req.user.transactions });
}));

// --- leaderboard ---------------------------------------------------------------

// Sum of a user's settled LIVE trade P&L since local midnight (won: +profit,
// lost: -amount, draw: 0). Used for both the leaderboard and today's P&L.
function todayLivePnl(user) {
  const today = new Date().setHours(0, 0, 0, 0);
  return round2(user.trades
    .filter((t) => t.account === 'live' && t.openedAt >= today && t.profit != null)
    .reduce((s, t) => s + t.profit, 0));
}

// Optional auth: a logged-in user is ranked; real users are never listed.
app.get('/api/leaderboard', handle((req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = store.verifyToken(token);
  const profit = user ? todayLivePnl(user) : 0;
  res.json(buildLeaderboard(Date.now(), user ? user.name : null, profit, user ? user.country : null));
}));

function round2(n) { return Math.round(n * 100) / 100; }

// --- websocket ---------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sockets = new Map(); // ws -> { userId }

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const user = store.verifyToken(url.searchParams.get('token'));
  sockets.set(ws, { userId: user ? user.id : null });
  ws.on('close', () => sockets.delete(ws));
  ws.on('error', () => sockets.delete(ws));
});

function wsSend(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function notifyUser(userId, msg) {
  for (const [ws, meta] of sockets) if (meta.userId === userId) wsSend(ws, msg);
}

function broadcastAll(msg) {
  const raw = JSON.stringify(msg);
  for (const ws of sockets.keys()) if (ws.readyState === ws.OPEN) ws.send(raw);
}

// Push a live refresh to any connected admins (used by the admin panel).
function notifyAdmins() {
  const raw = JSON.stringify({ type: 'admin_refresh' });
  for (const [ws, meta] of sockets) {
    if (ws.readyState !== ws.OPEN || !meta.userId) continue;
    const u = store.get(meta.userId);
    if (u && store.isAdmin(u)) ws.send(raw);
  }
}

// Broadcast ticks to everyone; settle expired trades on each tick.
market.onTick((payload) => {
  const msg = JSON.stringify({ type: 'ticks', ...payload });
  for (const ws of sockets.keys()) if (ws.readyState === ws.OPEN) ws.send(msg);
  settleExpired();
});

function settleExpired() {
  const now = Date.now();
  for (const [id, { trade, userId }] of openTrades) {
    if (trade.expiresAt > now) continue;
    openTrades.delete(id);
    const user = store.get(userId);
    if (!user) continue;
    const closePrice = market.price(trade.asset);
    trade.closePrice = closePrice;
    const wonUp = trade.direction === 'up' && closePrice > trade.entryPrice;
    const wonDown = trade.direction === 'down' && closePrice < trade.entryPrice;
    if (closePrice === trade.entryPrice) {
      trade.status = 'draw';
      trade.profit = 0;
      store.adjust(user, trade.account, trade.amount); // refund
    } else if (wonUp || wonDown) {
      trade.status = 'won';
      trade.profit = round2(trade.amount * trade.payout);
      store.adjust(user, trade.account, trade.amount + trade.profit);
    } else {
      trade.status = 'lost';
      trade.profit = -trade.amount;
    }
    store.save(user);
    notifyUser(userId, { type: 'trade_settled', trade, balances: store.balances(user), pnlToday: todayLivePnl(user) });
  }
}

(async () => {
  // Connect storage first (MongoDB when configured, JSON file otherwise).
  await store.init();

  // Restore any trades that were still open when the server last stopped.
  for (const user of store.users.values()) {
    for (const trade of user.trades) {
      if (trade.status === 'open') openTrades.set(trade.id, { trade, userId: user.id });
    }
  }

  market.start();

  // Real crypto prices from Binance, with automatic fallback to simulation.
  const liveFeed = new LiveFeed(market);
  liveFeed.start().catch((e) => console.log(`[livefeed] disabled: ${e.message}`));

  // Daily real-price anchoring for forex/metals/stocks via Alpha Vantage.
  // Connected charts are told to reload when an asset's history is rescaled.
  const anchorFeed = new AnchorFeed(market, (assetId) => broadcastAll({ type: 'candles_changed', asset: assetId }), store);
  anchorFeed.start().catch((e) => console.log(`[anchor] disabled: ${e.message}`));

  server.listen(PORT, () => {
    console.log(`NovaTrade running on http://localhost:${PORT}`);
  });
})();
