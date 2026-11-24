import { readFileSync } from 'node:fs';
export const load = (s) => JSON.parse(readFileSync(new URL(`./${s}_1d.json`, import.meta.url)));
export const sma = (a, p) => a.map((_, i) => i < p - 1 ? null : a.slice(i - p + 1, i + 1).reduce((s, x) => s + x, 0) / p);
export const ema = (a, p) => { const k = 2 / (p + 1); let e = null; return a.map((x, i) => (e = i === 0 ? x : x * k + e * (1 - k))); };
export function rsi(c, p = 14) {
  const out = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up / p; l += dn / p; if (i === p) out[i] = 100 - 100 / (1 + g / (l || 1e-12)); }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; out[i] = 100 - 100 / (1 + g / (l || 1e-12)); }
  }
  return out;
}
export function atr(k, p = 14) {
  const tr = k.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - k[i - 1].c), Math.abs(x.l - k[i - 1].c)));
  const out = []; let a = null;
  tr.forEach((t, i) => { a = i < p ? null : a == null ? tr.slice(1, p + 1).reduce((s, x) => s + x, 0) / p : (a * (p - 1) + t) / p; out.push(a); });
  return out;
}
export const hh = (a, p) => a.map((_, i) => i < p ? null : Math.max(...a.slice(i - p, i)));  // excluye hoy
export const ll = (a, p) => a.map((_, i) => i < p ? null : Math.min(...a.slice(i - p, i)));

// Motor: señal al cierre del día i -> ejecuta en la apertura de i+1. Stop intradía con low.
// strat(k, ind) => { entry(i): bool, exit(i, pos): bool, stop(i, pos): precio|null }
export function backtest(k, strat, { fee = 0.0015, from = 0, to = k.length } = {}) {
  let cash = 1, units = 0, pos = null, eq = [], trades = [], pendingEntry = false;
  for (let i = from; i < to; i++) {
    const bar = k[i];
    // ejecutar órdenes pendientes en la apertura
    if (pos?.pendingExit) { cash = units * bar.o * (1 - fee); trades.push({ ...pos, out: bar.o, tOut: bar.t, days: i - pos.i }); units = 0; pos = null; }
    if (pos === null && pendingEntry) { units = cash * (1 - fee) / bar.o; cash = 0; pos = { in: bar.o, tIn: bar.t, i, peak: bar.h }; pendingEntry = false; }
    // stop intradía
    if (pos) {
      const st = strat.stop?.(i - 1, pos); // stop definido con info hasta el cierre previo
      if (st != null && bar.l <= st) {
        const px = Math.min(bar.o, st);
        cash = units * px * (1 - fee); trades.push({ ...pos, out: px, tOut: bar.t, days: i - pos.i, stopped: true }); units = 0; pos = null;
      } else pos.peak = Math.max(pos.peak, bar.h);
    }
    eq.push({ t: bar.t, v: cash + units * bar.c });
    if (i === to - 1) break;
    if (pos && strat.exit(i, pos)) pos.pendingExit = true;
    else if (!pos && strat.entry(i)) pendingEntry = true;
  }
  return { eq, trades, open: pos };
}

export function stats(eq, trades) {
  const v = eq.map((e) => e.v), n = v.length, yrs = n / 365;
  const r = v.slice(1).map((x, i) => x / v[i] - 1);
  const m = r.reduce((s, x) => s + x, 0) / r.length, sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length);
  let peak = -Infinity, dd = 0; for (const x of v) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); }
  const rets = trades.map((t) => t.out / t.in * (1 - 0.0015) ** 2 - 1);
  const w = rets.filter((x) => x > 0), l = rets.filter((x) => x <= 0);
  const inDays = trades.reduce((s, t) => s + t.days, 0);
  return {
    total: (v[n - 1] / v[0] - 1) * 100, cagr: ((v[n - 1] / v[0]) ** (1 / yrs) - 1) * 100, maxDD: dd * 100,
    sharpe: sd ? m / sd * Math.sqrt(365) : 0, calmar: dd ? ((v[n - 1] / v[0]) ** (1 / yrs) - 1) / -dd : 0,
    trades: trades.length, win: rets.length ? w.length / rets.length * 100 : 0,
    pf: l.length ? w.reduce((s, x) => s + x, 0) / -l.reduce((s, x) => s + x, 0) : Infinity,
    avgDays: trades.length ? inDays / trades.length : 0, expo: inDays / n * 100,
  };
}
