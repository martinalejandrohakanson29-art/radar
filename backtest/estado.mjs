import { load, sma, hh, ll, backtest, stats } from './lib.mjs';
const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const strat = (k) => { const c = k.map((x) => x.c), s200 = sma(c, 200), H = hh(c, 30), L = ll(c, 15);
  return { c, s200, H, L, s: { entry: (i) => c[i] > H[i] && c[i] > s200[i], exit: (i) => c[i] < L[i] } }; };
// sensibilidad a costos
console.log('Sensibilidad a costos (Sharpe / CAGR, todo el período)');
for (const sym of syms) { const k = load(sym), { s } = strat(k);
  console.log(' ', sym, [0.001, 0.0015, 0.003, 0.005].map((fee) => { const st = stats(...Object.values(backtest(k, s, { from: 210, fee })).slice(0, 2)); return `fee ${(fee * 100).toFixed(2)}%: ${st.sharpe.toFixed(2)} / ${st.cagr.toFixed(0)}%`; }).join('  |  ')); }
// rendimiento por año, cada activo vs BH
console.log('\nRetorno por año: estrategia vs buy&hold');
for (const sym of syms) { const k = load(sym), { s } = strat(k), r = backtest(k, s, { from: 210 });
  const yr = {}; r.eq.forEach((e, i) => { const y = new Date(e.t).getUTCFullYear(); (yr[y] ??= { s0: r.eq[i - 1]?.v ?? 1, b0: k[210 + i - 1]?.c ?? k[210].o }); yr[y].s1 = e.v; yr[y].b1 = k[210 + i].c; });
  console.log(' ', sym.padEnd(8), Object.entries(yr).map(([y, o]) => `${y}: ${((o.s1 / o.s0 - 1) * 100).toFixed(0)}/${((o.b1 / o.b0 - 1) * 100).toFixed(0)}`).join('  ')); }
// estado actual
console.log('\nEstado actual (última vela cerrada)');
for (const sym of syms) { const k = load(sym), { c, s200, H, L, s } = strat(k), n = k.length - 1, r = backtest(k, s, { from: 210 });
  const t = r.trades.at(-1);
  console.log(' ', sym, new Date(k[n].t).toISOString().slice(0, 10), 'cierre', c[n], '| SMA200', s200[n].toFixed(2), '| máx30', H[n], '| mín15', L[n],
    '| posición:', r.open ? `COMPRADO desde ${new Date(r.open.tIn).toISOString().slice(0, 10)} a ${r.open.in}` : `fuera (última salida ${t ? new Date(t.tOut).toISOString().slice(0, 10) : '-'})`); }
