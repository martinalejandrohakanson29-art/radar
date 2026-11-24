import { sma, ema, rsi, atr, hh, ll } from './lib.mjs';
export function indicators(k) {
  const c = k.map((x) => x.c), h = k.map((x) => x.h), l = k.map((x) => x.l);
  const I = { c, rsi2: rsi(c, 2), rsi14: rsi(c, 14), atr14: atr(k, 14) };
  for (const p of [5, 10, 20, 30, 50, 100, 150, 200]) { I['sma' + p] = sma(c, p); I['ema' + p] = ema(c, p); }
  for (const p of [10, 20, 30, 55]) I['hh' + p] = hh(c, p);
  for (const p of [5, 10, 15, 20]) I['ll' + p] = ll(c, p);
  return I;
}
export function catalog(I) {
  const S = {};
  S['BuyHold'] = { entry: () => true, exit: () => false };
  for (const p of [20, 50, 100, 200]) S[`Precio>SMA${p}`] = { entry: (i) => I.c[i] > I['sma' + p][i], exit: (i) => I.c[i] < I['sma' + p][i] };
  for (const [f, s] of [[10, 30], [20, 50], [20, 100], [50, 200]]) S[`EMA${f}/${s}`] = { entry: (i) => I['ema' + f][i] > I['ema' + s][i], exit: (i) => I['ema' + f][i] < I['ema' + s][i] };
  for (const [e, x] of [[20, 10], [30, 15], [55, 20]]) {
    S[`Donchian${e}/${x}`] = { entry: (i) => I.c[i] > I['hh' + e][i], exit: (i) => I.c[i] < I['ll' + x][i] };
    S[`Donchian${e}/${x}+SMA200`] = { entry: (i) => I.c[i] > I['hh' + e][i] && I.c[i] > I.sma200[i], exit: (i) => I.c[i] < I['ll' + x][i] };
  }
  for (const m of [2.5, 3, 4]) S[`Ruptura20+ATRtrail${m}`] = {
    entry: (i) => I.c[i] > I.hh20[i] && I.c[i] > I.sma100[i],
    exit: () => false,
    stop: (i, pos) => pos.peak - m * I.atr14[i],
  };
  for (const t of [10, 25]) S[`RSI2<${t} en tendencia`] = {
    entry: (i) => I.c[i] > I.sma200[i] && I.rsi2[i] < t,
    exit: (i, pos) => I.c[i] > I.sma5[i] || i - pos.i >= 10,
  };
  // Híbrido: tendencia (EMA20>EMA50 y precio>SMA100) + salida por trailing ATR 3 o pérdida de EMA50
  S['Hibrido tend+ATR3'] = {
    entry: (i) => I.ema20[i] > I.ema50[i] && I.c[i] > I.sma100[i] && I.c[i] > I.hh10[i],
    exit: (i) => I.c[i] < I.ema50[i],
    stop: (i, pos) => pos.peak - 3 * I.atr14[i],
  };
  return S;
}
