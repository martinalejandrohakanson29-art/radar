import { load, sma, hh, ll, stats } from './lib.mjs';
// Motor vectorial: peso decidido al cierre del día i se aplica al retorno de i+1. Costo 0.15% por unidad de rotación.
const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const raw = Object.fromEntries(syms.map((s) => [s, load(s)]));
const dates = raw.SOLUSDT.map((x) => x.t).filter((t) => t >= Date.UTC(2021, 2, 10)); // período común
const S = {};
for (const s of syms) {
  const k = raw[s], idx = new Map(k.map((x, i) => [x.t, i])), c = k.map((x) => x.c);
  const s200 = sma(c, 200), H = hh(c, 30), L = ll(c, 15);
  const r = c.map((x, i) => i ? x / c[i - 1] - 1 : 0);
  const vol = c.map((_, i) => i < 30 ? null : Math.sqrt(r.slice(i - 29, i + 1).reduce((a, x) => a + x * x, 0) / 30 * 365));
  const mom = c.map((x, i) => i < 60 ? null : x / c[i - 60] - 1);
  // estado Donchian 30/15 + SMA200 (en posición o no)
  let inPos = false; const don = c.map((x, i) => { if (!inPos && x > H[i] && x > s200[i]) inPos = true; else if (inPos && x < L[i]) inPos = false; return inPos; });
  S[s] = dates.map((t) => { const i = idx.get(t); return { r: r[i], don: don[i], up: c[i] > s200[i], vol: vol[i], mom: mom[i] }; });
}
function run(name, wfn) {
  let v = 1, prevW = {}, eq = [], trades = [];
  for (let d = 0; d < dates.length; d++) {
    const w = d ? wfn(d - 1) : {};
    let ret = 0, turn = 0;
    for (const s of syms) { ret += (w[s] || 0) * S[s][d].r; turn += Math.abs((w[s] || 0) - (prevW[s] || 0)); }
    v *= (1 + ret) * (1 - turn * 0.0015); prevW = w; eq.push({ t: dates[d], v });
  }
  const st = stats(eq, trades);
  console.log(name.padEnd(44), st.cagr.toFixed(1).padStart(6), st.maxDD.toFixed(1).padStart(7), st.sharpe.toFixed(2).padStart(6), st.calmar.toFixed(2).padStart(6));
  return eq;
}
const TV = 0.6; // vol objetivo anual 60%
const vt = (x) => Math.min(1, TV / x.vol);
console.log('estrategia (2021-03 → 2026-11)'.padEnd(44), '  CAGR  MaxDD  Sharpe Calmar');
for (const s of syms) run(`BH ${s}`, () => ({ [s]: 1 }));
run('BH 1/3 cada uno', () => Object.fromEntries(syms.map((s) => [s, 1 / 3])));
for (const s of syms) run(`Donchian30/15+SMA200 ${s}`, (d) => ({ [s]: S[s][d].don ? 1 : 0 }));
for (const s of syms) run(`  + vol target 60% ${s}`, (d) => ({ [s]: S[s][d].don ? vt(S[s][d]) : 0 }));
for (const s of ['ETHUSDT', 'SOLUSDT']) run(`  + solo si BTC>SMA200 ${s}`, (d) => ({ [s]: S[s][d].don && S.BTCUSDT[d].up ? 1 : 0 }));
run('Cartera Donchian 1/3 c/u', (d) => Object.fromEntries(syms.map((s) => [s, S[s][d].don ? 1 / 3 : 0])));
run('Cartera Donchian 1/3 + vol target', (d) => Object.fromEntries(syms.map((s) => [s, S[s][d].don ? vt(S[s][d]) / 3 : 0])));
run('Cartera Donchian, alts solo si BTC>SMA200', (d) => Object.fromEntries(syms.map((s) => [s, S[s][d].don && (s === 'BTCUSDT' || S.BTCUSDT[d].up) ? 1 / 3 : 0])));
run('Rotación: mejor momentum 60d en tendencia', (d) => {
  const ok = syms.filter((s) => S[s][d].don); if (!ok.length) return {};
  const best = ok.sort((a, b) => S[b][d].mom - S[a][d].mom)[0]; return { [best]: 1 };
});
