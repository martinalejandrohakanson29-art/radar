import { load, backtest, stats } from './lib.mjs';
import { indicators, catalog } from './strats.mjs';
const periods = { 'IS 2018-22': ['2018-03-10', '2022-12-31'], 'OOS 2023-26': ['2023-01-01', '2099'], 'TODO': ['2018-03-10', '2099'] };
const f = (x, d = 1) => (x >= 0 ? ' ' : '') + x.toFixed(d);
for (const sym of process.argv.slice(2)) {
  const k = load(sym), I = indicators(k), S = catalog(I);
  for (const [pn, [a, b]] of Object.entries(periods)) {
    const from = Math.max(210, k.findIndex((x) => new Date(x.t).toISOString().slice(0, 10) >= a));
    let to = k.findIndex((x) => new Date(x.t).toISOString().slice(0, 10) > b); if (to < 0) to = k.length;
    console.log(`\n=== ${sym} ${pn} (${new Date(k[from].t).toISOString().slice(0,10)} → ${new Date(k[to-1].t).toISOString().slice(0,10)}) ===`);
    console.log('estrategia'.padEnd(26), 'CAGR%  MaxDD%  Sharpe Calmar trades win%  PF   días  expo%');
    for (const [n, s] of Object.entries(S)) {
      const r = backtest(k, s, { from, to }), st = stats(r.eq, r.trades);
      console.log(n.padEnd(26), f(st.cagr).padStart(6), f(st.maxDD).padStart(6), f(st.sharpe, 2).padStart(6), f(st.calmar, 2).padStart(6),
        String(st.trades).padStart(5), st.win.toFixed(0).padStart(5), (isFinite(st.pf) ? st.pf.toFixed(2) : '-').padStart(5), st.avgDays.toFixed(0).padStart(5), st.expo.toFixed(0).padStart(5));
    }
  }
}
