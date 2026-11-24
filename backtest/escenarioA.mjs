import { load, rsi } from './lib.mjs';
// Versión genérica (sin niveles fijos) del Escenario A del radar: barrida del mínimo de 20 días + recuperación + mecha/volumen
// Entrada al cierre de confirmación, objetivo +5%, stop bajo la barrida, máx 20 días.
for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
  const k = load(sym), R = rsi(k.map((x) => x.c), 14);
  const res = { filtrado: [], soloBarrida: [], azar: [] };
  const sim = (i, stop, tgtPct = 5) => {
    const e = k[i].c, tgt = e * (1 + tgtPct / 100);
    for (let j = i + 1; j < Math.min(k.length, i + 21); j++) {
      if (k[j].l <= stop) return Math.min(k[j].o, stop) / e - 1;
      if (k[j].h >= tgt) return Math.max(k[j].o, tgt) / e - 1;
    }
    return k[Math.min(k.length - 1, i + 20)].c / e - 1;
  };
  for (let i = 25; i < k.length - 1; i++) {
    const prevMin = Math.min(...k.slice(i - 20, i).map((x) => x.l));
    const s = k[i];
    if (s.l >= prevMin) continue;
    const rng = s.h - s.l, wick = rng ? (Math.min(s.o, s.c) - s.l) / rng : 0;
    const vm = s.v / (k.slice(i - 20, i).reduce((a, x) => a + x.v, 0) / 20);
    // confirmación: el mismo día o al siguiente cierra sobre el mínimo previo
    const conf = s.c > prevMin ? i : k[i + 1].c > prevMin ? i + 1 : -1;
    const stop = s.l * 0.995;
    if (conf > 0) res.soloBarrida.push(sim(conf, stop) - 0.003);
    if (conf > 0 && wick >= 0.4 && vm >= 1.5) res.filtrado.push(sim(conf, stop) - 0.003);
  }
  // baseline: entrar cualquier día con el mismo esquema (stop = 1 ATR aprox: mínimo 3 días)
  for (let i = 25; i < k.length - 21; i += 3) res.azar.push(sim(i, Math.min(...k.slice(i - 2, i + 1).map((x) => x.l)) * 0.995) - 0.003);
  console.log(`\n${sym}`);
  for (const [n, a] of Object.entries(res)) {
    const w = a.filter((x) => x > 0);
    console.log(' ', n.padEnd(12), 'n=' + String(a.length).padEnd(5), 'win%', (w.length / a.length * 100).toFixed(0).padStart(3), ' media/trade', (a.reduce((s, x) => s + x, 0) / a.length * 100).toFixed(2).padStart(6) + '%');
  }
}
