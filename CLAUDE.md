# BTC Radar — contexto para Claude

Radar personal de Martín para decidir **cuándo comprar cripto a largo plazo** (BTC núcleo, ETH/SOL satélite), con
reglas medidas sobre datos históricos. Hablar en español rioplatense (voseo), concreto, sin jerga innecesaria.
No es asesoramiento financiero: decir siempre qué está medido y qué es lectura discrecional.

## Arquitectura

| Archivo | Qué hace |
|---|---|
| `radar.mjs` | Corre todo el análisis y genera `reporte.html` + CSV (`historial.csv`, `swing.csv`, `largo.csv`). Sin dependencias, Node 18+. |
| `largoplazo.mjs` | Panel principal: valuación de ciclo, demanda/macro, altcoins satélite y tarjeta de **retest** (uso táctico de la reserva). |
| `server.mjs` | Servidor web (Coolify): sirve el reporte con login básico, corre el radar a las 21:10 ART y tiene botón **Actualizar ahora** (POST `/actualizar`, máx. 1 cada 2 min). |
| `config.json` | Niveles manuales (escenarios A/B, retest), parámetros del swing, macro y eventos. **Lo que cambia con el mercado se edita acá, no en el código.** |
| `analisis/` | Estudios que respaldan las reglas. Cada script baja sus datos: `valuacion.mjs`, `volumen.mjs`, `alts.mjs`, `estructura.mjs`. |
| `backtest/` | Backtest del sistema swing (ver `backtest/LEEME.md`). |
| `tradingview/` | Versión Pine del swing para TradingView. |

Fuentes (todas gratis): Binance (velas, funding), CoinMetrics community (precio + MVRV), Farside (ETF, vía `curl` con UA
de navegador por Cloudflare), Yahoo (Nasdaq `^IXIC`, DXY), alternative.me (Fear & Greed), CoinGecko (tesorerías de
empresas; sin histórico gratis → el radar guarda una foto diaria en `tesorerias.json`), DefiLlama (stablecoins),
Coinbase (prima vs Binance).

## Metodología (en orden de importancia)

1. **Valuación decide SI comprar; demanda decide CUÁNTO y qué tan rápido.**
   - Valuación BTC (máx. 9 pts): precio/media 200 semanas (+3 si <1), MVRV (+3 si <1), caída desde ATH (+2 si < −50%), Mayer (+1 si <0,8).
   - Demanda/macro: ETF 20 días, empresas, prima Coinbase, stablecoins 30d, Nasdaq vs media 200d, DXY, funding, Fear & Greed.
   - Matriz: barato + demanda a favor → COMPRAR FUERTE; barato + mixta → ACUMULAR; barato + en contra → ACUMULAR ESCALONADO;
     justo → DCA NORMAL; caro → REDUCIR APORTES; muy caro → NO COMPRAR.
2. **Altcoins = satélite, máx. 1/3 del capital.** Misma valuación con umbrales de caída más exigentes; se suma más solo
   cuando el ratio contra BTC deja de caer (arriba de su media de 50 días). Si BTC está caro → NO SUMAR alts.
3. **Retest (táctico):** usar una parte de la reserva solo si el precio vuelve a la zona, arma piso (mínimo más alto o
   barrida recuperada en el día) y cierra arriba del nivel, **más 2 de 3**: ETF con salidas chicas o entradas, prima
   Coinbase recuperada, funding negativo. Decidir con la vela diaria cerrada (21:00 ART), nunca intradía.
4. **Swing (opcional, otra estrategia):** Donchian 30/15 + media 200, long/cash, 1/3 por activo. No mezclar con el plan de largo plazo.
5. **Operativa:** solo spot, órdenes límite en niveles de largo plazo (media 200 semanas, precio realizado, MVRV 0,8),
   no comprar a mercado en la vela que perfora un soporte, no perseguir subas hacia resistencias, sin apalancamiento.

## Hallazgos medidos (no re-litigar sin volver a medir)

- **Valuación BTC 2014–2026** (`analisis/valuacion.mjs`): precio < media 200 semanas → 1 año positivo 100% de las veces
  (mediana +121%); MVRV < 1,25 muy bueno, > 2,5 malo; caída > 50% bueno. Mayer y Fear & Greed separan poco a 1 año.
  Son ~3–4 ciclos: orienta, no garantiza.
- **Volumen** (`analisis/volumen.mjs`): **no aporta**. En BTC, caída >50% con volumen >1,5x rindió peor que sin volumen;
  en ETH/SOL agrupado por episodios independientes es 50/50. Se muestra solo informativo (0 puntos).
- **Altcoins** (`analisis/alts.mjs`): amplifican a BTC para los dos lados (ETH −94% en 2018, SOL −96% en 2022) y no
  siempre le ganan: tras los pisos de 2018 y 2022, ETH rindió menos que BTC a 1 año; SOL más en 2022.
- **ETF extremos** (`analisis/estructura.mjs`): las peores ventanas de 20 días de salidas (≈ −4.000 a −5.600M) fueron
  zona de piso en 3 de 4 episodios (mar-2025 +33% a 90d, feb-2026 +18%, jun-2026 +28%), pero en nov-2025 BTC cayó −26%
  a 90 días. Señal de contexto, no de compra por sí sola; lo que cuenta es que las salidas **se achiquen** en el retest.
- **Swing** (`backtest/`): Donchian 30/15 + media 200, cartera 1/3 → Sharpe ~1,28, caída máx. −29% (vs −85% comprar y
  mantener). Sin ventaja: reversión a la media RSI2, trailing ATR, Escenario A genérico (barrida + recuperación, por eso
  quedó informativo), filtro "alts solo si BTC confirma".

## Contexto de mercado (actualizar cuando cambie)

Al 24/11/2026: BTC ~60k, −52% desde ATH (124,8k, oct-2025), debajo de la media de 200 semanas (~68,3k), MVRV ~1,13,
Fear & Greed 11. Estructura bajista diaria/semanal (máximos y mínimos decrecientes desde 87,4k). Mínimo del ciclo
55.130 (21/11), que barrió el piso de junio-2026 (57,8–60k). Rebote rechazado en 64.600 (23/11). ETF −4,5B en 20 días,
prima Coinbase negativa. Niveles: resistencias 62–63,3k / 64,6–66,1k / **67,5–68,3k** (50% Fibo + media 20d + media
200 semanas); soportes 57,8–58,8k / **55.130** / 53.200 (precio realizado).

**Plan del usuario** (montos en su memoria local, no en este repo público): 2/3 BTC, 1/3 alts (ETH 60% / SOL 40% del
satélite). BTC: ~30% ya comprado, órdenes en 53.200 y 42.600, ~25% de reserva. Reserva: la mitad por la tarjeta de
retest; el resto con cierre semanal > media 200 semanas, COMPRAR FUERTE, o DCA semanal si pasan 8 semanas.
ETH: mitad ya, mitad en 1.370. SOL: mitad ya, mitad en 55. Si el usuario dice que usó la reserva o se llenó una orden,
actualizar `config.json` (retest) y este párrafo.

## Deploy

- Online: **https://radar.revolucionmotos.tech** (login básico: usuario `martin`, contraseña en la variable `RADAR_PASS` de Coolify; no escribirla en el repo).
- Repo público `martinalejandrohakanson29-art/radar` (rama `main`). **Nunca commitear** tokens, contraseñas ni montos.
- Coolify 4.x en `http://100.117.232.31:8000` (solo por Tailscale). App uuid `pw06nhhtnjqpa490bi2s1aus`, volumen persistente `/data`.
- Token de API en `.coolify-token` (gitignored, hay que crearlo en cada PC; necesita permiso deploy).
- No hay auto-deploy por push (el panel está cerrado a internet). Después de `git push`:
  `curl -X POST -H "Authorization: Bearer $(cat .coolify-token)" -H "Content-Type: application/json" http://100.117.232.31:8000/api/v1/deploy -d '{"uuid":"pw06nhhtnjqpa490bi2s1aus"}'`
  y luego POST a `/actualizar` para regenerar el reporte con el código nuevo (el reporte guardado no se rehace solo si tiene < 6 h).
- Local: `node radar.mjs` (o `correr-radar.cmd`), reporte en `reporte.html`.

## Cómo trabajar acá

- Para analizar el mercado usar la skill **`/analisis-mercado`** (`.claude/skills/analisis-mercado/SKILL.md`).
- Antes de proponer un indicador o regla nueva, **medirla** con un script en `analisis/` (retornos a 1–2 años o por episodios
  independientes) y recién después sumarla al radar. Si no tiene ventaja, se muestra como informativo con 0 puntos.
- Las estadísticas con pocos episodios se reportan como tales ("3 de 4"), nunca como regla.
