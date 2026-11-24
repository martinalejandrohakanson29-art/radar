// Estudio: ETH y SOL vs BTC. Valuación actual, rendimiento después de pisos de BTC, caídas en bear markets y ratio contra BTC.
// Uso: node analisis/alts.mjs
// Resultado nov-2026: amplifican a BTC para los dos lados pero no siempre le ganan (ETH rindió menos que BTC
// a 1 año tras los pisos de 2018 y 2022; SOL más en 2022). Por eso son satélite (máx. 1/3).
import { coinmetrics, avg } from './lib.mjs';

const S = { btc: await coinmetrics('btc', '2015-01-01'), eth: await coinmetrics('eth', '2015-01-01'), sol: await coinmetrics('sol', '2015-01-01') };
const at = (a, d) => S[a].find((x) => x.d >= d)?.px;
const masDias = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);

console.log('VALUACIÓN HOY');
for (const a of ['btc', 'eth', 'sol']) {
  const r = S[a], n = r.length, px = r.map((x) => x.px), ath = Math.max(...px), last = r.at(-1), mv = [...r].reverse().find((x) => x.mvrv != null);
  const sem = []; for (let k = n - 1; k > n - 1400 && k >= 0; k -= 7) sem.push(px[k]);
  console.log(' ', a.toUpperCase().padEnd(4), last.d, 'precio', last.px.toFixed(2), '| caída', ((last.px / ath - 1) * 100).toFixed(0) + '%', '| /200sem',
    sem.length >= 200 ? (last.px / avg(sem)).toFixed(2) : `n/a (${sem.length} sem)`, '| MVRV', mv?.mvrv?.toFixed(2) ?? '-', '| 1 año', ((last.px / px[n - 366] - 1) * 100).toFixed(0) + '%');
}
console.log('\nDESPUÉS DE LOS PISOS DE BTC (SOL existe desde 2020)');
for (const [p, nombre] of [['2018-12-15', 'piso 2018'], ['2020-03-13', 'covid 2020'], ['2022-11-21', 'piso 2022']]) {
  const out = [];
  for (const a of ['btc', 'eth', 'sol']) {
    if (S[a][0].d > p) continue;
    const p0 = at(a, p), p1 = at(a, masDias(p, 365));
    const mx = Math.max(...S[a].filter((x) => x.d >= p && x.d <= masDias(p, 730)).map((x) => x.px));
    out.push(`${a.toUpperCase()} 1 año ${((p1 / p0 - 1) * 100).toFixed(0)}% · máx. en 2 años x${(mx / p0).toFixed(1)}`);
  }
  console.log(' ', nombre.padEnd(11), out.join(' | '));
}
console.log('\nCAÍDA MÁXIMA EN BEAR MARKETS');
for (const [a0, b0, nombre] of [['2017-12-01', '2018-12-31', 'bear 2018'], ['2021-11-01', '2022-12-31', 'bear 2022']]) {
  const o = [];
  for (const x of ['btc', 'eth', 'sol']) {
    const seg = S[x].filter((y) => y.d >= a0 && y.d <= b0);
    if (seg.length < 50) continue;
    const m = Math.max(...seg.map((y) => y.px)), mn = Math.min(...seg.map((y) => y.px));
    o.push(`${x.toUpperCase()} ${((mn / m - 1) * 100).toFixed(0)}%`);
  }
  console.log(' ', nombre.padEnd(11), o.join(' | '));
}
console.log('\nRATIO CONTRA BTC');
const bmap = new Map(S.btc.map((x) => [x.d, x.px]));
for (const a of ['eth', 'sol']) {
  const v = S[a].filter((x) => bmap.has(x.d)).map((x) => x.px / bmap.get(x.d)), last = v.at(-1);
  console.log(' ', `${a.toUpperCase()}/BTC`, last.toFixed(6), '| más bajo que el', (v.filter((x) => x > last).length / v.length * 100).toFixed(0) + '% de los días', '| 1 año', ((last / v[v.length - 366] - 1) * 100).toFixed(0) + '%');
}
