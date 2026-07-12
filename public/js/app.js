// NovaTrade frontend application logic.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  token: localStorage.getItem('tb_token'),
  user: null,
  account: localStorage.getItem('tb_account') || 'demo',
  assets: [],
  durations: [60],
  timeframes: [60],
  asset: null,
  tf: 5,
  amount: 10,
  durationIdx: 0,
  trades: [],
  tradesTab: 'open',
  ws: null,
  prices: {}, // assetId -> { price, dir }
};

const chart = new CandleChart($('#chart'));

// ---------------------------------------------------------------- api

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------- auth
// Two-step: email + password, then a 6-digit OTP emailed to the user.

let authMode = 'login';
let otpStage = false;
let otpEmail = '';
let resendTimer = null;

$$('.auth-tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    authMode = btn.dataset.tab;
    $$('.auth-tab').forEach((b) => b.classList.toggle('active', b === btn));
    $('#field-name').classList.toggle('hidden', authMode === 'login');
    $('#auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    setOtpStage(false);
  })
);

function setOtpStage(on, email, emailSent) {
  otpStage = on;
  $('#step-creds').classList.toggle('hidden', on);
  $('#step-otp').classList.toggle('hidden', !on);
  $('#auth-submit').textContent = on ? 'Verify code' : authMode === 'login' ? 'Log in' : 'Create account';
  $('#auth-error').classList.add('hidden');
  if (on) {
    otpEmail = email;
    $('#otp-email').textContent = email;
    $('#otp-dev').classList.toggle('hidden', !!emailSent);
    $('#auth-otp').value = '';
    $('#auth-otp').focus();
    startResendCooldown();
  } else {
    clearInterval(resendTimer);
  }
}

function startResendCooldown() {
  clearInterval(resendTimer);
  const btn = $('#otp-resend');
  let left = 45;
  btn.disabled = true;
  btn.textContent = `Resend code (${left}s)`;
  resendTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(resendTimer);
      btn.disabled = false;
      btn.textContent = 'Resend code';
    } else {
      btn.textContent = `Resend code (${left}s)`;
    }
  }, 1000);
}

function showAuthError(message) {
  const el = $('#auth-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit');
  btn.disabled = true;
  try {
    if (!otpStage) {
      const body = {
        email: $('#auth-email').value,
        password: $('#auth-password').value,
        name: $('#auth-name').value,
      };
      const data = await api(authMode === 'login' ? '/api/login' : '/api/register', { body });
      if (data.otpRequired) setOtpStage(true, data.email, data.emailSent);
    } else {
      const data = await api('/api/verify-otp', { body: { email: otpEmail, code: $('#auth-otp').value } });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('tb_token', data.token);
      clearInterval(resendTimer);
      navigate('/trade', true);
    }
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#otp-back').addEventListener('click', () => setOtpStage(false));

$('#otp-resend').addEventListener('click', async () => {
  try {
    const data = await api('/api/resend-otp', { body: { email: otpEmail } });
    $('#otp-dev').classList.toggle('hidden', !!data.emailSent);
    startResendCooldown();
  } catch (err) {
    showAuthError(err.message);
  }
});

// auto-submit when 6 digits are typed
$('#auth-otp').addEventListener('input', () => {
  const v = $('#auth-otp').value.replace(/\D/g, '').slice(0, 6);
  $('#auth-otp').value = v;
  if (v.length === 6) $('#auth-form').requestSubmit();
});

function logout() {
  localStorage.removeItem('tb_token');
  location.href = '/login';
}

// ---------------------------------------------------------------- router
// Every page has a URL and an auth check: guests are sent to /login,
// signed-in users are kept out of /login, unknown paths fall back to /trade.

const MODAL_ROUTES = {
  '/wallet': () => showTransactions(),
  '/top': () => showLeaderboard(),
  '/help': () => openModal('#help-modal'),
  '/deposit': () => openModal('#deposit-modal'),
  '/withdraw': () => openModal('#withdraw-modal'),
};
const TITLES = {
  '/login': 'Log in',
  '/trade': 'Trade',
  '/wallet': 'Transactions',
  '/top': 'Top traders',
  '/help': 'How to trade',
  '/deposit': 'Deposit',
  '/withdraw': 'Withdrawal',
};

let appEntered = false;

function navigate(path, replace = false) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  renderRoute();
}

function renderRoute() {
  let path = location.pathname;
  const authed = !!state.user;

  // guards
  if (!authed && path !== '/login') {
    history.replaceState({}, '', '/login');
    path = '/login';
  } else if (authed && (path === '/login' || path === '/')) {
    history.replaceState({}, '', '/trade');
    path = '/trade';
  } else if (authed && path !== '/trade' && !MODAL_ROUTES[path]) {
    history.replaceState({}, '', '/trade'); // unknown page -> trade screen
    path = '/trade';
  }

  document.title = `${TITLES[path] || 'Trade'} — NovaTrade`;

  if (path === '/login') {
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    return;
  }

  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (!appEntered) {
    appEntered = true;
    enterApp();
  }
  closeModals();
  if (MODAL_ROUTES[path]) MODAL_ROUTES[path]();
}

window.addEventListener('popstate', renderRoute);

// closing a routed modal returns to /trade; plain modals just close
function dismissModals() {
  if (state.user && MODAL_ROUTES[location.pathname]) navigate('/trade');
  else closeModals();
}

// ---------------------------------------------------------------- boot

async function boot() {
  const meta = await api('/api/assets');
  state.assets = meta.assets;
  state.durations = meta.durations;
  state.timeframes = meta.timeframes;
  state.durationIdx = Math.max(0, meta.durations.indexOf(60));
  state.asset = state.assets.find((a) => a.id === localStorage.getItem('tb_asset')) || state.assets[0];
  state.tf = Number(localStorage.getItem('tb_tf')) || meta.timeframes[0];

  if (state.token) {
    try {
      const { user } = await api('/api/me');
      state.user = user;
    } catch {
      localStorage.removeItem('tb_token');
      state.token = null;
    }
  }
  renderRoute();
}

async function enterApp() {
  $('#avatar').textContent = (state.user.name || 'T')[0].toUpperCase();
  $('#um-name').textContent = state.user.name;
  $('#um-email').textContent = state.user.email;
  renderBalances(state.user.balances);
  renderTfButtons();
  renderAssetHeader();
  updateProfitPreview();
  renderTimeValue();
  connectWS();
  await Promise.all([loadCandles(), loadTrades()]);
}

// ---------------------------------------------------------------- websocket

function connectWS() {
  if (state.ws) { try { state.ws.onclose = null; state.ws.close(); } catch {} }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;
  ws.onopen = () => {
    state.lastTickAt = Date.now();
    // catch up on any candles missed while disconnected (sleep, network blip)
    if (state.wsWasConnected && state.asset) loadCandles();
    state.wsWasConnected = true;
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ticks') { state.lastTickAt = Date.now(); onTicks(msg); }
    else if (msg.type === 'trade_settled') onTradeSettled(msg);
    else if (msg.type === 'candles_changed' && state.asset && msg.asset === state.asset.id) loadCandles();
  };
  ws.onclose = () => setTimeout(() => { if (!document.hidden) connectWS(); }, 1500);
}

// Frozen-chart protection: reconnect as soon as the tab becomes visible
// again, and force a reconnect if the tick stream goes quiet.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.user) return;
  if (!state.ws || state.ws.readyState > WebSocket.OPEN) connectWS();
});
setInterval(() => {
  if (document.hidden || !state.user || !state.ws) return;
  if (state.ws.readyState === WebSocket.OPEN && Date.now() - (state.lastTickAt || 0) > 10000) {
    connectWS(); // stream stalled — reconnect refreshes candles on open
  }
}, 5000);

function onTicks(msg) {
  for (const t of msg.ticks) {
    state.prices[t.asset] = t;
    const a = state.assets.find((x) => x.id === t.asset);
    if (a && a.live !== t.live) {
      a.live = t.live;
      if (a === state.asset) renderAssetHeader();
    }
    if (state.asset && t.asset === state.asset.id) {
      chart.tick(t.price, msg.time, t.dir);
      const el = $('#chart-price');
      el.textContent = t.price.toFixed(state.asset.decimals);
      el.className = 'chart-price ' + (t.dir > 0 ? 'up' : t.dir < 0 ? 'down' : '');
    }
  }
  refreshAssetModalPrices();
}

function onTradeSettled(msg) {
  const idx = state.trades.findIndex((t) => t.id === msg.trade.id);
  if (idx >= 0) state.trades[idx] = msg.trade;
  else state.trades.unshift(msg.trade);
  renderBalances(msg.balances);
  renderTrades();
  syncChartTrades();
  const t = msg.trade;
  if (t.status === 'won') {
    toast('win', `You won $${(t.amount + t.profit).toFixed(2)}!`, `${t.assetName} · ${t.direction.toUpperCase()} · +$${t.profit.toFixed(2)} profit`);
  } else if (t.status === 'lost') {
    toast('loss', `Trade lost`, `${t.assetName} · ${t.direction.toUpperCase()} · −$${t.amount.toFixed(2)}`);
  } else {
    toast('', `Draw — stake refunded`, `${t.assetName} closed at the entry price`);
  }
}

// ---------------------------------------------------------------- chart data

async function loadCandles() {
  const { candles } = await api(`/api/candles?asset=${state.asset.id}&tf=${state.tf}&limit=400`);
  chart.setData(candles, state.asset.decimals, state.tf);
  syncChartTrades();
}

function renderTfButtons() {
  const wrap = $('#tf-group');
  wrap.innerHTML = '';
  for (const tf of state.timeframes) {
    const btn = document.createElement('button');
    btn.className = 'tf-btn' + (tf === state.tf ? ' active' : '');
    btn.textContent = tf < 60 ? `${tf}s` : `${tf / 60}m`;
    btn.addEventListener('click', () => {
      state.tf = tf;
      localStorage.setItem('tb_tf', tf);
      renderTfButtons();
      loadCandles();
    });
    wrap.appendChild(btn);
  }
}

function syncChartTrades() {
  chart.setTrades(state.trades.filter((t) => t.status === 'open' && t.asset === state.asset.id && t.account === state.account));
}

// ---------------------------------------------------------------- asset switching

function renderAssetHeader() {
  $('#asset-btn-name').textContent = state.asset.name;
  $('#asset-live').classList.toggle('hidden', !state.asset.live);
  $('#asset-btn-payout').textContent = Math.round(state.asset.payout * 100) + '%';
  $('#panel-asset-name').textContent = state.asset.name;
  $('#panel-payout').textContent = Math.round(state.asset.payout * 100) + '%';
  updateProfitPreview();
}

function selectAsset(asset) {
  state.asset = asset;
  localStorage.setItem('tb_asset', asset.id);
  renderAssetHeader();
  loadCandles();
  closeModals();
}

function renderAssetList(filter = '') {
  const wrap = $('#asset-list');
  wrap.innerHTML = '';
  const q = filter.trim().toLowerCase();
  const groups = {};
  for (const a of state.assets) {
    if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) continue;
    (groups[a.group] = groups[a.group] || []).push(a);
  }
  for (const [group, assets] of Object.entries(groups)) {
    const label = document.createElement('div');
    label.className = 'asset-group-label';
    label.textContent = group;
    wrap.appendChild(label);
    for (const a of assets) {
      const row = document.createElement('div');
      row.className = 'asset-row' + (a.id === state.asset.id ? ' active' : '');
      row.innerHTML = `
        <span class="asset-row-name">${a.name}${a.live ? ' <span class="live-badge">● LIVE</span>' : ''}</span>
        <span class="asset-row-price" data-price="${a.id}">${(state.prices[a.id]?.price ?? a.price).toFixed(a.decimals)}</span>
        <span class="asset-row-payout">${Math.round(a.payout * 100)}%</span>`;
      row.addEventListener('click', () => selectAsset(a));
      wrap.appendChild(row);
    }
  }
}

function refreshAssetModalPrices() {
  if ($('#asset-modal').classList.contains('hidden')) return;
  for (const el of $$('[data-price]')) {
    const a = state.assets.find((x) => x.id === el.dataset.price);
    const p = state.prices[a.id];
    if (p) el.textContent = p.price.toFixed(a.decimals);
  }
}

// ---------------------------------------------------------------- trade controls

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimeValue() {
  $('#time-value').textContent = fmtDuration(state.durations[state.durationIdx]);
}

$('#time-minus').addEventListener('click', () => {
  state.durationIdx = Math.max(0, state.durationIdx - 1);
  renderTimeValue();
});
$('#time-plus').addEventListener('click', () => {
  state.durationIdx = Math.min(state.durations.length - 1, state.durationIdx + 1);
  renderTimeValue();
});

const amtInput = $('#amt-input');
function setAmount(v) {
  state.amount = Math.max(1, Math.min(5000, Math.round(v)));
  amtInput.value = state.amount;
  updateProfitPreview();
}
$('#amt-minus').addEventListener('click', () => setAmount(state.amount - (state.amount <= 10 ? 1 : 10)));
$('#amt-plus').addEventListener('click', () => setAmount(state.amount + (state.amount < 10 ? 1 : 10)));
amtInput.addEventListener('change', () => setAmount(Number(amtInput.value) || 1));

function updateProfitPreview() {
  if (!state.asset) return;
  const profit = state.amount * state.asset.payout;
  $('#profit-preview').textContent = `$${(state.amount + profit).toFixed(2)}`;
  $('#profit-pct').textContent = `+${Math.round(state.asset.payout * 100)}%`;
}

async function placeTrade(direction) {
  const btns = [$('#btn-up'), $('#btn-down')];
  btns.forEach((b) => (b.disabled = true));
  try {
    const data = await api('/api/trade', {
      body: {
        asset: state.asset.id,
        direction,
        amount: state.amount,
        duration: state.durations[state.durationIdx],
        account: state.account,
      },
    });
    state.trades.unshift(data.trade);
    renderBalances(data.balances);
    state.tradesTab = 'open';
    $$('.trades-tab').forEach((b) => b.classList.toggle('active', b.dataset.list === 'open'));
    renderTrades();
    syncChartTrades();
  } catch (err) {
    toast('error', 'Trade rejected', err.message);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

$('#btn-up').addEventListener('click', () => placeTrade('up'));
$('#btn-down').addEventListener('click', () => placeTrade('down'));

// ---------------------------------------------------------------- trades list

async function loadTrades() {
  const { trades } = await api('/api/trades');
  state.trades = trades;
  renderTrades();
  syncChartTrades();
}

$$('.trades-tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.tradesTab = btn.dataset.list;
    $$('.trades-tab').forEach((b) => b.classList.toggle('active', b === btn));
    renderTrades();
  })
);

function renderTrades() {
  const wrap = $('#trades-list');
  const inAccount = state.trades.filter((t) => t.account === state.account);
  const open = inAccount.filter((t) => t.status === 'open');
  $('#open-count').textContent = open.length;
  $('#open-count-m').textContent = open.length;
  const list = state.tradesTab === 'open' ? open : inAccount.filter((t) => t.status !== 'open');
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = `<div class="trades-empty">${state.tradesTab === 'open' ? 'No open trades.<br>Make a forecast — Up or Down!' : 'No closed trades yet.'}</div>`;
    return;
  }
  for (const t of list.slice(0, 50)) {
    const el = document.createElement('div');
    el.className = 'trade-item';
    const arrow = `<span class="trade-arrow ${t.direction}">${t.direction === 'up' ? '▲' : '▼'}</span>`;
    if (t.status === 'open') {
      el.innerHTML = `${arrow}
        <div class="trade-mid">
          <div class="trade-asset">${t.assetName}</div>
          <div class="trade-sub">${fmtPrice(t.entryPrice, t.asset)} → …</div>
        </div>
        <div class="trade-right">
          <div class="trade-amt">$${t.amount.toFixed(2)}</div>
          <div class="trade-countdown" data-expires="${t.expiresAt}">--</div>
        </div>`;
    } else {
      const res = t.status === 'won' ? `+$${t.profit.toFixed(2)}` : t.status === 'lost' ? `−$${t.amount.toFixed(2)}` : '$0.00';
      el.innerHTML = `${arrow}
        <div class="trade-mid">
          <div class="trade-asset">${t.assetName}</div>
          <div class="trade-sub">${fmtPrice(t.entryPrice, t.asset)} → ${fmtPrice(t.closePrice, t.asset)}</div>
        </div>
        <div class="trade-right">
          <div class="trade-amt">$${t.amount.toFixed(2)}</div>
          <div class="trade-result ${t.status}">${res}</div>
        </div>`;
    }
    wrap.appendChild(el);
  }
}

function fmtPrice(p, assetId) {
  if (p == null) return '…';
  const a = state.assets.find((x) => x.id === assetId);
  return Number(p).toFixed(a ? a.decimals : 2);
}

// countdown ticker for open trades
setInterval(() => {
  const now = Date.now();
  for (const el of $$('[data-expires]')) {
    const remain = Math.max(0, Math.ceil((Number(el.dataset.expires) - now) / 1000));
    el.textContent = fmtDuration(remain);
  }
}, 250);

// ---------------------------------------------------------------- balances & account

function renderBalances(balances) {
  if (!balances) return;
  state.user.balances = balances;
  const amount = state.account === 'live' ? balances.live : balances.demo;
  $('#balance-amount').textContent = fmtMoney(amount);
  const label = $('#balance-label');
  label.textContent = state.account === 'live' ? 'LIVE ACCOUNT' : 'DEMO ACCOUNT';
  label.classList.toggle('live', state.account === 'live');
  $('#menu-demo-amount').textContent = fmtMoney(balances.demo);
  $('#menu-live-amount').textContent = fmtMoney(balances.live);
  $('#check-demo').classList.toggle('hidden', state.account !== 'demo');
  $('#check-live').classList.toggle('hidden', state.account !== 'live');
  $('#withdraw-avail').textContent = fmtMoney(balances.live);
}

function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

$('#balance-box').addEventListener('click', (e) => {
  if (e.target.closest('.balance-menu')) return;
  $('#balance-menu').classList.toggle('hidden');
  $('#user-menu').classList.add('hidden');
});

$$('.balance-option').forEach((opt) =>
  opt.addEventListener('click', () => {
    state.account = opt.dataset.account;
    localStorage.setItem('tb_account', state.account);
    renderBalances(state.user.balances);
    renderTrades();
    syncChartTrades();
    $('#balance-menu').classList.add('hidden');
  })
);

$('#reset-demo-btn').addEventListener('click', async () => {
  const data = await api('/api/reset-demo', { method: 'POST', body: {} });
  renderBalances(data.balances);
  toast('win', 'Demo topped up', 'Your demo balance is back to $10,000.');
  $('#balance-menu').classList.add('hidden');
});

// user menu
$('#avatar').addEventListener('click', () => {
  $('#user-menu').classList.toggle('hidden');
  $('#balance-menu').classList.add('hidden');
});
$('#logout-btn').addEventListener('click', logout);

document.addEventListener('click', (e) => {
  if (!e.target.closest('#balance-box')) $('#balance-menu').classList.add('hidden');
  if (!e.target.closest('#user-box')) $('#user-menu').classList.add('hidden');
});

// ---------------------------------------------------------------- modals

function openModal(id) {
  $('#modal-overlay').classList.remove('hidden');
  $$('.modal').forEach((m) => m.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function closeModals() {
  $('#modal-overlay').classList.add('hidden');
}
$('#modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) dismissModals();
});
$$('.modal-close').forEach((b) => b.addEventListener('click', dismissModals));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissModals();
});

$('#asset-btn').addEventListener('click', () => {
  renderAssetList($('#asset-search').value);
  openModal('#asset-modal');
  $('#asset-search').focus();
});
$('#asset-search').addEventListener('input', () => renderAssetList($('#asset-search').value));

$('#deposit-btn').addEventListener('click', () => navigate('/deposit'));
$('#withdraw-btn').addEventListener('click', () => navigate('/withdraw'));
$('#rail-help').addEventListener('click', () => navigate('/help'));

$('#deposit-quick').addEventListener('click', (e) => {
  const amt = e.target.dataset.amt;
  if (amt) $('#deposit-amount').value = amt;
});

$('#deposit-confirm').addEventListener('click', async () => {
  try {
    const data = await api('/api/deposit', {
      body: { amount: Number($('#deposit-amount').value), method: $('#deposit-method').value },
    });
    renderBalances(data.balances);
    dismissModals();
    toast('win', 'Deposit successful', `${fmtMoney(Number($('#deposit-amount').value))} added to your live account.`);
  } catch (err) {
    toast('error', 'Deposit failed', err.message);
  }
});

$('#withdraw-confirm').addEventListener('click', async () => {
  try {
    const data = await api('/api/withdraw', {
      body: { amount: Number($('#withdraw-amount').value), method: $('#withdraw-method').value },
    });
    renderBalances(data.balances);
    dismissModals();
    toast('win', 'Withdrawal requested', 'Funds are on the way (simulated).');
  } catch (err) {
    toast('error', 'Withdrawal failed', err.message);
  }
});

async function showLeaderboard() {
  openModal('#top-modal');
  const { leaderboard } = await api('/api/leaderboard');
  $('#leaderboard').innerHTML = leaderboard
    .map((r, i) => `
      <div class="lb-row">
        <span class="lb-rank">${i + 1}</span>
        <span>${r.country}</span>
        <span class="lb-name">${escapeHtml(r.name)}</span>
        <span class="lb-profit">+${fmtMoney(r.profit)}</span>
      </div>`)
    .join('');
}
$('#rail-top').addEventListener('click', () => navigate('/top'));
$('#menu-top-btn').addEventListener('click', () => { $('#user-menu').classList.add('hidden'); navigate('/top'); });
$('#menu-help-btn').addEventListener('click', () => { $('#user-menu').classList.add('hidden'); navigate('/help'); });

async function showTransactions() {
  openModal('#tx-modal');
  const { transactions } = await api('/api/transactions');
  $('#tx-list').innerHTML = transactions.length
    ? transactions.map((tx) => `
        <div class="tx-row">
          <span class="tx-type">${tx.type}</span>
          <span class="tx-time">${new Date(tx.time).toLocaleString()}</span>
          <span class="tx-amt ${tx.type === 'deposit' ? 'pos' : 'neg'}">${tx.type === 'deposit' ? '+' : '−'}${fmtMoney(tx.amount)}</span>
        </div>`).join('')
    : '<div class="trades-empty">No transactions yet.</div>';
}
$('#tx-btn').addEventListener('click', () => { $('#user-menu').classList.add('hidden'); navigate('/wallet'); });
$('#rail-tx').addEventListener('click', () => navigate('/wallet'));

// mobile: slide the trades list up over the chart
$('#mobile-trades-btn').addEventListener('click', () => {
  document.body.classList.toggle('trades-open');
});

// ---------------------------------------------------------------- toasts

function toast(kind, title, body) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${escapeHtml(title)}</b>${escapeHtml(body || '')}`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- go

boot().catch((err) => {
  console.error(err);
  $('#auth-screen').classList.remove('hidden');
});
