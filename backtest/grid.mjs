import { load, backtest, stats, hh, ll, sma } from './lib.mjs';
// Robustez: grilla Donchian entrada x salida, con filtro SMA200, Sharpe de todo el período
const ent = [10, 15, 20, 30, 40, 55, 70], exi = [5, 10, 15, 20, 30];
for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
  const k = load(sym), c = k.map((x) => x.c), s200 = sma(c, 200);
  console.log(`\n${sym}  Sharpe (Calmar) — filas: entrada N días, columnas: salida M días`);
  console.log('     ' + exi.map((x) => String(x).padStart(12)).join(''));
  for (const e of ent) {
    const H = hh(c, e);
    let row = String(e).padStart(4) + ' ';
    for (const x of exi) {
      const L = ll(c, x);
      const r = backtest(k, { entry: (i) => c[i] > H[i] && c[i] > s200[i], exit: (i) => c[i] < L[i] }, { from: 210 });
      const st = stats(r.eq, r.trades);
      row += `${st.sharpe.toFixed(2)} (${st.calmar.toFixed(2)})`.padStart(12);
    }
    console.log(row);
  }
}
