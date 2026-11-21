// BTC Radar — evalúa si hay oportunidad de compra spot (BTC / ETH / SOL)
// Uso: node radar.mjs [--open]   (sin dependencias, Node 18+)
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.DATA_DIR || DIR; // en el servidor: volumen persistente
const IS_WIN = process.platform === 'win32';
const cfg = JSON.parse(await readFile(path.join(DIR, 'config.json'), 'utf8'));
const FORCE_OPEN = process.argv.includes('--open');
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const OP = 'OPORTUNIDAD', AT = 'ATENTO', ES = 'ESPERAR';

// ---------- helpers ----------
const fmt = (n, d = 0) => n == null || Number.isNaN(n) ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n) => n == null ? '—' : 'USD ' + fmt(n, n < 10 ? 4 : n < 1000 ? 2 : 0);
const pct = (n, d = 1) => n == null ? '—' : (n > 0 ? '+' : '') + fmt(n, d) + '%';
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const minOf = (a) => Math.min(...a);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function klines(symbol, limit = 200) {
  const raw = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`);
  const all = raw.map((k) => ({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5], closeT: k[6] }));
  const now = Date.now();
  return { closed: all.filter((k) => k.closeT < now), live: all.find((k) => k.closeT >= now) ?? null };
}

async function funding(symbol) {
  try {
    const [cur, hist] = await Promise.all([
      getJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
      getJSON(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=9`),
    ]);
    const rates = hist.map((h) => +h.fundingRate);
    return { actual: +cur.lastFundingRate * 100, prom3d: avg(rates) * 100 }; // en %
  } catch (e) {
    return { error: e.message };
  }
}

// Farside: tabla de flujos diarios (US$m). Devuelve [{fecha, total, parcial}]
// Cloudflare de Farside bloquea el fetch de Node; curl.exe (incluido en Windows) pasa.
function curlGet(url) {
  return new Promise((resolve, reject) => {
    execFile(IS_WIN ? 'curl.exe' : 'curl', ['-s', '-f', '-m', '25', '-A', BROWSER_UA, '-H', 'Accept: text/html', '-H', 'Accept-Language: en-US', url],
      { maxBuffer: 20 * 1024 * 1024 }, (err, out) => (err ? reject(new Error('curl: ' + (err.code ?? err.message))) : resolve(out)));
  });
}

async function farside(kind) {
  try {
    const url = `https://farside.co.uk/${kind}/`;
    let html;
    try { html = await curlGet(url); }
    catch {
      const r = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      html = await r.text();
    }
    const rows = [];
    const rowRe = /<tr[^>]*>\s*<td><span class="tabletext">(\d{2} \w{3} \d{4})<\/span><\/td>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = rowRe.exec(html))) {
      const cells = [...m[2].matchAll(/<span class="tabletext">(?:<span class="redFont">)?([^<]*)/g)].map((x) => x[1].trim());
      if (!cells.length) continue;
      const parse = (s) => {
        if (s === '-' || s === '') return null;
        const neg = s.startsWith('(');
        const v = parseFloat(s.replace(/[(),]/g, ''));
        return neg ? -v : v;
      };
      rows.push({ fecha: m[1], total: parse(cells.at(-1)), parcial: cells.slice(0, -1).some((c) => c === '-') });
    }
    if (!rows.length) throw new Error('no se encontró la tabla (¿cambió la página?)');
    return { rows };
  } catch (e) {
    return { error: e.message };
  }
}

// Yahoo Finance: cierres diarios de índices / futuros (Nasdaq, dólar, oro)
async function yahoo(symbol) {
  try {
    const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`,
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    const res = j.chart.result[0];
    const closes = res.indicators.quote[0].close;
    const serie = res.timestamp.map((t, i) => ({ t: t * 1000, close: closes[i] })).filter((x) => x.close != null);
    if (serie.length < 25) throw new Error('pocos datos');
    return { serie };
  } catch (e) {
    return { error: e.message };
  }
}

function macroResumen(y) {
  if (y.error) return { error: y.error };
  const c = y.serie.map((x) => x.close), n = c.length, last = c[n - 1];
  const sma = (d) => avg(c.slice(n - d));
  return {
    fecha: day(y.serie[n - 1].t), precio: last,
    chg1d: (last / c[n - 2] - 1) * 100,
    chg5d: (last / c[n - 6] - 1) * 100,
    vsSma20: (last / sma(20) - 1) * 100,
    sma: sma, cierres: c,
  };
}

function dolarCheck(dxy, dias) {
  if (dxy.error) return chk('Dólar (DXY) afloja', null, `Sin dato (${dxy.error})`);
  const prom = dxy.sma(dias);
  return chk('Dólar (DXY) afloja', dxy.precio < prom,
    `DXY ${fmt(dxy.precio, 2)} vs promedio ${dias} días ${fmt(prom, 2)} · semana ${pct(dxy.chg5d, 2)}`);
}

function rsi(closes, p = 14) {
  const out = Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  g /= p; l /= p;
  out[p] = 100 - 100 / (1 + g / (l || 1e-12));
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (p - 1) + Math.max(d, 0)) / p;
    l = (l * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = 100 - 100 / (1 + g / (l || 1e-12));
  }
  return out;
}

const chk = (nombre, ok, detalle, core = false) => ({ nombre, ok, detalle, core });

// ---------- ETF ----------
function etfResumen(f) {
  if (f.error) return { error: f.error };
  const completos = f.rows.filter((r) => !r.parcial && r.total != null);
  const ult3 = completos.slice(-3), prev3 = completos.slice(-6, -3);
  const s3 = ult3.reduce((s, r) => s + r.total, 0);
  const p3 = prev3.reduce((s, r) => s + r.total, 0);
  return {
    ultimos: f.rows.slice(-6),
    suma3: s3,
    suma3Prev: p3,
    seAchican: s3 > p3,
    entradas2: ult3.length >= 2 && ult3.slice(-2).every((r) => r.total > 0),
    ultimoPositivo: ult3.length && ult3.at(-1).total > 0,
  };
}

function etfCheck(etf) {
  if (etf.error) return chk('ETF: salidas se achican', null, `Sin dato (${etf.error})`);
  const ok = etf.seAchican || etf.entradas2;
  return chk('ETF: salidas se achican o entran', ok,
    `Últimos 3 días: ${fmt(etf.suma3, 1)}M vs 3 previos: ${fmt(etf.suma3Prev, 1)}M${etf.entradas2 ? ' · 2 días seguidos de entradas' : ''}`);
}

// ---------- Escenario A: barrida + recuperación ----------
function escenarioA(btc, rsiArr, fund, etf, c) {
  const k = btc.closed, n = k.length, last = k[n - 1];
  let sweep = null;
  for (let i = n - 1; i >= n - c.velasBarrida; i--) {
    const prevMin = minOf(k.slice(i - 20, i).map((x) => x.low));
    if (k[i].low < prevMin && k[i].low <= c.barridaMax) { sweep = { i, k: k[i], prevMin }; break; }
  }
  const min20 = minOf(k.slice(n - 20).map((x) => x.low));
  const live = btc.live;
  const barridaEnCurso = !sweep && live && live.low < min20 && live.low <= c.barridaMax;
  const checks = [];
  checks.push(chk('Barrida bajo la zona', !!sweep,
    sweep ? `Mínimo ${usd(sweep.k.low)} (${day(sweep.k.t)}) rompió el mínimo de 20 días (${usd(sweep.prevMin)})`
      : barridaEnCurso ? `En curso: la vela de hoy marcó ${usd(live.low)} bajo el mínimo de 20 días (${usd(min20)}). Se confirma al cierre diario (21:00 ART)`
      : `Sin barrida ≤ ${usd(c.barridaMax)} en las últimas ${c.velasBarrida} velas cerradas (mín. 20d: ${usd(min20)})`, true));
  checks.push(chk(`Recupera ${usd(c.recuperacion)} al cierre`, last.close >= c.recuperacion,
    `Último cierre diario: ${usd(last.close)}`, true));

  if (sweep) {
    const s = sweep.k, rango = s.high - s.low;
    const mecha = rango ? (Math.min(s.open, s.close) - s.low) / rango : 0;
    checks.push(chk('Mecha inferior larga', mecha >= c.mechaMinima, `Mecha = ${fmt(mecha * 100)}% del rango de la vela`));
    const vAvg = avg(k.slice(sweep.i - 20, sweep.i).map((x) => x.vol));
    const mult = s.vol / vAvg;
    checks.push(chk(`Volumen ≥ ${c.volumenMultiplo}x promedio`, mult >= c.volumenMultiplo, `Volumen de la barrida: ${fmt(mult, 2)}x el promedio de 20 días`));
  } else {
    checks.push(chk('Mecha inferior larga', null, 'Se evalúa cuando hay barrida'));
    checks.push(chk(`Volumen ≥ ${c.volumenMultiplo}x promedio`, null, 'Se evalúa cuando hay barrida'));
  }

  checks.push(fund.error ? chk('Funding negativo', null, `Sin dato (${fund.error})`)
    : chk('Funding negativo', fund.prom3d < 0, `Promedio 3 días: ${fmt(fund.prom3d, 4)}% · actual: ${fmt(fund.actual, 4)}%`));

  // Divergencia alcista RSI: mínimo reciente más bajo con RSI más alto
  const rIdx = n - 5 + k.slice(n - 5).findIndex((x) => x.low === minOf(k.slice(n - 5).map((y) => y.low)));
  const pSlice = k.slice(n - 30, n - 8);
  const pIdx = n - 30 + pSlice.findIndex((x) => x.low === minOf(pSlice.map((y) => y.low)));
  const lowerLow = k[rIdx].low < k[pIdx].low;
  const div = lowerLow && rsiArr[rIdx] > rsiArr[pIdx];
  checks.push(chk('Divergencia alcista RSI', lowerLow ? div : null,
    lowerLow ? `Mín. ${usd(k[rIdx].low)} con RSI ${fmt(rsiArr[rIdx], 1)} vs mín. previo ${usd(k[pIdx].low)} con RSI ${fmt(rsiArr[pIdx], 1)}`
             : 'No hay mínimo más bajo reciente para comparar'));

  checks.push(etfCheck(etf));
  checks.push(dolarCheck(MACRO.dolar, cfg.macro.dolarPromedioDias));

  const coreOk = checks.filter((x) => x.core).every((x) => x.ok);
  const extras = checks.filter((x) => !x.core && x.ok === true).length;
  let estado = ES;
  if (coreOk && extras >= c.extrasMinimos) estado = OP;
  else if (sweep || coreOk || barridaEnCurso || Math.min(last.close, live?.close ?? Infinity) <= c.barridaMax * 1.03) estado = AT;

  const entrada = last.close;
  const stop = sweep ? sweep.k.low * 0.995 : null;
  const plan = { entrada, objetivo: entrada * (1 + c.objetivoPct / 100), stop };
  return {
    titulo: 'Escenario A — Rebote por capitulación', estado, checks, plan,
    resumen: `${extras} de ${checks.filter((x) => !x.core).length} confirmaciones extra (mínimo ${c.extrasMinimos})`,
  };
}

// ---------- Escenario B: ruptura + retesteo ----------
function escenarioB(btc, etf, c) {
  const k = btc.closed, n = k.length, last = k[n - 1], L = c.ruptura;
  let bi = -1;
  for (let i = n - c.diasRuptura; i < n; i++) if (k[i].close > L && k[i - 1].close <= L) bi = i;
  const checks = [];
  checks.push(chk(`Cierre diario > ${usd(L)}`, bi >= 0,
    bi >= 0 ? `Cerró en ${usd(k[bi].close)} el ${day(k[bi].t)}` : `Sin ruptura en ${c.diasRuptura} días (último cierre ${usd(last.close)}, ${pct((last.close / L - 1) * 100)} vs nivel)`, true));
  let retest = false;
  if (bi >= 0) {
    for (let j = bi + 1; j < n; j++) if (k[j].low <= L * (1 + c.toleranciaRetestPct / 100) && k[j].close > L) retest = true;
    retest = retest && last.close > L;
  }
  checks.push(chk('Retesteo sostenido', bi >= 0 ? retest : null,
    bi >= 0 ? (retest ? 'Tocó la zona y cerró arriba' : 'Todavía no retesteó (o lo perdió)') : 'Se evalúa después de la ruptura', true));
  if (bi >= 0) {
    const mult = k[bi].vol / avg(k.slice(bi - 20, bi).map((x) => x.vol));
    checks.push(chk(`Volumen de ruptura ≥ ${c.volumenMultiplo}x`, mult >= c.volumenMultiplo, `${fmt(mult, 2)}x el promedio`));
  } else checks.push(chk(`Volumen de ruptura ≥ ${c.volumenMultiplo}x`, null, 'Se evalúa con la ruptura'));
  checks.push(etf.error ? chk('ETF: entradas netas 3 días', null, `Sin dato (${etf.error})`)
    : chk('ETF: entradas netas 3 días', etf.suma3 > 0, `Últimos 3 días: ${fmt(etf.suma3, 1)}M`));
  checks.push(dolarCheck(MACRO.dolar, cfg.macro.dolarPromedioDias));

  let estado = ES;
  if (bi >= 0 && retest) estado = OP;
  else if (bi >= 0 || last.close >= L * 0.97) estado = AT;
  const entrada = Math.max(L, last.close);
  return {
    titulo: 'Escenario B — Confirmación de ruptura', estado, checks,
    plan: { entrada, objetivo: entrada * (1 + c.objetivoPct / 100), stop: c.invalidacion },
    resumen: `Nivel clave ${usd(L)} · invalidación ${usd(c.invalidacion)}`,
  };
}

// ---------- Filtros ----------
function filtros(btc, etf) {
  const k = btc.closed, n = k.length;
  const c3 = k.slice(n - 3).map((x) => x.close);
  const cuchillo = c3[0] > c3[1] && c3[1] > c3[2] && c3[2] === minOf(k.slice(n - 20).map((x) => x.close));
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const prox = cfg.eventos
    .map((e) => ({ ...e, dias: Math.round((new Date(e.fecha + 'T00:00:00') - hoy) / 864e5) }))
    .filter((e) => e.dias >= 0).sort((a, b) => a.dias - b.dias)[0];
  const evento = prox && prox.dias <= cfg.filtros.diasBloqueoEvento;
  const acelera = !etf.error && etf.suma3 < etf.suma3Prev && etf.suma3 < -cfg.filtros.alertaAceleracionEtfMillones;
  const nq = MACRO.nasdaq, mc = cfg.macro;
  let nqTxt, nqMal = false;
  if (nq.error) nqTxt = `Nasdaq: sin dato (${nq.error})`;
  else {
    const caidaFuerte = nq.chg1d <= -mc.nasdaqCaidaDiaPct;
    const enMinimo = nq.precio <= minOf(nq.cierres.slice(-mc.nasdaqDiasMinimo));
    nqMal = caidaFuerte || enMinimo;
    nqTxt = `Nasdaq en caída fuerte (día ${pct(nq.chg1d, 2)}${enMinimo ? `, mínimo de ${mc.nasdaqDiasMinimo} días` : ''} · cierre ${nq.fecha})`;
  }
  return {
    bloquea: cuchillo || evento || nqMal,
    lista: [
      { nombre: nqTxt, activo: nqMal, bloquea: true },
      { nombre: 'Cuchillo cayendo (3 cierres bajando y mínimo de 20 días)', activo: cuchillo, bloquea: true },
      { nombre: prox ? `Evento macro: ${prox.nombre} (${prox.fecha}, en ${prox.dias} días)` : 'Sin eventos macro cargados', activo: !!evento, bloquea: true },
      { nombre: `Salidas ETF acelerando (${etf.error ? 'sin dato' : fmt(etf.suma3, 1) + 'M en 3 días'})`, activo: !!acelera, bloquea: false },
    ],
  };
}

// ---------- Altcoins ----------
function altcoin(nombre, c, usdK, ratioK, btc, fund, btcOk) {
  const r = ratioK.closed, n = r.length, rl = r[n - 1];
  const a = usdK.closed, an = a.length;
  const b = btc.closed, bn = b.length;
  const chgAlt = (a[an - 1].close / a[an - 2].close - 1) * 100;
  const chgBtc = (b[bn - 1].close / b[bn - 2].close - 1) * 100;
  const rsiAlt = rsi(a.map((x) => x.close)).at(-1);
  const low5 = minOf(r.slice(n - 5).map((x) => x.low));
  const low10prev = minOf(r.slice(n - 15, n - 5).map((x) => x.low));
  const map = {};
  if (c.ratioPiso != null) map.piso = chk(`${c.ratio} sostiene ${c.ratioPiso}`, rl.close >= c.ratioPiso, `Cierre ratio: ${fmt(rl.close, 5)}`);
  if (c.ratioRecupera != null) map.recupera = chk(`${c.ratio} recupera ${c.ratioRecupera}`, rl.close >= c.ratioRecupera, `Distancia: ${pct((c.ratioRecupera / rl.close - 1) * 100)}`);
  map.estructura = chk(`${c.ratio} deja de hacer mínimos`, low5 > low10prev, `Mín. 5 días ${fmt(low5, 6)} vs mín. 10 días previos ${fmt(low10prev, 6)}`);
  map.fuerza = chk('Supera a BTC el último día', chgAlt > chgBtc, `${nombre} ${pct(chgAlt, 2)} vs BTC ${pct(chgBtc, 2)}`);
  const checks = Object.entries(map).map(([key, v]) => ({ ...v, core: c.requeridos.includes(key) }));
  checks.push(chk('RSI diario', null, `${fmt(rsiAlt, 1)}${rsiAlt < 30 ? ' (sobreventa)' : ''}`));
  checks.push(fund.error ? chk('Funding', null, 'Sin dato') : chk('Funding', null, `Promedio 3 días: ${fmt(fund.prom3d, 4)}%`));

  const req = checks.filter((x) => x.core);
  const reqOk = req.filter((x) => x.ok).length;
  let estado = ES;
  if (reqOk === req.length) estado = btcOk ? OP : AT;
  else if (btcOk && reqOk > 0) estado = AT;
  const entrada = a[an - 1].close;
  return {
    titulo: `${nombre}`, estado, checks,
    plan: { entrada, objetivo: entrada * (1 + c.objetivoPct / 100), stop: entrada * (1 - c.stopPct / 100) },
    resumen: `${reqOk}/${req.length} requisitos${btcOk ? '' : ' · falta confirmación de BTC'}`,
  };
}

// ---------- HTML ----------
function render(d) {
  const icon = (ok) => ok === true ? '✅' : ok === false ? '❌' : '➖';
  const badge = (e) => `<span class="badge ${e === OP ? 'op' : e === AT ? 'at' : 'es'}">${e}</span>`;
  const rr = (p) => p.stop ? fmt((p.objetivo - p.entrada) / (p.entrada - p.stop), 2) : '—';
  const card = (s) => `
  <section class="card">
    <div class="card-head"><h2>${esc(s.titulo)}</h2>${badge(s.estado)}</div>
    <p class="muted">${esc(s.resumen)}${s.motivoBloqueo ? ` · <strong>${esc(s.motivoBloqueo)}</strong>` : ''}</p>
    <ul class="checks">${s.checks.map((x) => `<li><span class="ic">${icon(x.ok)}</span><div><strong>${esc(x.nombre)}</strong>${x.core ? ' <span class="tag">requisito</span>' : ''}<br><span class="muted">${esc(x.detalle)}</span></div></li>`).join('')}</ul>
    <div class="plan">
      <div><span class="muted">Entrada ref.</span><b>${usd(s.plan.entrada)}</b></div>
      <div><span class="muted">Objetivo</span><b>${usd(s.plan.objetivo)}</b></div>
      <div><span class="muted">Stop</span><b>${usd(s.plan.stop)}</b></div>
      <div><span class="muted">R:R</span><b>${rr(s.plan)}</b></div>
    </div>
  </section>`;
  const etfTable = (t, e) => e.error ? `<p class="muted">${t}: sin dato (${esc(e.error)})</p>` : `
    <table><caption>${t} (US$ millones)</caption>
    ${e.ultimos.map((r) => `<tr><td>${r.fecha}${r.parcial ? ' <span class="muted">(parcial)</span>' : ''}</td><td class="num ${r.total < 0 ? 'neg' : 'pos'}">${fmt(r.total, 1)}</td></tr>`).join('')}
    </table>`;
  const nivel = (nombre, v) => `<tr><td>${nombre}</td><td class="num">${usd(v)}</td><td class="num">${pct((v / d.precio - 1) * 100)}</td></tr>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BTC Radar</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#15181d;--muted:#5f6670;--line:#e3e6ea;--op:#11803f;--op-bg:#e2f5ea;--at:#9a6200;--at-bg:#fdf1d8;--es:#6b7280;--es-bg:#eceef1;--neg:#c0392b;--pos:#11803f}
@media (prefers-color-scheme:dark){:root{--bg:#0f1114;--card:#181b20;--fg:#e8eaed;--muted:#9aa1ab;--line:#2a2f36;--op:#4ade80;--op-bg:#123222;--at:#fbbf24;--at-bg:#3a2d0c;--es:#9ca3af;--es-bg:#24282e;--neg:#f87171;--pos:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 40px}
h1{margin:0 0 4px;font-size:1.5rem}h2{margin:0;font-size:1.05rem}.muted{color:var(--muted)}
.top{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;margin-bottom:16px}
.price{font-size:1.8rem;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.card-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px}
.badge{font-weight:700;font-size:.78rem;padding:4px 10px;border-radius:999px;letter-spacing:.03em;white-space:nowrap}
.badge.op{color:var(--op);background:var(--op-bg)}.badge.at{color:var(--at);background:var(--at-bg)}.badge.es{color:var(--es);background:var(--es-bg)}
.checks{list-style:none;padding:0;margin:10px 0}.checks li{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line)}
.ic{width:1.4em;flex:none}.tag{font-size:.7rem;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--muted)}
.plan{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;border-top:1px solid var(--line);padding-top:10px}
.plan div{display:flex;flex-direction:column;font-size:.85rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}caption{text-align:left;font-weight:600;padding-bottom:6px}
td{padding:4px 0;border-top:1px solid var(--line)}.num{text-align:right;font-variant-numeric:tabular-nums}.neg{color:var(--neg)}.pos{color:var(--pos)}
.filters li{margin:4px 0}h3{margin:22px 0 10px;font-size:1rem}
footer{margin-top:24px;font-size:.8rem}
@media (max-width:480px){.plan{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main>
<div class="top">
  <div><h1>BTC Radar</h1><div class="muted">Generado ${esc(d.generado)} · señales con la vela diaria cerrada del ${d.velaFecha}</div></div>
  <div><div class="price">${usd(d.precio)}</div><div class="muted">BTC ahora (vela en curso ${pct(d.cambioVivo, 2)})</div></div>
</div>
<div class="grid">${card(d.A)}${card(d.B)}</div>
<h3>Altcoins (solo cuentan si BTC confirma)</h3>
<div class="grid">${card(d.ETH)}${card(d.SOL)}</div>
<h3>Filtros</h3>
<section class="card"><ul class="filters">${d.filtros.lista.map((f) => `<li>${f.activo ? (f.bloquea ? '⛔' : '⚠️') : '✔️'} ${esc(f.nombre)}${f.activo && f.bloquea ? ' — <strong>bloquea la compra</strong>' : ''}</li>`).join('')}</ul></section>
<h3>Contexto</h3>
<div class="grid">
  <section class="card"><table><caption>Niveles vs precio actual</caption>
    ${nivel('Zona barrida (A)', cfg.escenarioA.barridaMax)}${nivel('Recuperación (A)', cfg.escenarioA.recuperacion)}
    ${nivel('Invalidación (B)', cfg.escenarioB.invalidacion)}${nivel('Ruptura (B)', cfg.escenarioB.ruptura)}
    <tr><td>RSI diario BTC</td><td class="num" colspan="2">${fmt(d.rsiBtc, 1)}</td></tr>
    <tr><td>Funding BTC (prom. 3d)</td><td class="num" colspan="2">${d.fundBtc.error ? '—' : fmt(d.fundBtc.prom3d, 4) + '%'}</td></tr>
  </table></section>
  <section class="card"><table><caption>Mercados relacionados</caption>
    <tr><td class="muted">Activo</td><td class="num muted">Día</td><td class="num muted">Semana</td><td class="num muted">vs prom. 20d</td></tr>
    ${[['Nasdaq', d.macro.nasdaq, 'se mueve junto a BTC'], ['Dólar (DXY)', d.macro.dolar, 'se mueve al revés'], ['Oro', d.macro.oro, 'solo contexto']].map(([n, m, nota]) => m.error
      ? `<tr><td>${n}</td><td class="num" colspan="3">sin dato</td></tr>`
      : `<tr><td>${n}<br><span class="muted" style="font-size:.78rem">${nota}</span></td><td class="num ${m.chg1d < 0 ? 'neg' : 'pos'}">${pct(m.chg1d, 2)}</td><td class="num ${m.chg5d < 0 ? 'neg' : 'pos'}">${pct(m.chg5d, 2)}</td><td class="num">${pct(m.vsSma20, 2)}</td></tr>`).join('')}
  </table></section>
  <section class="card">${etfTable('ETF Bitcoin', d.etfBtc)}</section>
  <section class="card">${etfTable('ETF Ethereum', d.etfEth)}</section>
</div>
${d.errores.length ? `<h3>Errores</h3><section class="card">${d.errores.map(esc).join('<br>')}</section>` : ''}
<footer class="muted">Reglas fijas sobre datos de Binance y Farside. No es asesoramiento financiero. Niveles editables en config.json.</footer>
</main></body></html>`;
}

// ---------- main ----------
const errores = [];
const alts = Object.entries(cfg.altcoins);
const [btc, fundBtc, etfBtcRaw, etfEthRaw, nqRaw, dxyRaw, oroRaw, ...altData] = await Promise.all([
  klines('BTCUSDT'),
  funding('BTCUSDT'),
  farside('btc'),
  farside('eth'),
  yahoo(cfg.macro.nasdaq),
  yahoo(cfg.macro.dolar),
  yahoo(cfg.macro.oro),
  ...alts.flatMap(([, c]) => [klines(c.par), klines(c.ratio), funding(c.perpetuo)]),
]);
const etfBtc = etfResumen(etfBtcRaw), etfEth = etfResumen(etfEthRaw);
if (etfBtc.error) errores.push('Farside BTC: ' + etfBtc.error);
if (etfEth.error) errores.push('Farside ETH: ' + etfEth.error);
if (fundBtc.error) errores.push('Funding BTC: ' + fundBtc.error);
const MACRO = { nasdaq: macroResumen(nqRaw), dolar: macroResumen(dxyRaw), oro: macroResumen(oroRaw) };
for (const [k, v] of Object.entries(MACRO)) if (v.error) errores.push(`Yahoo ${k}: ${v.error}`);

const rsiArr = rsi(btc.closed.map((x) => x.close));
const A = escenarioA(btc, rsiArr, fundBtc, etfBtc, cfg.escenarioA);
const B = escenarioB(btc, etfBtc, cfg.escenarioB);
const F = filtros(btc, etfBtc);
for (const s of [A, B]) {
  if (s.estado === OP && F.bloquea) { s.estado = AT; s.motivoBloqueo = 'Bloqueada por filtro'; }
}
const btcOk = A.estado === OP || B.estado === OP;
const altRes = {};
alts.forEach(([nombre, c], i) => {
  const [u, r, f] = altData.slice(i * 3, i * 3 + 3);
  altRes[nombre] = altcoin(nombre, c, u, r, btc, f, btcOk);
});

const lastClosed = btc.closed.at(-1);
const precio = btc.live?.close ?? lastClosed.close;
const d = {
  generado: new Date().toLocaleString('es-AR'),
  velaFecha: day(lastClosed.t),
  precio, cambioVivo: btc.live ? (btc.live.close / btc.live.open - 1) * 100 : null,
  rsiBtc: rsiArr.at(-1), fundBtc, etfBtc, etfEth, filtros: F, errores, macro: MACRO,
  A, B, ETH: altRes.ETH, SOL: altRes.SOL,
};

await mkdir(OUT, { recursive: true });
const outFile = path.join(OUT, 'reporte.html');
await writeFile(outFile, render(d), 'utf8');

// historial
const hist = path.join(OUT, 'historial.csv');
if (!existsSync(hist)) await writeFile(hist, 'generado,vela,precio,rsi,funding3d,etf3d,escA,escB,eth,sol\n', 'utf8');
await appendFile(hist, [new Date().toISOString(), d.velaFecha, precio.toFixed(0), d.rsiBtc.toFixed(1),
  fundBtc.prom3d?.toFixed(4) ?? '', etfBtc.suma3?.toFixed(1) ?? '', A.estado, B.estado, altRes.ETH?.estado, altRes.SOL?.estado].join(',') + '\n', 'utf8');

// consola
console.log(`\nBTC Radar — ${d.generado}   BTC ${usd(precio)}   (vela cerrada ${d.velaFecha})`);
for (const s of [A, B, ...Object.values(altRes)]) console.log(`  ${s.estado.padEnd(12)} ${s.titulo}  — ${s.resumen}`);
F.lista.filter((f) => f.activo).forEach((f) => console.log(`  ${f.bloquea ? 'BLOQUEO' : 'AVISO  '}      ${f.nombre}`));
errores.forEach((e) => console.log('  ERROR        ' + e));
console.log(`\nReporte: ${outFile}\n`);

const haySenal = [A, B, ...Object.values(altRes)].some((s) => s.estado === OP);
if (IS_WIN && (FORCE_OPEN || (haySenal && cfg.abrirNavegadorSiHaySenal))) exec(`start "" "${outFile}"`);
