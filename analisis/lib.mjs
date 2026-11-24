// Helpers compartidos de los estudios (sin dependencias, Node 18+). Cada script baja sus propios datos.
import { execFileSync } from 'node:child_process';

export const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
export const f0 = (n) => Math.round(n).toLocaleString('es-AR');
export const p0 = (x) => (x * 100).toFixed(0) + '%';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Precio diario + MVRV (CoinMetrics community, gratis). asset: btc | eth | sol
export async function coinmetrics(asset, desde = '2011-01-01') {
  const r = await fetch(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${asset}&metrics=PriceUSD,CapMVRVCur&frequency=1d&page_size=10000&start_time=${desde}`);
  const j = await r.json();
  return j.data.filter((d) => d.PriceUSD).map((d) => ({ d: d.time.slice(0, 10), px: +d.PriceUSD, mvrv: d.CapMVRVCur == null ? null : +d.CapMVRVCur }));
}

// Velas Binance paginadas. interval: 1d | 1w | 4h ... qv = volumen en USD. Solo velas cerradas.
export async function binance(symbol, interval, desde = 0, max = Infinity) {
  const out = [];
  let start = desde;
  for (;;) {
    const r = await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${start}`)).json();
    out.push(...r);
    if (r.length < 1000 || out.length >= max) break;
    start = r.at(-1)[0] + 1;
  }
  return out.filter((k) => k[6] < Date.now()).map((k) => ({ t: new Date(k[0]).toISOString().slice(0, 10), ts: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], qv: +k[7] }));
}
export async function binanceUltimas(symbol, interval, limit) {
  const r = await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)).json();
  return r.map((k) => ({ t: new Date(k[0]).toISOString().slice(0, 16).replace('T', ' '), o: +k[1], h: +k[2], l: +k[3], c: +k[4], qv: +k[7], cerrada: k[6] < Date.now() }));
}

// Flujos diarios de ETF (Farside, historial completo). kind: btc | eth. Cloudflare deja pasar a curl con UA de navegador.
export function farside(kind = 'btc') {
  const url = { btc: 'https://farside.co.uk/bitcoin-etf-flow-all-data/', eth: 'https://farside.co.uk/ethereum-etf-flow-all-data/', sol: 'https://farside.co.uk/sol/' }[kind];
  const html = execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-s', '-A', UA, '-H', 'Accept: text/html', url], { maxBuffer: 5e7 }).toString();
  const rows = [];
  const re = /<tr[^>]*>\s*<td><span class="tabletext">(\d{2} \w{3} \d{4})<\/span><\/td>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const c = [...m[2].matchAll(/<span class="tabletext">(?:<span class="redFont">)?([^<]*)/g)].map((x) => x[1].trim());
    const p = (s) => (s === '-' || s === '' ? null : (s.startsWith('(') ? -1 : 1) * parseFloat(s.replace(/[(),]/g, '')));
    rows.push({ fecha: m[1], d: new Date(Date.parse(m[1] + ' UTC')).toISOString().slice(0, 10), total: p(c.at(-1)), parcial: c.slice(0, -1).some((x) => x === '-') });
  }
  return rows;
}
