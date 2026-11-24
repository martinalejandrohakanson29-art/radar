// Análisis de compra a largo plazo: BTC (núcleo) + ETH y SOL (satélite).
// Valuación (¿está barato respecto a su historia?) decide SI comprar; demanda/macro decide CUÁNTO y qué tan rápido.
// Fuentes gratuitas: CoinMetrics (precio + MVRV), alternative.me (Fear & Greed), CoinGecko (tesorerías de empresas),
// DefiLlama (stablecoins), Coinbase (prima EE.UU.), Binance (volumen semanal) y, desde radar.mjs: Farside (ETF),
// Yahoo (Nasdaq / dólar) y Binance (velas diarias, ratios contra BTC, funding).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fmt = (n, d = 0) => n == null || Number.isNaN(n) ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n) => n == null ? '—' : 'USD ' + fmt(n, n < 10 ? 4 : n < 1000 ? 2 : 0);
const pct = (n, d = 1) => n == null ? '—' : (n > 0 ? '+' : '') + fmt(n, d) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'btc-radar', ...headers }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const safe = (p) => p.catch((e) => ({ error: e.message }));

// ---------- descarga ----------
async function coinmetrics(asset) {
  const j = await getJSON(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${asset}&metrics=PriceUSD,CapMVRVCur&frequency=1d&page_size=10000&start_time=2011-01-01`);
  const rows = j.data.filter((d) => d.PriceUSD).map((d) => ({ d: d.time.slice(0, 10), px: +d.PriceUSD, mvrv: d.CapMVRVCur == null ? null : +d.CapMVRVCur }));
  if (rows.length < 400) throw new Error('pocos datos');
  return { rows };
}
async function fearGreed() {
  const j = await getJSON('https://api.alternative.me/fng/?limit=30');
  return { serie: j.data.map((x) => ({ d: day(x.timestamp * 1000), v: +x.value, txt: x.value_classification })) };
}
async function tesorerias() {
  const j = await getJSON('https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin');
  const strat = j.companies.find((c) => /strategy|microstrategy/i.test(c.name));
  return {
    total: j.total_holdings,
    empresas: j.companies.length,
    top: j.companies.slice(0, 5).map((c) => ({ nombre: c.name, btc: c.total_holdings, costo: c.total_entry_value_usd && c.total_holdings ? c.total_entry_value_usd / c.total_holdings : null })),
    strategy: strat ? { btc: strat.total_holdings, costo: strat.total_entry_value_usd / strat.total_holdings } : null,
  };
}
async function stablecoins() {
  const j = await getJSON('https://stablecoins.llama.fi/stablecoincharts/all');
  const s = j.map((x) => ({ d: day(x.date * 1000), v: x.totalCirculating?.peggedUSD })).filter((x) => x.v);
  const last = s.at(-1), m30 = s.at(-31), m90 = s.at(-91);
  return { total: last.v, chg30: (last.v / m30.v - 1) * 100, chg90: (last.v / m90.v - 1) * 100 };
}
// Prima Coinbase: BTC-USD en Coinbase vs BTCUSDT en Binance. Positiva = compradores de EE.UU. (institucional) pagando más.
async function primaCoinbase(btc) {
  const cb = await getJSON('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400');
  const bn = new Map(btc.closed.map((k) => [day(k.t), k.close]));
  const pares = cb.map((c) => ({ d: day(c[0] * 1000), cb: c[4] })).filter((x) => bn.has(x.d)).sort((a, b) => a.d.localeCompare(b.d));
  const prima = pares.map((x) => (x.cb / bn.get(x.d) - 1) * 100);
  if (prima.length < 14) throw new Error('pocos datos');
  return { prom7: avg(prima.slice(-7)), prom30: avg(prima.slice(-30)), serie: pares.map((x, i) => ({ d: x.d, v: prima[i] })) };
}
// Volumen semanal en USD (Binance). Solo informativo: el estudio de nov-2026 no le encontró ventaja confiable.
async function volumenSemanal(symbol) {
  const raw = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1w&limit=60`);
  const k = raw.map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], qv: +x[7], closeT: x[6] })).filter((x) => x.closeT < Date.now());
  const n = k.length, w = k[n - 1];
  const rango = w.h - w.l;
  return {
    semana: day(w.t), mult: w.qv / avg(k.slice(n - 21, n - 1).map((x) => x.qv)),
    mecha: rango ? (Math.min(w.o, w.c) - w.l) / rango : 0,
    min52: w.l < Math.min(...k.slice(Math.max(0, n - 53), n - 1).map((x) => x.l)),
  };
}

// ---------- historial propio de tesorerías (CoinGecko no da histórico gratis) ----------
async function historiaTesorerias(dataDir, t) {
  const f = path.join(dataDir, 'tesorerias.json');
  let h = {};
  try { h = JSON.parse(await readFile(f, 'utf8')); } catch {}
  if (!t.error) {
    h[new Date().toISOString().slice(0, 10)] = { total: t.total, strategy: t.strategy?.btc ?? null };
    await writeFile(f, JSON.stringify(h), 'utf8');
  }
  const fechas = Object.keys(h).sort();
  const hoy = fechas.at(-1);
  // la foto más vieja dentro de los últimos ~35 días
  const limite = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10);
  const base = fechas.find((x) => x >= limite);
  if (!hoy || !base || base === hoy) return { dias: 0 };
  const dias = Math.round((new Date(hoy) - new Date(base)) / 864e5);
  return { dias, desde: base, total: h[hoy].total - h[base].total, strategy: h[hoy].strategy != null && h[base].strategy != null ? h[hoy].strategy - h[base].strategy : null };
}

// ---------- valuación con estadística histórica ----------
const TRAMOS = {
  wma: [0, 1, 1.25, 1.5, 2, 3, 99],
  mvrv: [0, 1, 1.25, 1.5, 2, 2.5, 99],
  dd: [-1, -0.75, -0.6, -0.5, -0.35, -0.2, -0.1, 0.01],
  mayer: [0, 0.8, 1, 1.5, 2, 2.4, 99],
};
function serieValuacion(rows) {
  const px = rows.map((r) => r.px), n = px.length, out = [];
  let ath = 0;
  for (let i = 0; i < n; i++) {
    ath = Math.max(ath, px[i]);
    if (i < 1400) continue;
    const sma200 = avg(px.slice(i - 199, i + 1));
    const sem = []; for (let k = i; k > i - 1400; k -= 7) sem.push(px[k]);
    out.push({ d: rows[i].d, px: px[i], wmaVal: avg(sem), mayer: px[i] / sma200, wma: px[i] / avg(sem), mvrv: rows[i].mvrv, dd: px[i] / ath - 1, ath,
      f1: i + 365 < n ? px[i + 365] / px[i] - 1 : null, f2: i + 730 < n ? px[i + 730] / px[i] - 1 : null });
  }
  return out;
}
function estadTramo(serie, key, valor) {
  const e = TRAMOS[key], j = e.findIndex((x, i) => valor >= x && valor < e[i + 1]);
  if (j < 0) return null;
  if (!serie.length || serie[0].d > '2021-12-31') return { poco: true }; // con menos de ~5 años de serie es un solo régimen (SOL)
  const s = serie.filter((x) => x.d >= '2014-01-01' && x[key] != null && x[key] >= e[j] && x[key] < e[j + 1]);
  const a = s.filter((x) => x.f1 != null).map((x) => x.f1), b = s.filter((x) => x.f2 != null).map((x) => x.f2);
  if (a.length < 60) return { dias: s.length, poco: true };
  return { desde: e[j], hasta: e[j + 1], dias: s.length, inicio: s[0].d.slice(0, 4), med1: med(a) * 100, pos1: a.filter((x) => x > 0).length / a.length * 100, peor1: Math.min(...a) * 100,
    med2: b.length >= 60 ? med(b) * 100 : null, pos2: b.length >= 60 ? b.filter((x) => x > 0).length / b.length * 100 : null };
}

const it = (key, nombre, puntos, valor, lectura, extra = {}) => ({ key, nombre, puntos, valor, lectura, ...extra });

// Valuación de un activo. `alt` usa umbrales de caída más exigentes (las alts suelen caer 80-95% en los bear markets).
function valuacion(cm, precio, { alt = false } = {}) {
  const rows = cm.rows.map((r) => ({ ...r }));
  if (rows.at(-1).d === day(Date.now())) rows[rows.length - 1].px = precio; else rows.push({ d: day(Date.now()), px: precio, mvrv: null });
  const ultMvrv = [...rows].reverse().find((r) => r.mvrv != null);
  const serie = serieValuacion(rows);
  const items = [], niveles = [];
  let precioRealizado = null;
  // si no hay 200 semanas de historia (SOL hasta 2024), igual calcular caída y Mayer
  let ath = 0; for (const r of rows) ath = Math.max(ath, r.px);
  const pxs = rows.map((r) => r.px), n = pxs.length;
  const hoy = serie.at(-1) ?? { dd: precio / ath - 1, ath, mayer: n >= 200 ? precio / avg(pxs.slice(n - 200)) : null };

  if (hoy.wma != null) {
    const w = hoy.wma;
    items.push(it('wma', 'Precio vs media de 200 semanas', w < 1 ? 3 : w < 1.25 ? 2 : w < 1.5 ? 1 : w < 2 ? 0 : w < 3 ? -1 : -2,
      `${fmt(w, 2)}x`, w < 1 ? 'Debajo de la media de 200 semanas: zona histórica de compra de ciclo' : w < 1.5 ? 'Cerca del piso de ciclo' : w < 2 ? 'Zona media' : 'Lejos del piso: caro en términos de ciclo',
      { hist: estadTramo(serie, 'wma', w) }));
    niveles.push({ nombre: 'Media de 200 semanas (piso de ciclo)', v: hoy.wmaVal });
  }
  if (ultMvrv) {
    precioRealizado = ultMvrv.px / ultMvrv.mvrv; // el precio realizado se mueve lento: ajustar MVRV al precio en vivo
    const m = precio / precioRealizado;
    hoy.mvrv = m;
    items.push(it('mvrv', 'MVRV (precio vs costo promedio de todos los holders)', m < 1 ? 3 : m < 1.25 ? 2 : m < 1.5 ? 1 : m < 2 ? 0 : m < 2.5 ? -1 : -2,
      `${fmt(m, 2)}`, m < 1 ? 'El mercado entero está en pérdida: capitulación histórica' : m < 1.5 ? 'El holder promedio gana poco: barato' : m < 2.5 ? 'Ganancia moderada' : 'Ganancias grandes: zona de techo',
      { hist: serie.length ? estadTramo(serie, 'mvrv', m) : null }));
    niveles.push({ nombre: 'Precio realizado (costo promedio on-chain, MVRV = 1)', v: precioRealizado });
    niveles.push({ nombre: 'MVRV 0,8 (zona de capitulaciones pasadas)', v: precioRealizado * 0.8 });
  }
  const dd = hoy.dd;
  const pDd = alt ? (dd < -0.75 ? 2 : dd < -0.6 ? 1 : dd > -0.2 ? -1 : 0) : (dd < -0.5 ? 2 : dd < -0.35 ? 1 : dd > -0.1 ? -1 : 0);
  items.push(it('dd', 'Caída desde el máximo histórico', pDd, pct(dd * 100), `Máximo ${usd(hoy.ath)}`, { hist: serie.length ? estadTramo(serie, 'dd', dd) : null }));
  if (hoy.mayer != null) {
    const my = hoy.mayer;
    items.push(it('mayer', 'Múltiplo de Mayer (precio / media 200 días)', my < 0.8 ? 1 : my > 2.4 ? -2 : my > 2 ? -1 : 0,
      fmt(my, 2), my < 0.8 ? 'Muy por debajo de la tendencia anual' : my < 1 ? 'Debajo de la tendencia anual' : my > 2.4 ? 'Euforia' : 'Normal',
      { hist: serie.length ? estadTramo(serie, 'mayer', my) : null }));
  }
  // zona relativa al máximo puntaje posible (SOL no tiene MVRV ni, hasta 2024, media de 200 semanas)
  const maxPts = { wma: 3, mvrv: 3, dd: 2, mayer: 1 };
  const pVal = items.reduce((s, x) => s + x.puntos, 0), tope = items.reduce((s, x) => s + maxPts[x.key], 0), r = pVal / tope;
  const zona = r >= 0.65 ? 'MUY BARATO' : r >= 0.33 ? 'BARATO' : r >= -0.12 ? 'PRECIO JUSTO' : r >= -0.35 ? 'CARO' : 'MUY CARO';
  return { items, niveles, pVal, tope, zona, precioRealizado, hoy };
}

function itemVolumen(v) {
  if (!v || v.error) return null;
  const capit = v.mult > 1.5 && v.min52;
  return it('vol', 'Volumen semanal (solo informativo)', 0, `${fmt(v.mult, 2)}x`,
    `Semana del ${v.semana} vs promedio de 20 semanas · mecha inferior ${fmt(v.mecha * 100)}% del rango${v.min52 ? ' · marcó mínimo de 52 semanas' : ''}${capit ? ' · PATRÓN DE CAPITULACIÓN' : ''}. ` +
    'Medido 2018–2026: no mejora la señal (en BTC la empeora; en ETH/SOL fue 50/50 por episodio), por eso no suma puntos.');
}

function itemEtf(rows, nombre, umbral) {
  const c = (rows ?? []).filter((r) => !r.parcial && r.total != null);
  if (c.length < 5) return null;
  const k = Math.min(20, c.length);
  const s = (n) => c.slice(-n).reduce((a, r) => a + r.total, 0);
  const s5 = s(5), sk = s(k);
  let racha = 0; const sg = Math.sign(c.at(-1).total); for (let i = c.length - 1; i >= 0 && Math.sign(c[i].total) === sg; i--) racha++;
  const giro = sk < 0 && s5 > 0;
  return it('etf', `ETF de ${nombre} en EE.UU. (${k} días hábiles)`, sk > 0 || giro ? 1 : sk < -umbral ? -1 : 0, `${fmt(sk, k < 20 ? 1 : 0)}M`,
    `5 días: ${fmt(s5, 1)}M${c.length >= 60 ? ` · 60 días: ${fmt(s(60))}M` : ''} · ${sg > 0 ? `${racha} días seguidos de entradas` : `${racha} días seguidos de salidas`}${giro ? ' · GIRO: vuelven a entrar' : ''}`,
    { s5, sk });
}

// ---------- Retest de zona (uso táctico de la reserva) ----------
// Requisito: el precio vuelve a la zona y arma piso (mínimo más alto o barrida recuperada) con cierre arriba de pisoRecupera.
// Confirmaciones: ETF con salidas chicas o entradas en los días del retest, prima Coinbase recuperada, funding negativo.
export function retest(btc, etfRows, cb, fundBtc, c) {
  const k = btc.closed, n = k.length, last = k[n - 1];
  // solo velas posteriores al mínimo del ciclo (la caída que lo marcó no es un retest)
  const ventana = k.slice(n - c.diasVentana).filter((x) => day(x.t) > (c.minimoCicloFecha ?? ''));
  const enZona = ventana.filter((x) => x.low <= c.techoZona);
  const checks = [];
  const ck = (nombre, ok, detalle, core = false) => checks.push({ nombre, ok, detalle, core });
  const base = { titulo: c.titulo, monto: c.montoReserva, checks };

  if (last.close < c.invalidacion) {
    ck(`Cierre diario arriba de ${usd(c.invalidacion)}`, false, `Último cierre ${usd(last.close)} (${day(last.t)})`, true);
    return { ...base, estado: 'NO AGREGAR', nivel: 'sell',
      texto: `Perdió la zona: cierre debajo de ${usd(c.invalidacion)}. No usar la reserva; dejar trabajar las órdenes límite de abajo (precio realizado). Se re-evalúa si recupera ${usd(c.pisoRecupera)} al cierre.` };
  }
  if (!enZona.length) {
    ck(`Precio vuelve a la zona (mínimo diario ≤ ${usd(c.techoZona)})`, false,
      `Sin retest desde el mínimo del ${c.minimoCicloFecha}${ventana.length ? ` · mínimo posterior ${usd(Math.min(...ventana.map((x) => x.low)))}` : ''} · último cierre ${usd(last.close)} (${pct((c.techoZona / last.close - 1) * 100)} hasta la zona)`, true);
    return { ...base, estado: 'SIN RETEST', nivel: 'es',
      texto: `Todavía no volvió a la zona. Si baja a ${usd(c.pisoRecupera)}–${usd(c.techoZona)}, esta tarjeta evalúa si conviene usar USD ${c.montoReserva} de la reserva. Si sube, no perseguir: la reserva se usa recién con un cierre semanal sobre la media de 200 semanas o con COMPRAR FUERTE.` };
  }

  // --- precio (requisito) ---
  const minV = enZona.reduce((a, x) => (x.low < a.low ? x : a));
  const pisoMasAlto = minV.low > c.minimoCiclo;
  const barridaRecuperada = !pisoMasAlto && minV.close >= c.pisoRecupera;
  const cierreOk = last.close >= c.pisoRecupera;
  const precioOk = (pisoMasAlto || barridaRecuperada) && cierreOk;
  ck('Arma piso en la zona', pisoMasAlto || barridaRecuperada,
    pisoMasAlto ? `Mínimo del retest ${usd(minV.low)} (${day(minV.t)}): más alto que el mínimo del ciclo ${usd(c.minimoCiclo)}`
      : barridaRecuperada ? `Perforó ${usd(c.minimoCiclo)} (mín. ${usd(minV.low)}, ${day(minV.t)}) pero cerró el día en ${usd(minV.close)}: barrida recuperada`
      : `Perforó el mínimo del ciclo (${usd(minV.low)}, ${day(minV.t)}) y no lo recuperó en el día`, true);
  ck(`Último cierre diario arriba de ${usd(c.pisoRecupera)}`, cierreOk, `Cierre ${usd(last.close)} (${day(last.t)})`, true);

  // --- ETF en los días del retest ---
  const desde = day(enZona[0].t);
  const comp = (etfRows ?? []).filter((r) => !r.parcial && r.total != null).map((r) => ({ ...r, d: day(Date.parse(r.fecha + ' UTC')) }));
  let dias = comp.filter((r) => r.d >= desde);
  
  let etfOk = null, etfTxt = 'Todavía no hay días hábiles de ETF completos desde el retest';
  if (dias.length) {
    const peor = Math.min(...dias.map((r) => r.total));
    const dosEntradas = comp.length >= 2 && comp.slice(-2).every((r) => r.total > 0);
    etfOk = peor > c.etfSalidaChicaMillones || dosEntradas;
    etfTxt = `Días del retest: ${dias.map((r) => `${r.fecha.slice(0, 6)} ${fmt(r.total, 1)}M`).join(' · ')} · peor día ${fmt(peor, 1)}M vs ${fmt(c.etfReferenciaMillones)}M de la caída (19–20/11)${dosEntradas ? ' · 2 días seguidos de entradas' : ''}`;
  }
  ck(`ETF: salidas chicas (> ${fmt(c.etfSalidaChicaMillones)}M/día) o 2 días de entradas`, etfOk, etfTxt);

  // --- Prima Coinbase (promedio 3 días) ---
  let cbOk = null, cbTxt = 'Sin dato de Coinbase';
  if (!cb.error && cb.serie?.length >= 3) {
    const p3 = avg(cb.serie.slice(-3).map((x) => x.v));
    cbOk = p3 >= c.primaCoinbaseMinima;
    cbTxt = `Promedio 3 días ${pct(p3, 3)} (mínimo ${pct(c.primaCoinbaseMinima, 2)}) · últimos: ${cb.serie.slice(-3).map((x) => pct(x.v, 3)).join(', ')}`;
  }
  ck('Prima Coinbase: EE.UU. deja de vender', cbOk, cbTxt);

  // --- Funding ---
  const fOk = fundBtc.error ? null : fundBtc.prom3d < 0;
  ck('Funding negativo (apuestas a la baja)', fOk, fundBtc.error ? 'Sin dato' : `Promedio 3 días ${fmt(fundBtc.prom3d, 4)}%`);

  const conf = [etfOk, cbOk, fOk].filter((x) => x === true).length;
  let estado, nivel, texto;
  if (precioOk && conf >= c.confirmacionesMinimas) {
    estado = 'USAR RESERVA'; nivel = 'op';
    texto = `Retest con confirmación: piso en la zona y ${conf} de 3 confirmaciones. Comprar USD ${c.montoReserva} de la reserva (spot). La orden en el precio realizado queda puesta igual.`;
  } else if (precioOk) {
    estado = 'ATENTO'; nivel = 'at';
    texto = `El precio arma piso, pero faltan confirmaciones (${conf} de ${c.confirmacionesMinimas}): los grandes todavía venden. No usar la reserva aún; se re-evalúa con cada cierre.`;
  } else {
    estado = 'ATENTO'; nivel = 'at';
    texto = `Está en la zona pero sin piso confirmado. No comprar en la caída: esperar un cierre diario arriba de ${usd(c.pisoRecupera)}. Si cierra debajo de ${usd(c.invalidacion)}, no agregar.`;
  }
  return { ...base, estado, nivel, texto, confirmaciones: conf };
}

// ---------- análisis ----------
export async function largoPlazo({ btc, precio, etfRows, macro, fundBtc, dataDir, alts = {}, retestCfg = null }) {
  const altNames = Object.keys(alts);
  const [cm, fg, te, st, cb, volBtc, ...altRaw] = await Promise.all([
    safe(coinmetrics('btc')), safe(fearGreed()), safe(tesorerias()), safe(stablecoins()), safe(primaCoinbase(btc)), safe(volumenSemanal('BTCUSDT')),
    ...altNames.flatMap((n) => [safe(coinmetrics(n.toLowerCase())), safe(volumenSemanal(alts[n].par))]),
  ]);
  const errores = [];
  for (const [n, v] of Object.entries({ 'CoinMetrics BTC': cm, 'Fear&Greed': fg, CoinGecko: te, DefiLlama: st, Coinbase: cb, 'Volumen BTC': volBtc })) if (v.error) errores.push(`${n}: ${v.error}`);
  const teHist = await historiaTesorerias(dataDir, te).catch(() => ({ dias: 0 }));

  // ---- Valuación BTC ----
  let V = null;
  if (!cm.error) V = valuacion(cm, precio);
  const val = V ? [...V.items] : [], niveles = V ? [...V.niveles] : [];
  const iv = itemVolumen(volBtc); if (iv) val.push(iv);
  if (!te.error && te.strategy) niveles.push({ nombre: 'Costo promedio de Strategy (MSTR)', v: te.strategy.costo });
  niveles.sort((a, b) => b.v - a.v);

  // ---- Sentimiento ----
  const sen = [];
  if (!fg.error) {
    const v = fg.serie[0].v, p7 = avg(fg.serie.slice(0, 7).map((x) => x.v));
    sen.push(it('fng', 'Fear & Greed', v < 25 ? 1 : v > 75 ? -1 : 0, `${v} (${fg.serie[0].txt})`,
      `Promedio 7 días ${fmt(p7)} · ${v < 25 ? 'miedo extremo: la gente vende, buen momento para acumular de a poco' : v > 75 ? 'codicia: no perseguir el precio' : 'neutral'}`));
  }
  if (!fundBtc.error) {
    const f = fundBtc.prom3d;
    sen.push(it('funding', 'Funding de futuros (prom. 3 días)', f < 0 ? 1 : f > 0.03 ? -1 : 0, `${fmt(f, 4)}%`,
      f < 0 ? 'Apalancados apostando a la baja: suele marcar pisos' : f > 0.03 ? 'Mucho apalancamiento comprado' : 'Neutral'));
  }

  // ---- Grandes compradores / flujos ----
  const flu = [];
  const etfItem = itemEtf(etfRows, 'Bitcoin', 1000);
  if (etfItem) flu.push(etfItem);
  if (!te.error) {
    const pts = teHist.dias >= 7 ? (teHist.total > 0 ? 1 : teHist.total < 0 ? -1 : 0) : 0;
    flu.push(it('empresas', 'Empresas con BTC en tesorería', pts, `${fmt(te.total)} BTC`,
      teHist.dias >= 7 ? `${teHist.total >= 0 ? '+' : ''}${fmt(teHist.total)} BTC en ${teHist.dias} días${teHist.strategy ? ` (Strategy ${teHist.strategy >= 0 ? '+' : ''}${fmt(teHist.strategy)})` : ''}`
        : `${te.empresas} empresas · el radar guarda una foto por día; en una semana muestra si compran o venden`));
  }
  if (!cb.error) {
    flu.push(it('coinbase', 'Prima Coinbase (demanda de EE.UU.)', cb.prom7 > 0.03 ? 1 : cb.prom7 < -0.05 ? -1 : 0, pct(cb.prom7, 3),
      `Promedio 7 días · 30 días ${pct(cb.prom30, 3)} · ${cb.prom7 > 0.03 ? 'compran más en EE.UU. (institucional)' : cb.prom7 < -0.05 ? 'EE.UU. vendiendo' : 'neutral'}`));
  }
  if (!st.error) {
    flu.push(it('stables', 'Stablecoins en circulación (liquidez)', st.chg30 > 1 ? 1 : st.chg30 < -1 ? -1 : 0, `USD ${fmt(st.total / 1e9)} mil M`,
      `30 días ${pct(st.chg30)} · 90 días ${pct(st.chg90)} · ${st.chg30 > 1 ? 'entra dinero nuevo al ecosistema' : st.chg30 < -1 ? 'sale liquidez' : 'estable'}`));
  }

  // ---- Macro ----
  const mac = [];
  const tend = (m, dias = 200) => m.error || m.cierres.length < dias ? null : { sma: avg(m.cierres.slice(-dias)), max: Math.max(...m.cierres.slice(-252)) };
  const nq = macro.nasdaq, tn = tend(nq);
  if (tn) {
    const sobre = nq.precio > tn.sma, ddNq = (nq.precio / tn.max - 1) * 100;
    mac.push(it('nasdaq', 'Nasdaq (apetito por riesgo)', sobre ? 1 : -1, `${pct((nq.precio / tn.sma - 1) * 100)} vs media 200d`,
      `${sobre ? 'Arriba de su tendencia larga: mercado tomando riesgo' : 'Debajo de su tendencia larga: aversión al riesgo, BTC suele sufrir'} · ${pct(ddNq)} desde máximo de 1 año · semana ${pct(nq.chg5d, 2)}`));
  }
  const dx = macro.dolar, td = tend(dx);
  if (td) {
    const debil = dx.precio < td.sma;
    mac.push(it('dolar', 'Dólar (DXY)', debil ? 1 : 0, `${pct((dx.precio / td.sma - 1) * 100)} vs media 200d`,
      debil ? 'Dólar débil: viento a favor para BTC' : 'Dólar firme: sin ayuda'));
  }

  // ---- Recomendación BTC ----
  const suma = (a) => a.reduce((s, x) => s + x.puntos, 0);
  const pVal = V?.pVal ?? 0, pDem = suma([...sen, ...flu, ...mac]);
  const zona = V?.zona ?? null;
  const demanda = pDem >= 2 ? 'A FAVOR' : pDem <= -2 ? 'EN CONTRA' : 'MIXTA';
  let reco, nivel, texto;
  if (!zona) { reco = 'SIN DATO'; nivel = 'es'; texto = 'No se pudo calcular la valuación.'; }
  else if (zona === 'MUY BARATO' || zona === 'BARATO') {
    if (demanda === 'A FAVOR') { reco = 'COMPRAR FUERTE'; nivel = 'op'; texto = 'Precio barato en términos de ciclo y la demanda grande acompaña. Buen momento para aumentar aportes (por ejemplo 2x tu compra habitual) y usar la reserva.'; }
    else if (demanda === 'MIXTA') { reco = 'ACUMULAR'; nivel = 'op'; texto = 'Precio barato en términos de ciclo. Comprar en tramos (semanal o en los niveles de abajo); la demanda todavía no confirma, así que no todo junto.'; }
    else { reco = 'ACUMULAR ESCALONADO'; nivel = 'at'; texto = 'Precio barato, pero los grandes compradores y el macro todavía venden: puede seguir cayendo. Comprar de a poco y dejar órdenes en los niveles de abajo; aumentar cuando giren los flujos.'; }
  } else if (zona === 'PRECIO JUSTO') { reco = 'DCA NORMAL'; nivel = 'at'; texto = 'Ni barato ni caro: mantener la compra periódica habitual, sin acelerar.'; }
  else if (zona === 'CARO') { reco = 'REDUCIR APORTES'; nivel = 'es'; texto = 'Caro en términos de ciclo: bajar el monto de compras y guardar liquidez para la próxima corrección.'; }
  else { reco = 'NO COMPRAR'; nivel = 'sell'; texto = 'Zona histórica de techo: no comprar y considerar tomar ganancias parciales.'; }

  // ---- Altcoins (satélite) ----
  const altRes = altNames.map((nombre, i) => {
    const [acm, avol] = altRaw.slice(i * 2, i * 2 + 2);
    const a = alts[nombre];
    if (acm.error) { errores.push(`CoinMetrics ${nombre}: ${acm.error}`); return { nombre, error: acm.error }; }
    if (avol.error) errores.push(`Volumen ${nombre}: ${avol.error}`);
    const AV = valuacion(acm, a.precio, { alt: true });
    const items = [...AV.items];
    const ivA = itemVolumen(avol); if (ivA) items.push(ivA);

    // Fuerza contra BTC: el beneficio extra de una alt aparece cuando su ratio deja de caer
    const dem = [];
    const r = a.ratio?.closed ?? [];
    if (r.length >= 100) {
      const rc = r.map((x) => x.close), n = rc.length, last = rc[n - 1];
      const sma50 = avg(rc.slice(n - 50)), min90 = Math.min(...rc.slice(n - 90)), max30prev = Math.max(...rc.slice(n - 31, n - 1));
      // percentil histórico del ratio con precios de CoinMetrics
      const bmap = new Map(cm.error ? [] : cm.rows.map((x) => [x.d, x.px]));
      const hist = acm.rows.filter((x) => bmap.has(x.d)).map((x) => x.px / bmap.get(x.d));
      const pctl = hist.length ? hist.filter((x) => x < last).length / hist.length * 100 : null;
      const fuerte = last > sma50, enMin = last <= min90 * 1.01;
      dem.push(it('ratio', `${nombre}/BTC (fuerza contra BTC)`, fuerte ? 1 : enMin ? -1 : 0, fmt(last, last < 0.01 ? 6 : 5),
        `${fuerte ? `Arriba de su media de 50 días: ${nombre} le está ganando a BTC` : enMin ? `En mínimo de 90 días: ${nombre} sigue perdiendo contra BTC` : `Debajo de su media de 50 días, sin nuevos mínimos`}${last > max30prev ? ' · rompió el máximo de 30 días' : ''}` +
        (pctl != null ? ` · barato vs su historia: más bajo que el ${fmt(100 - pctl)}% de los días` : '')));
    }
    const etfA = itemEtf(a.etfRows, nombre === 'ETH' ? 'Ethereum' : 'Solana', nombre === 'ETH' ? 300 : 50);
    if (etfA) dem.push(etfA);
    if (a.fund && !a.fund.error) {
      const f = a.fund.prom3d;
      dem.push(it('funding', 'Funding de futuros (prom. 3 días)', f < 0 ? 1 : f > 0.03 ? -1 : 0, `${fmt(f, 4)}%`, f < 0 ? 'Apalancados apostando a la baja' : f > 0.03 ? 'Mucho apalancamiento comprado' : 'Neutral'));
    }
    const pD = suma(dem), fuerza = dem.find((x) => x.key === 'ratio')?.puntos ?? 0;
    let aReco, aNivel, aTexto;
    if (zona === 'CARO' || zona === 'MUY CARO') { aReco = 'NO SUMAR'; aNivel = 'es'; aTexto = `BTC está caro: en esa fase las altcoins suelen estar en euforia. No sumar ${nombre}.`; }
    else if (AV.zona === 'MUY BARATO' || AV.zona === 'BARATO') {
      if (fuerza > 0 && pD >= 1) { aReco = 'ACUMULAR'; aNivel = 'op'; aTexto = `${nombre} barato y ya le gana a BTC: es la fase donde las altcoins suelen multiplicar. Completar los tramos asignados.`; }
      else if (fuerza < 0) { aReco = 'TRAMO CHICO'; aNivel = 'at'; aTexto = `${nombre} barato, pero sigue perdiendo contra BTC. Solo la porción asignada y escalonada; sumar más recién cuando el ratio deje de hacer mínimos.`; }
      else { aReco = 'ACUMULAR DE A POCO'; aNivel = 'at'; aTexto = `${nombre} barato y el ratio contra BTC dejó de caer, pero sin confirmar. Tramos chicos.`; }
    } else if (AV.zona === 'PRECIO JUSTO') { aReco = 'DCA NORMAL'; aNivel = 'at'; aTexto = `${nombre} a precio justo: solo compras periódicas chicas.`; }
    else { aReco = 'NO SUMAR'; aNivel = 'es'; aTexto = `${nombre} caro respecto a su historia.`; }
    return { nombre, precio: a.precio, reco: aReco, nivel: aNivel, texto: aTexto, zona: AV.zona, pVal: AV.pVal, tope: AV.tope, pDem: pD, val: items, dem, niveles: AV.niveles.sort((x, y) => y.v - x.v) };
  });

  const RT = retestCfg?.activo ? retest(btc, etfRows, cb, fundBtc, retestCfg) : null;

  return { reco, nivel, texto, zona, demanda, pVal, tope: V?.tope, pDem, val, sen, flu, mac, niveles, precio, tesorerias: te.error ? null : te, errores, alts: altRes, retest: RT };
}

// ---------- HTML ----------
const signo = (p) => p > 0 ? `<span class="pos">+${p}</span>` : p < 0 ? `<span class="neg">${p}</span>` : '<span class="muted">0</span>';
const fila = (x) => `<li><span class="ic">${x.key === 'vol' ? 'ℹ️' : signo(x.puntos)}</span><div><strong>${esc(x.nombre)}</strong> <b style="float:right">${esc(x.valor)}</b><br><span class="muted">${esc(x.lectura)}</span>${x.hist && !x.hist.poco
  ? `<br><span class="hist">Desde ${x.hist.inicio}, en este tramo (${x.hist.dias} días): a 1 año mediana <b>${pct(x.hist.med1, 0)}</b>, positivo ${fmt(x.hist.pos1)}% de las veces, peor caso ${pct(x.hist.peor1, 0)}${x.hist.med2 != null ? ` · a 2 años mediana ${pct(x.hist.med2, 0)} (${fmt(x.hist.pos2)}% positivo)` : ''}</span>` : ''}</div></li>`;
const bloque = (t, a, extra = '') => a.length ? `<section class="card"><h2>${t}</h2>${extra}<ul class="checks">${a.map(fila).join('')}</ul></section>` : '';
const tablaNiveles = (niv, precio, titulo) => niv.length ? `<table><caption>${titulo}</caption>
  ${niv.map((n) => `<tr><td>${esc(n.nombre)}</td><td class="num">${usd(n.v)}</td><td class="num ${n.v < precio ? 'neg' : 'pos'}">${pct((n.v / precio - 1) * 100)}</td></tr>`).join('')}
</table>` : '';

function cardAlt(a) {
  if (a.error) return `<section class="card"><h2>${esc(a.nombre)}</h2><p class="muted">Sin dato (${esc(a.error)})</p></section>`;
  return `<section class="card">
  <div class="card-head"><h2>${esc(a.nombre)} <span class="muted" style="font-weight:400">${usd(a.precio)}</span></h2><span class="badge ${a.nivel}">${esc(a.reco)}</span></div>
  <p>${esc(a.texto)}</p>
  <p class="muted">${esc(a.zona)} · valuación ${a.pVal > 0 ? '+' : ''}${a.pVal} de ${a.tope} posibles · fuerza y demanda ${a.pDem > 0 ? '+' : ''}${a.pDem}</p>
  <ul class="checks">${[...a.val, ...a.dem].map(fila).join('')}</ul>
  ${tablaNiveles(a.niveles, a.precio, 'Niveles de largo plazo')}
</section>`;
}

export function renderLargoPlazo(L) {
  return `
<h3>Compra a largo plazo — señal principal</h3>
<section class="card lp-hero">
  <div class="card-head"><h2>BTC: ${esc(L.zona ?? '—')} · demanda ${esc(L.demanda)}</h2><span class="badge ${L.nivel}">${esc(L.reco)}</span></div>
  <p>${esc(L.texto)}</p>
  <p class="muted">Valuación ${L.pVal > 0 ? '+' : ''}${L.pVal} de ${L.tope ?? '—'} posibles (mide si el precio está barato respecto a su historia) · Demanda y macro ${L.pDem > 0 ? '+' : ''}${L.pDem} puntos (mide si ETF, empresas, liquidez y Nasdaq acompañan).
  La valuación decide si conviene comprar; la demanda decide cuánto y qué tan rápido.</p>
  ${L.alts?.length ? `<p class="muted" style="margin-bottom:0">Satélite: ${L.alts.filter((a) => !a.error).map((a) => `<b>${esc(a.nombre)}</b> ${esc(a.reco)} (${esc(a.zona)})`).join(' · ')}</p>` : ''}
</section>
${L.retest ? `<section class="card" style="margin-top:14px">
  <div class="card-head"><h2>${esc(L.retest.titulo)} · ¿usar USD ${L.retest.monto} de la reserva?</h2><span class="badge ${L.retest.nivel}">${esc(L.retest.estado)}</span></div>
  <p>${esc(L.retest.texto)}</p>
  <ul class="checks">${L.retest.checks.map((x) => `<li><span class="ic">${x.ok === true ? '✅' : x.ok === false ? '❌' : '➖'}</span><div><strong>${esc(x.nombre)}</strong>${x.core ? ' <span class="tag">requisito</span>' : ''}<br><span class="muted">${esc(x.detalle)}</span></div></li>`).join('')}</ul>
  <p class="muted" style="font-size:.8rem;margin:0">Regla: precio (requisito) + al menos 2 de 3 confirmaciones. Se decide con la vela diaria cerrada (21:00). Niveles y montos en config.json → "retest".</p>
</section>` : ''}
<div class="grid" style="margin-top:14px">
  ${bloque('¿Está barato BTC? (valuación de ciclo)', L.val)}
  <div style="display:grid;gap:14px;align-content:start">
    ${L.niveles.length ? `<section class="card">${tablaNiveles(L.niveles, L.precio, 'Niveles de largo plazo de BTC para escalonar compras')}<p class="muted" style="font-size:.8rem;margin:8px 0 0">Históricamente los pisos de ciclo se formaron alrededor de la media de 200 semanas y del precio realizado.</p></section>` : ''}
    ${bloque('Sentimiento', L.sen)}
  </div>
  ${bloque('Grandes compradores y liquidez', L.flu, L.tesorerias ? `<p class="muted" style="font-size:.82rem;margin:4px 0 0">Mayores tenedores: ${L.tesorerias.top.map((t) => `${esc(t.nombre)} ${fmt(t.btc)} BTC${t.costo ? ` (costo ${usd(t.costo)})` : ''}`).join(' · ')}</p>` : '')}
  ${bloque('Macro (Nasdaq y dólar)', L.mac)}
</div>
${L.alts?.length ? `<h3>Altcoins a largo plazo (satélite, como máximo 1/3 del capital)</h3>
<p class="muted" style="margin-top:-4px">Amplifican a BTC para los dos lados: en los bear markets cayeron 80–96%. Rinden más que BTC cuando su ratio contra BTC deja de caer; mientras tanto, solo tramos chicos.</p>
<div class="grid">${L.alts.map(cardAlt).join('')}</div>` : ''}
${L.errores.length ? `<p class="muted" style="font-size:.8rem">Fuentes sin dato: ${L.errores.map(esc).join(' · ')}</p>` : ''}`;
}
