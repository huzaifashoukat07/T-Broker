// User store: registration, login, balances, trades.
// Persists to data/db.json (debounced writes). Passwords hashed with scrypt,
// sessions are JWTs; signups/logins are confirmed with an emailed OTP code.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 45 * 1000;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DEMO_START_BALANCE = 10000;
const MAX_TRADES_KEPT = 300;

class Store {
  constructor() {
    this.users = new Map();
    this.secret = crypto.randomBytes(32).toString('hex');
    this.saveTimer = null;
    this.pendingAuth = new Map(); // email -> { type, code, expires, attempts, lastSentAt, ... }
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

  // --- OTP-verified signup / login ---------------------------------------
  // Step 1: beginRegister/beginLogin validate credentials and stash a pending
  //         request keyed by email, returning the OTP code to send.
  // Step 2: verifyOtp checks the code and completes the action.

  beginRegister(email, password, name) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Enter a valid email address');
    if (!password || String(password).length < 6) throw new ApiError('Password must be at least 6 characters');
    if (this.findByEmail(email)) throw new ApiError('An account with this email already exists');
    return this.createPending(email, {
      type: 'register',
      name: String(name || '').trim() || email.split('@')[0],
      pass: this.hashPassword(String(password)),
    });
  }

  beginLogin(email, password) {
    email = String(email || '').trim().toLowerCase();
    const user = this.findByEmail(email);
    if (!user || !this.verifyPassword(String(password || ''), user.pass)) {
      throw new ApiError('Incorrect email or password');
    }
    return this.createPending(email, { type: 'login', userId: user.id });
  }

  createPending(email, data) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.pendingAuth.set(email, {
      ...data,
      code,
      expires: Date.now() + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: Date.now(),
    });
    return { email, code };
  }

  resendOtp(email) {
    email = String(email || '').trim().toLowerCase();
    const pending = this.pendingAuth.get(email);
    if (!pending) throw new ApiError('No pending verification for this email — start over');
    if (Date.now() - pending.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      throw new ApiError('Please wait a moment before requesting another code');
    }
    pending.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    pending.expires = Date.now() + OTP_TTL_MS;
    pending.attempts = 0;
    pending.lastSentAt = Date.now();
    return { email, code: pending.code };
  }

  verifyOtp(email, code) {
    email = String(email || '').trim().toLowerCase();
    const pending = this.pendingAuth.get(email);
    if (!pending) throw new ApiError('No pending verification for this email — start over');
    if (Date.now() > pending.expires) {
      this.pendingAuth.delete(email);
      throw new ApiError('This code has expired — request a new one');
    }
    pending.attempts++;
    if (pending.attempts > OTP_MAX_ATTEMPTS) {
      this.pendingAuth.delete(email);
      throw new ApiError('Too many wrong attempts — start over');
    }
    const given = String(code || '').trim();
    const ok = given.length === 6 &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pending.code));
    if (!ok) throw new ApiError('Incorrect code — check your email and try again');
    this.pendingAuth.delete(email);

    if (pending.type === 'register') {
      const user = {
        id: crypto.randomUUID(),
        email,
        name: pending.name,
        pass: pending.pass,
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
    const user = this.users.get(pending.userId);
    if (!user) throw new ApiError('Account no longer exists');
    return user;
  }

  findByEmail(email) {
    for (const u of this.users.values()) if (u.email === email) return u;
    return null;
  }

  get(id) {
    return this.users.get(id) || null;
  }

  // --- JWT session tokens -------------------------------------------------

  issueToken(userId) {
    return jwt.sign({ sub: userId }, this.secret, { expiresIn: '30d', issuer: 'novatrade' });
  }

  verifyToken(token) {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.secret, { issuer: 'novatrade' });
      return this.users.get(payload.sub) || null;
    } catch {
      return null;
    }
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
