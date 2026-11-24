// Estudio: ¿el volumen semanal (capitulación) mejora la señal de compra?
// Uso: node analisis/volumen.mjs
// Resultado nov-2026: NO. En BTC, caída >50% con volumen >1,5x rindió peor que sin volumen; en ETH/SOL parece
// ayudar por semanas, pero agrupado en episodios independientes es 50/50 (mezcla capitulaciones con arranques de rally).
import { binance, avg, med } from './lib.mjs';

function stat(nombre, s) {
  const a = s.filter((x) => x.f52 != null).map((x) => x.f52), b = s.filter((x) => x.f26 != null).map((x) => x.f26), m = s.filter((x) => isFinite(x.mae)).map((x) => x.mae);
  if (!s.length) return console.log('  ' + nombre.padEnd(48), '0');
  console.log('  ' + nombre.padEnd(48), String(s.length).padStart(4), 'sem | 26s', (med(b) * 100).toFixed(0).padStart(5) + '%', '| 52s', a.length ? (med(a) * 100).toFixed(0).padStart(5) + '%' : '    -',
    'pos', a.length ? (a.filter((x) => x > 0).length / a.length * 100).toFixed(0) + '%' : '-', '| caída extra', (med(m) * 100).toFixed(0) + '%');
}
for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
  const k = await binance(sym, '1w');
  const r = [];
  for (let i = 52; i < k.length; i++) {
    const x = k[i], va = avg(k.slice(i - 20, i).map((y) => y.qv)), rng = x.h - x.l, hi = Math.max(...k.slice(0, i + 1).map((y) => y.h));
    r.push({ i, t: x.t, vm: x.qv / va, mecha: rng ? (Math.min(x.o, x.c) - x.l) / rng : 0, min52: x.l < Math.min(...k.slice(i - 52, i).map((y) => y.l)), dd: x.c / hi - 1,
      f26: i + 26 < k.length ? k[i + 26].c / x.c - 1 : null, f52: i + 52 < k.length ? k[i + 52].c / x.c - 1 : null,
      mae: Math.min(...k.slice(i + 1, i + 27).map((y) => y.l)) / x.c - 1 });
  }
  console.log(`\n=== ${sym} (${r[0].t} → ${r.at(-1).t})`);
  stat('todas', r);
  stat('volumen >2x', r.filter((x) => x.vm > 2));
  stat('capitulación: vol>1,5x + mecha>40% + mín 52s', r.filter((x) => x.vm > 1.5 && x.mecha > 0.4 && x.min52));
  stat('caída >50% (solo valuación)', r.filter((x) => x.dd < -0.5));
  stat('caída >50% + volumen >1,5x', r.filter((x) => x.dd < -0.5 && x.vm > 1.5));
  stat('caída >50% + volumen ≤1,5x', r.filter((x) => x.dd < -0.5 && x.vm <= 1.5));
  // episodios independientes (semanas a ≤8 de distancia = mismo episodio)
  const ev = r.filter((x) => x.dd < -0.5 && x.vm > 1.5), eps = [];
  for (const e of ev) { const l = eps.at(-1); if (l && e.i - l.at(-1).i <= 8) l.push(e); else eps.push([e]); }
  console.log(`  episodios independientes (${eps.length}):`, eps.map((g) => `${g[0].t} → 52s ${g[0].f52 == null ? '-' : (g[0].f52 * 100).toFixed(0) + '%'}`).join(' | '));
  console.log('  últimas 4 semanas:', r.slice(-4).map((x) => `${x.t} vol ${x.vm.toFixed(2)}x mecha ${(x.mecha * 100).toFixed(0)}%${x.min52 ? ' MÍN52' : ''}`).join(' | '));
}
