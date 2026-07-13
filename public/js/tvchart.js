// TradingView-powered candlestick chart (lightweight-charts, bundled locally).
// Exposes the same interface as the previous canvas chart:
//   setData(candles, decimals, tf) / tick(price, timeMs, dir) / setTrades(trades)

class CandleChart {
  constructor(container) {
    const css = getComputedStyle(document.documentElement);
    this.UP = css.getPropertyValue('--up').trim() || '#0ecb81';
    this.DOWN = css.getPropertyValue('--down').trim() || '#f6465d';

    this.chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#8493b3',
        fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(140,160,200,0.07)' },
        horzLines: { color: 'rgba(140,160,200,0.07)' },
      },
      rightPriceScale: { borderColor: 'rgba(140,160,200,0.15)' },
      timeScale: {
        borderColor: 'rgba(140,160,200,0.15)',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 6,
        fixLeftEdge: true, // never scroll past the first candle into empty space
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(140,160,200,0.35)', labelBackgroundColor: '#1a2440' },
        horzLine: { color: 'rgba(140,160,200,0.35)', labelBackgroundColor: '#1a2440' },
      },
      localization: { locale: navigator.language || 'en-US' },
    });

    this.series = this.chart.addCandlestickSeries({
      upColor: this.UP,
      downColor: this.DOWN,
      wickUpColor: this.UP,
      wickDownColor: this.DOWN,
      borderVisible: false,
      priceLineVisible: true,
      priceLineWidth: 1,
      lastValueVisible: true,
    });

    this.candles = [];
    this.decimals = 5;
    this.tf = 60;
    this.trades = [];
    this.priceLines = [];

    // refresh open-trade countdown labels once a second
    this.countdownTimer = setInterval(() => this._drawTradeLines(), 1000);
  }

  setData(candles, decimals, tf) {
    this.decimals = decimals;
    this.tf = tf;
    // lightweight-charts throws on duplicate or descending times — dedupe
    // (last wins) and sort so a glitchy feed can never blank the chart
    const byTime = new Map();
    for (const c of candles) byTime.set(c.t, { time: c.t, open: c.o, high: c.h, low: c.l, close: c.c });
    this.candles = [...byTime.values()].sort((a, b) => a.time - b.time);
    this.series.applyOptions({
      priceFormat: { type: 'price', precision: decimals, minMove: Number((10 ** -decimals).toFixed(decimals)) },
    });
    // axis labels match the timeframe: seconds on fast charts, dates on 1D
    this.chart.applyOptions({
      timeScale: { secondsVisible: tf < 60, timeVisible: tf < 86400 },
    });
    this.series.setData(this.candles);
    this.chart.timeScale().scrollToRealTime();
    this._drawTradeLines();
    this._drawMarkers();
  }

  tick(price, timeMs, _dir) {
    if (!this.candles.length) return;
    const bucket = Math.floor(timeMs / 1000 / this.tf) * this.tf;
    const last = this.candles[this.candles.length - 1];
    let candle;
    if (bucket > last.time) {
      candle = { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price };
      this.candles.push(candle);
      if (this.candles.length > 600) this.candles.shift();
    } else {
      // same bucket, or a tick stamped slightly in the past (clock skew
      // between the data feed and this device) — fold it into the newest candle
      candle = {
        time: last.time,
        open: last.open,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      };
      this.candles[this.candles.length - 1] = candle;
    }
    this.series.update(candle);
  }

  setTrades(trades) {
    this.trades = trades;
    this._drawTradeLines();
    this._drawMarkers();
  }

  _drawTradeLines() {
    for (const line of this.priceLines) this.series.removePriceLine(line);
    this.priceLines = [];
    const now = Date.now();
    for (const t of this.trades) {
      const remain = Math.max(0, Math.ceil((t.expiresAt - now) / 1000));
      const m = Math.floor(remain / 60);
      const s = String(remain % 60).padStart(2, '0');
      this.priceLines.push(this.series.createPriceLine({
        price: t.entryPrice,
        color: t.direction === 'up' ? this.UP : this.DOWN,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${t.direction === 'up' ? '▲' : '▼'} $${t.amount} · ${m}:${s}`,
      }));
    }
  }

  _drawMarkers() {
    const markers = this.trades
      .map((t) => ({
        time: Math.floor(t.openedAt / 1000 / this.tf) * this.tf,
        position: t.direction === 'up' ? 'belowBar' : 'aboveBar',
        shape: t.direction === 'up' ? 'arrowUp' : 'arrowDown',
        color: t.direction === 'up' ? this.UP : this.DOWN,
        text: `$${t.amount}`,
      }))
      .sort((a, b) => a.time - b.time);
    this.series.setMarkers(markers);
  }
}

window.CandleChart = CandleChart;
