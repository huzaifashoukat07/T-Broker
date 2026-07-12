// NovaTrade server: REST API + WebSocket live feed + trade settlement.

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const { Market, TIMEFRAMES } = require('./market');
const { LiveFeed } = require('./livefeed');
const { Store, ApiError } = require('./store');
const { sendOtp } = require('./mailer');

const PORT = process.env.PORT || 3000;
const MIN_TRADE = 1;
const MAX_TRADE = 5000;
const DURATIONS = [5, 10, 15, 30, 60, 120, 180, 300, 600]; // seconds

const market = new Market();
const store = new Store();
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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
  res.json({ token: store.issueToken(user.id), user: store.publicUser(user) });
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
  res.json({ assets: market.listAssets(), timeframes: TIMEFRAMES, durations: DURATIONS });
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

app.post('/api/deposit', auth, handle((req, res) => {
  const amt = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt < 10 || amt > 50000) throw new ApiError('Deposit must be between $10 and $50,000');
  store.adjust(req.user, 'live', amt);
  store.addTransaction(req.user, { type: 'deposit', amount: amt, method: req.body?.method || 'card' });
  res.json({ balances: store.balances(req.user) });
}));

app.post('/api/withdraw', auth, handle((req, res) => {
  const amt = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) throw new ApiError('Enter a valid amount');
  if (req.user.liveBalance < amt) throw new ApiError('Insufficient live balance');
  store.adjust(req.user, 'live', -amt);
  store.addTransaction(req.user, { type: 'withdrawal', amount: amt, method: req.body?.method || 'card' });
  res.json({ balances: store.balances(req.user) });
}));

app.post('/api/reset-demo', auth, handle((req, res) => {
  store.resetDemo(req.user);
  res.json({ balances: store.balances(req.user) });
}));

app.get('/api/transactions', auth, handle((req, res) => {
  res.json({ transactions: req.user.transactions });
}));

// --- leaderboard ---------------------------------------------------------------

const BOT_TRADERS = [
  'Viktor S.', 'Amara O.', 'Kenji T.', 'Lucia M.', 'Omar H.', 'Priya R.',
  'Mateo G.', 'Zanele K.', 'Ethan W.', 'Yulia P.', 'Rafael C.', 'Mei L.',
];
const botScores = BOT_TRADERS.map((name, i) => ({
  name,
  profit: Math.round((15000 / (i + 1) + Math.random() * 2000) * 100) / 100,
  country: ['🇩🇪', '🇳🇬', '🇯🇵', '🇪🇸', '🇦🇪', '🇮🇳', '🇦🇷', '🇿🇦', '🇺🇸', '🇺🇦', '🇧🇷', '🇨🇳'][i],
}));

app.get('/api/leaderboard', handle((req, res) => {
  const today = new Date().setHours(0, 0, 0, 0);
  const real = [...store.users.values()].map((u) => ({
    name: u.name,
    country: '🌐',
    profit: round2(u.trades
      .filter((t) => t.status === 'won' && t.openedAt >= today)
      .reduce((s, t) => s + t.profit, 0)),
  })).filter((r) => r.profit > 0);
  const board = [...botScores, ...real].sort((a, b) => b.profit - a.profit).slice(0, 20);
  res.json({ leaderboard: board });
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
    store.save();
    notifyUser(userId, { type: 'trade_settled', trade, balances: store.balances(user) });
  }
}

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

server.listen(PORT, () => {
  console.log(`NovaTrade running on http://localhost:${PORT}`);
});
