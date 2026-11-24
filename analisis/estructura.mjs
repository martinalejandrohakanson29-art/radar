// Foto de estructura de BTC para análisis discrecional (lo que usa la skill /analisis-mercado).
// Uso: node analisis/estructura.mjs [SIMBOLO]   (default BTCUSDT)
// Imprime: velas semanales/diarias/4h, pivotes, medias, Fibonacci de la última pierna bajista,
// rangos mensuales, mechas semanales más bajas, flujos ETF diarios, peores ventanas de 20 días
// y qué hizo el precio después, y la prima de Coinbase.
import { binanceUltimas, coinmetrics, farside, avg, f0 } from './lib.mjs';

const sym = process.argv[2] ?? 'BTCUSDT';
const [w, d, h4] = await Promise.all([binanceUltimas(sym, '1w', 60), binanceUltimas(sym, '1d', 400), binanceUltimas(sym, '4h', 60)]);
const vela = (x) => `${x.t.slice(0, 10)} O ${f0(x.o)} H ${f0(x.h)} L ${f0(x.l)} C ${f0(x.c)} vol ${(x.qv / 1e9).toFixed(2)}B${x.cerrada ? '' : ' (en curso)'}`;

console.log('SEMANAL (últimas 14)'); w.slice(-14).forEach((x) => console.log(' ', vela(x)));
console.log('\nDIARIO (últimas 30)'); d.slice(-30).forEach((x) => console.log(' ', vela(x)));
console.log('\n4H (últimas 24)'); h4.slice(-24).forEach((x) => console.log(`  ${x.t} H ${f0(x.h)} L ${f0(x.l)} C ${f0(x.c)}`));

const dc = d.filter((x) => x.cerrada);
const piv = [];
for (let i = 5; i < dc.length - 5; i++) {
  const s = dc.slice(i - 5, i + 6);
  if (dc[i].h === Math.max(...s.map((x) => x.h))) piv.push(`H ${dc[i].t.slice(0, 10)} ${f0(dc[i].h)}`);
  if (dc[i].l === Math.min(...s.map((x) => x.l))) piv.push(`L ${dc[i].t.slice(0, 10)} ${f0(dc[i].l)}`);
}
console.log('\nPIVOTES DIARIOS (5 velas a cada lado):', piv.slice(-14).join(' | '));
const sma = (n) => avg(dc.slice(-n).map((x) => x.c));
console.log('MEDIAS diarias: 20', f0(sma(20)), '· 50', f0(sma(50)), '· 100', f0(sma(100)), '· 200', f0(sma(200)));

// Fibonacci de la última pierna: máximo de los últimos 60 días → mínimo posterior
const seg = dc.slice(-60), iMax = seg.reduce((b, x, i) => (x.h > seg[b].h ? i : b), 0);
const post = seg.slice(iMax), iMin = post.reduce((b, x, i) => (x.l < post[b].l ? i : b), 0);
const hi = seg[iMax].h, lo = post[iMin].l;
console.log(`\nFIBONACCI pierna ${seg[iMax].t.slice(0, 10)} ${f0(hi)} → ${post[iMin].t.slice(0, 10)} ${f0(lo)}:`,
  [0.236, 0.382, 0.5, 0.618].map((r) => `${(r * 100).toFixed(1)}% ${f0(lo + (hi - lo) * r)}`).join(' · '));

const cm = await coinmetrics('btc', '2024-01-01');
const meses = {};
for (const x of cm) (meses[x.d.slice(0, 7)] ??= []).push(x);
console.log('\nRANGOS MENSUALES (cierres diarios, últimos 15 meses)');
Object.entries(meses).slice(-15).forEach(([m, a]) => {
  const mn = a.reduce((x, y) => (y.px < x.px ? y : x)), mx = a.reduce((x, y) => (y.px > x.px ? y : x));
  console.log(`  ${m} mín ${f0(mn.px)} (${mn.d}) · máx ${f0(mx.px)} (${mx.d})`);
});
console.log('MECHAS SEMANALES MÁS BAJAS (1 año):', [...w.slice(-52)].sort((a, b) => a.l - b.l).slice(0, 6).map((x) => `${x.t.slice(0, 10)} ${f0(x.l)}`).join(' | '));

try {
  const etf = farside('btc'), v = etf.filter((r) => r.total != null);
  console.log('\nETF BTC DIARIO (US$ M, últimos 12):'); etf.slice(-12).forEach((r) => console.log(`  ${r.fecha} ${String(r.total).padStart(8)}${r.parcial ? ' (parcial)' : ''}`));
  const s = (a, b) => v.slice(a, b).reduce((x, r) => x + r.total, 0), n = v.length;
  console.log('Suma 5d', f0(s(n - 5, n)), '· 10d', f0(s(n - 10, n)), '· 20d', f0(s(n - 20, n)), '· 60d', f0(s(n - 60, n)));
  // peores ventanas de 20 días (un episodio por mes) y qué hizo BTC después
  const win = []; for (let i = 20; i <= n; i++) win.push({ d: v[i - 1].d, s: s(i - 20, i) });
  win.sort((a, b) => a.s - b.s);
  const eps = []; for (const x of win) if (!eps.some((e) => Math.abs(Date.parse(e.d) - Date.parse(x.d)) < 45 * 864e5)) eps.push(x);
  const cmAll = await coinmetrics('btc', '2024-01-01');
  console.log('PEORES 20 DÍAS DE ETF y qué hizo BTC después:');
  for (const e of eps.slice(0, 5)) {
    const i = cmAll.findIndex((x) => x.d >= e.d); if (i < 0) continue;
    const p = cmAll[i].px, nx = (k) => (cmAll[i + k] ? ((cmAll[i + k].px / p - 1) * 100).toFixed(0) + '%' : '-');
    const sg = cmAll.slice(i, i + 60), mn = Math.min(...sg.map((x) => x.px));
    console.log(`  ${e.d} ${f0(e.s)}M · precio ${f0(p)} · mín. siguientes 60d ${f0(mn)} (${((mn / p - 1) * 100).toFixed(0)}%) · +30d ${nx(30)} · +90d ${nx(90)}`);
  }
} catch (e) { console.log('\nETF: sin dato', e.message); }

if (sym === 'BTCUSDT') {
  const cb = await (await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400', { headers: { 'User-Agent': 'radar' } })).json();
  const bn = new Map(dc.map((x) => [x.t.slice(0, 10), x.c]));
  console.log('\nPRIMA COINBASE diaria (negativa = EE.UU. vende):',
    cb.slice(0, 10).reverse().map((c) => { const k = new Date(c[0] * 1000).toISOString().slice(0, 10); return bn.has(k) ? `${k.slice(5)} ${((c[4] / bn.get(k) - 1) * 100).toFixed(3)}%` : null; }).filter(Boolean).join(' · '));
}
