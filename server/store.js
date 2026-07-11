// User store: registration, login, balances, trades.
// Persists to data/db.json (debounced writes). Passwords hashed with scrypt,
// sessions are HMAC-signed tokens — no external auth dependencies.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DEMO_START_BALANCE = 10000;
const MAX_TRADES_KEPT = 300;

class Store {
  constructor() {
    this.users = new Map();
    this.secret = crypto.randomBytes(32).toString('hex');
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (raw.secret) this.secret = raw.secret;
      for (const u of raw.users || []) this.users.set(u.id, u);
    } catch {
      /* first run */
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify({ secret: this.secret, users: [...this.users.values()] }));
      } catch (e) {
        console.error('db save failed:', e.message);
      }
    }, 250);
    this.saveTimer.unref?.();
  }

  hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return `${salt}:${hash}`;
  }

  verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const check = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  }

  register(email, password, name) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Enter a valid email address');
    if (!password || String(password).length < 6) throw new ApiError('Password must be at least 6 characters');
    if (this.findByEmail(email)) throw new ApiError('An account with this email already exists');
    const user = {
      id: crypto.randomUUID(),
      email,
      name: String(name || '').trim() || email.split('@')[0],
      pass: this.hashPassword(String(password)),
      demoBalance: DEMO_START_BALANCE,
      liveBalance: 0,
      trades: [],
      transactions: [],
      createdAt: Date.now(),
    };
    this.users.set(user.id, user);
    this.save();
    return user;
  }

  login(email, password) {
    const user = this.findByEmail(String(email || '').trim().toLowerCase());
    if (!user || !this.verifyPassword(String(password || ''), user.pass)) {
      throw new ApiError('Incorrect email or password');
    }
    return user;
  }

  findByEmail(email) {
    for (const u of this.users.values()) if (u.email === email) return u;
    return null;
  }

  get(id) {
    return this.users.get(id) || null;
  }

  // --- Tokens -----------------------------------------------------------

  issueToken(userId) {
    const exp = Date.now() + 30 * 24 * 3600 * 1000;
    const body = `${userId}.${exp}`;
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verifyToken(token) {
    if (!token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [userId, exp, sig] = parts;
    const expect = crypto.createHmac('sha256', this.secret).update(`${userId}.${exp}`).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Number(exp) < Date.now()) return null;
    return this.users.get(userId) || null;
  }

  // --- Money ------------------------------------------------------------

  balances(user) {
    return { demo: round2(user.demoBalance), live: round2(user.liveBalance) };
  }

  adjust(user, account, delta) {
    const key = account === 'live' ? 'liveBalance' : 'demoBalance';
    user[key] = round2(user[key] + delta);
    this.save();
  }

  resetDemo(user) {
    user.demoBalance = DEMO_START_BALANCE;
    this.save();
  }

  addTransaction(user, tx) {
    user.transactions.unshift({ id: crypto.randomUUID(), time: Date.now(), ...tx });
    if (user.transactions.length > 100) user.transactions.length = 100;
    this.save();
  }

  addTrade(user, trade) {
    user.trades.unshift(trade);
    if (user.trades.length > MAX_TRADES_KEPT) user.trades.length = MAX_TRADES_KEPT;
    this.save();
  }

  publicUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      balances: this.balances(user),
      createdAt: user.createdAt,
    };
  }
}

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { Store, ApiError, DEMO_START_BALANCE };
