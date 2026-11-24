// Estudio: ¿qué indicador de valuación separa buenos y malos momentos de compra a 1 y 2 años?
// Uso: node analisis/valuacion.mjs [btc|eth]
// Resultado nov-2026 (BTC desde 2014): media 200 semanas, MVRV y caída desde máximo separan mucho;
// Mayer y Fear & Greed poco. Ver CLAUDE.md.
import { coinmetrics, avg, med } from './lib.mjs';

const asset = process.argv[2] ?? 'btc';
const cm = await coinmetrics(asset);
const fng = asset === 'btc'
  ? new Map((await (await fetch('https://api.alternative.me/fng/?limit=0')).json()).data.map((d) => [new Date(d.timestamp * 1000).toISOString().slice(0, 10), +d.value]))
  : new Map();
const px = cm.map((d) => d.px), n = px.length, rows = [];
let ath = 0;
for (let i = 0; i < n; i++) {
  ath = Math.max(ath, px[i]);
  if (i < 1400) continue;
  const sem = []; for (let k = i; k > i - 1400; k -= 7) sem.push(px[k]);
  rows.push({ d: cm[i].d, mayer: px[i] / avg(px.slice(i - 199, i + 1)), wma: px[i] / avg(sem), mvrv: cm[i].mvrv, dd: px[i] / ath - 1, fng: fng.get(cm[i].d),
    f1: i + 365 < n ? px[i + 365] / px[i] - 1 : null, f2: i + 730 < n ? px[i + 730] / px[i] - 1 : null });
}
const r = rows.filter((x) => x.d >= '2014-01-01');
function tab(nombre, key, cortes) {
  console.log('\n' + nombre);
  for (let j = 0; j < cortes.length - 1; j++) {
    const s = r.filter((x) => x[key] != null && x[key] >= cortes[j] && x[key] < cortes[j + 1]);
    const a = s.filter((x) => x.f1 != null).map((x) => x.f1), b = s.filter((x) => x.f2 != null).map((x) => x.f2);
    const tramo = `  [${cortes[j]}, ${cortes[j + 1]})`.padEnd(18);
    if (!a.length) { console.log(tramo, 'días', s.length); continue; }
    console.log(tramo, 'días', String(s.length).padStart(4), '| 1 año: mediana', (med(a) * 100).toFixed(0).padStart(5) + '%', 'positivo', (a.filter((x) => x > 0).length / a.length * 100).toFixed(0) + '%',
      'peor', (Math.min(...a) * 100).toFixed(0) + '%', '| 2 años: mediana', b.length ? (med(b) * 100).toFixed(0) + '%' : '-', 'positivo', b.length ? (b.filter((x) => x > 0).length / b.length * 100).toFixed(0) + '%' : '-');
  }
}
console.log(`${asset.toUpperCase()} · ${r[0]?.d} → ${r.at(-1)?.d}`);
tab('Precio / media 200 semanas', 'wma', [0, 1, 1.25, 1.5, 2, 3, 5, 99]);
tab('MVRV', 'mvrv', [0, 1, 1.25, 1.5, 2, 2.5, 3.5, 99]);
tab('Caída desde máximo histórico', 'dd', [-1, -0.75, -0.6, -0.5, -0.35, -0.2, -0.1, 0.01]);
tab('Múltiplo de Mayer', 'mayer', [0, 0.8, 1, 1.2, 1.5, 2, 2.4, 9]);
if (fng.size) tab('Fear & Greed', 'fng', [0, 15, 25, 45, 55, 75, 101]);
const base = r.filter((x) => x.f1 != null).map((x) => x.f1);
console.log('\nBase (todos los días): 1 año mediana', (med(base) * 100).toFixed(0) + '%', 'positivo', (base.filter((x) => x > 0).length / base.length * 100).toFixed(0) + '%');
const h = r.at(-1);
console.log('Hoy:', { fecha: h.d, wma: h.wma.toFixed(2), mvrv: h.mvrv?.toFixed(2) ?? '(sin dato hoy)', caida: (h.dd * 100).toFixed(0) + '%', mayer: h.mayer.toFixed(2), fng: h.fng });
