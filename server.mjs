// Servidor web del radar: muestra el reporte y corre el análisis todos los días.
// Variables: PORT (3000), DATA_DIR (/data), RADAR_USER / RADAR_PASS (opcional: login básico),
//            RADAR_HORA_UTC (default "00:10" = 21:10 Argentina)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || '/data';
const PORT = +(process.env.PORT || 3000);
const USER = process.env.RADAR_USER || '';
const PASS = process.env.RADAR_PASS || '';
const [HH, MM] = (process.env.RADAR_HORA_UTC || '00:10').split(':').map(Number);

// Devuelve una promesa que termina cuando el análisis termina (si ya está corriendo, la misma).
let corriendo = null, ultimaCorrida = 0;
function correrRadar(motivo) {
  if (corriendo) return corriendo;
  console.log(`[${new Date().toISOString()}] corriendo radar (${motivo})`);
  corriendo = new Promise((resolve) => {
    execFile(process.execPath, [path.join(DIR, 'radar.mjs')], { env: { ...process.env, DATA_DIR: DATA, RADAR_WEB: '1' }, timeout: 180000 },
      (err, out, errOut) => {
        corriendo = null;
        ultimaCorrida = Date.now();
        if (out) console.log(out.trim());
        if (err) console.error('radar falló:', err.message, errOut);
        resolve();
      });
  });
  return corriendo;
}

function programarDiario() {
  const ahora = new Date();
  const prox = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), HH, MM));
  if (prox <= ahora) prox.setUTCDate(prox.getUTCDate() + 1);
  setTimeout(() => { correrRadar('programado'); programarDiario(); }, prox - ahora);
  console.log(`próxima corrida: ${prox.toISOString()}`);
}

const igual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function autorizado(req) {
  if (!USER || !PASS) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  return igual(u, USER) && igual(p.join(':'), PASS);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return res.end('ok');
  if (!autorizado(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="BTC Radar", charset="UTF-8"' });
    return res.end('Necesitás usuario y contraseña');
  }
  try {
    if (url.pathname === '/' || url.pathname === '/reporte.html') {
      const html = await readFile(path.join(DATA, 'reporte.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (url.pathname === '/historial.csv' || url.pathname === '/swing.csv' || url.pathname === '/largo.csv') {
      const nombre = url.pathname.slice(1);
      const csv = await readFile(path.join(DATA, nombre));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}"` });
      return res.end(csv);
    }
    if (url.pathname === '/actualizar' && req.method === 'POST') {
      // máximo una corrida cada 2 minutos (las APIs gratuitas limitan); espera a que termine y vuelve al reporte
      if (Date.now() - ultimaCorrida > 120e3 || corriendo) await correrRadar('manual');
      res.writeHead(303, { Location: '/' });
      return res.end();
    }
    res.writeHead(404); res.end('No encontrado');
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(corriendo ? 'Generando el primer reporte, recargá en un minuto…' : 'Todavía no hay reporte.');
  }
}).listen(PORT, () => console.log(`BTC Radar en :${PORT}`));

// Al arrancar: si el reporte no existe o tiene más de 6 horas, correr ya.
stat(path.join(DATA, 'reporte.html'))
  .then((s) => { if (Date.now() - s.mtimeMs > 6 * 3600e3) correrRadar('reporte viejo'); })
  .catch(() => correrRadar('primer arranque'));
programarDiario();
