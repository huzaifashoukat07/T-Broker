// Lightweight canvas candlestick chart with live ticks, trade markers,
// price line and countdowns. No dependencies.

class CandleChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.decimals = 5;
    this.tf = 60;
    this.trades = []; // open trades to draw markers for
    this.lastPrice = null;
    this.lastDir = 0;
    this.offset = 0; // candles scrolled back from the latest
    this.candleW = 9; // px per candle (incl. gap)
    this.axisW = 74;
    this.axisH = 24;
    this.flash = 0;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    new ResizeObserver(this._resize).observe(canvas.parentElement);
    this._resize();

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const w = this.candleW * (e.deltaY < 0 ? 1.12 : 0.89);
        this.candleW = Math.min(28, Math.max(3, w));
      }
      if (Math.abs(e.deltaX) > 0) {
        this.offset = this._clampOffset(this.offset + e.deltaX / this.candleW);
      }
    }, { passive: false });

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, offset: this.offset };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.offset = this._clampOffset(drag.offset + (e.clientX - drag.x) / this.candleW);
    });
    canvas.addEventListener('pointerup', () => { drag = null; });

    const loop = () => { this._render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  _clampOffset(o) {
    return Math.max(0, Math.min(o, Math.max(0, this.candles.length - 20)));
  }

  setData(candles, decimals, tf) {
    this.candles = candles;
    this.decimals = decimals;
    this.tf = tf;
    this.offset = 0;
    if (candles.length) {
      this.lastPrice = candles[candles.length - 1].c;
    }
  }

  setTrades(trades) {
    this.trades = trades;
  }

  tick(price, timeMs, dir) {
    if (!this.candles.length) return;
    const tSec = Math.floor(timeMs / 1000);
    const bucket = Math.floor(tSec / this.tf) * this.tf;
    const last = this.candles[this.candles.length - 1];
    if (last.t === bucket) {
      last.c = price;
      if (price > last.h) last.h = price;
      if (price < last.l) last.l = price;
    } else if (bucket > last.t) {
      this.candles.push({ t: bucket, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price });
      if (this.candles.length > 600) this.candles.shift();
    }
    this.lastPrice = price;
    this.lastDir = dir;
    this.flash = 1;
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = parent.clientWidth;
    this.h = parent.clientHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _fmt(p) {
    return Number(p).toFixed(this.decimals);
  }

  _render() {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    if (!this.candles.length) return;

    const plotW = w - this.axisW;
    const plotH = h - this.axisH;
    const n = Math.floor(plotW / this.candleW) - 4; // leave breathing room on the right
    const end = this.candles.length - Math.floor(this.offset);
    const start = Math.max(0, end - n);
    const visible = this.candles.slice(start, end);
    if (!visible.length) return;

    let lo = Infinity, hi = -Infinity;
    for (const c of visible) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (this.offset < 2 && this.lastPrice != null) {
      lo = Math.min(lo, this.lastPrice);
      hi = Math.max(hi, this.lastPrice);
    }
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.001 || 1;
    lo -= pad; hi += pad;
    const y = (p) => plotH - ((p - lo) / (hi - lo)) * plotH;
    const x = (i) => (i - start) * this.candleW + this.candleW / 2;
    const timeToX = (tSec) => {
      const idx = start + (tSec - visible[0].t) / this.tf;
      return (idx - start) * this.candleW + this.candleW / 2;
    };

    const css = getComputedStyle(document.documentElement);
    const GREEN = css.getPropertyValue('--up').trim() || '#0ecb81';
    const RED = css.getPropertyValue('--down').trim() || '#f6465d';
    const GRID = 'rgba(140,160,200,0.08)';
    const TEXT = 'rgba(150,165,195,0.85)';

    // grid + price axis labels
    ctx.font = '11px "Inter", system-ui, sans-serif';
    const rows = 6;
    for (let i = 0; i <= rows; i++) {
      const gy = (plotH / rows) * i;
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(plotW, gy + 0.5);
      ctx.stroke();
      const price = hi - ((hi - lo) / rows) * i;
      ctx.fillStyle = TEXT;
      ctx.textAlign = 'left';
      ctx.fillText(this._fmt(price), plotW + 8, gy + 4);
    }

    // time axis labels
    const step = Math.max(1, Math.round(90 / this.candleW));
    ctx.textAlign = 'center';
    for (let i = 0; i < visible.length; i += step) {
      const d = new Date(visible[i].t * 1000);
      const label = this.tf >= 300
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      ctx.fillStyle = TEXT;
      ctx.fillText(label, x(start + i), h - 8);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(x(start + i) + 0.5, 0);
      ctx.lineTo(x(start + i) + 0.5, plotH);
      ctx.stroke();
    }

    // candles
    const bodyW = Math.max(1, this.candleW * 0.65);
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const cx = x(start + i);
      const up = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = up ? GREEN : RED;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y(c.h));
      ctx.lineTo(cx, y(c.l));
      ctx.stroke();
      const top = y(Math.max(c.o, c.c));
      const bh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
      ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    }

    // open trade markers
    const now = Date.now();
    for (const t of this.trades) {
      const color = t.direction === 'up' ? GREEN : RED;
      const ey = y(t.entryPrice);
      if (ey > 0 && ey < plotH) {
        ctx.strokeStyle = color;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, ey + 0.5);
        ctx.lineTo(plotW, ey + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        // entry badge
        const label = `${t.direction === 'up' ? '▲' : '▼'} $${t.amount}`;
        ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = color;
        roundRect(ctx, 8, ey - 10, tw, 20, 5);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(label, 14, ey + 4);
      }
      // expiry vertical line + countdown
      const exSec = t.expiresAt / 1000;
      const ex = timeToX(exSec);
      if (ex > 0 && ex < plotW) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ex + 0.5, 0);
        ctx.lineTo(ex + 0.5, plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        const remain = Math.max(0, Math.ceil((t.expiresAt - now) / 1000));
        const lbl = fmtCountdown(remain);
        ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
        const tw2 = ctx.measureText(lbl).width + 12;
        ctx.fillStyle = 'rgba(20,26,40,0.9)';
        roundRect(ctx, ex - tw2 / 2, 6, tw2, 20, 5);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        roundRect(ctx, ex - tw2 / 2, 6, tw2, 20, 5);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(lbl, ex, 20);
      }
    }

    // current price line + tag
    if (this.lastPrice != null && this.offset < 2) {
      const py = y(this.lastPrice);
      const color = this.lastDir >= 0 ? GREEN : RED;
      ctx.strokeStyle = color;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, py + 0.5);
      ctx.lineTo(plotW, py + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      roundRect(ctx, plotW + 2, py - 10, this.axisW - 6, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this._fmt(this.lastPrice), plotW + 8, py + 4);

      // pulse dot on the latest candle
      const lastIdx = start + visible.length - 1;
      const cx = x(lastIdx);
      if (this.flash > 0) this.flash *= 0.94;
      ctx.beginPath();
      ctx.arc(cx, py, 3 + this.flash * 5, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmtCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

window.CandleChart = CandleChart;
