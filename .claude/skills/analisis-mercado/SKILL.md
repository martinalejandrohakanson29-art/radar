---
name: analisis-mercado
description: Analiza el momento de BTC (y ETH/SOL) como lo hace el radar de Martín - estructura de precio, niveles, flujos de ETF y grandes compradores, valuación de ciclo y qué hacer con el plan de compra a largo plazo. Usar cuando pregunte "cómo ves BTC", "qué estructura tiene", "qué habría que esperar", "es momento de comprar", "qué hago con la reserva", "cómo operaría el retest", o pida actualizar el contexto de mercado.
---

# Análisis de mercado (forma del radar)

Objetivo: responder **qué está pasando, qué esperar y qué hacer con el plan**, separando lo medido de lo discrecional.
Leer primero `CLAUDE.md` (metodología, hallazgos medidos, contexto y plan del usuario).

## 1. Datos (siempre frescos, nunca de memoria)

```
node analisis/estructura.mjs        # velas 1w/1d/4h, pivotes, medias, Fibonacci, rangos mensuales, ETF, prima Coinbase
node radar.mjs                      # recomendación de largo plazo, tarjeta de retest, alts, swing (consola + reporte.html)
```
Opcional si la pregunta lo pide: `node analisis/valuacion.mjs`, `node analisis/alts.mjs`, `node analisis/volumen.mjs`.
Si el radar online es la referencia: POST `/actualizar` en https://radar.revolucionmotos.tech (ver CLAUDE.md → Deploy).

## 2. Estructura (discrecional, decirlo)

- Tendencia: secuencia de máximos y mínimos (pivotes diarios) y posición vs medias 20/50/100/200 días.
- Última pierna: Fibonacci 23,6 / 38,2 / 50 / 61,8%. Un rebote que no pasa el 38,2% es retroceso, no giro.
- Velas: rechazos (mechas largas arriba en resistencia), cierres clavados en un nivel, barridas de mínimos recuperadas.
- Zonas: soportes rotos = resistencias; mínimos de meses previos (rangos mensuales, mechas semanales); confluencias
  con niveles de largo plazo (media 200 semanas, precio realizado = precio/MVRV).
- Armar tabla de niveles (resistencias y soportes con el motivo de cada uno).

## 3. Flujos y grandes compradores

- ETF: días recientes, sumas 5/10/20/60 días; comparar con las peores ventanas históricas y qué pasó después
  (hoy medido: zona de piso en 3 de 4 episodios, no regla). Lo importante es si **se achican** cuando el precio vuelve a bajar.
- Prima Coinbase (negativa = EE.UU. vende), funding (negativo = combustible para rebote), empresas (tesorerías), stablecoins.
- Divergencia clave: precio igual o más abajo con menos venta que la primera vez = posible piso; misma venta = continuación.

## 4. Escenarios y operativa

Dar siempre:
- **Alcista**: pasos concretos de giro (mínimo más alto → cierre sobre el último máximo rechazado → cierre semanal sobre
  la media de 200 semanas).
- **Bajista**: qué cierre lo activa y cuáles son los próximos imanes (niveles de las órdenes del plan).
- **Rango / terreno de nadie**: qué no hacer.
- Qué hacer con el plan del usuario (CLAUDE.md → Plan): tramos, órdenes límite, reserva, tarjeta de retest. Reglas de
  operativa: solo spot, decidir con el cierre diario (21:00 ART), no comprar a mercado en la vela que perfora, no
  perseguir subas hacia resistencias, sin apalancamiento.
- Dar una lectura propia ("lo más probable me parece…") marcada como opinión, y los errores a evitar.

## 5. Formato de la respuesta

Español rioplatense, directo. Tablas para niveles y escenarios. Números concretos con fecha. Distinguir:
**medido** (con muestra: "3 de 4 episodios", "desde 2014") vs **lectura** (estructura, opinión). Cerrar con qué mirar en
el radar (qué tarjeta/indicador cambia y a qué valor) y, si aplica, ofrecer un cambio en `config.json` o en el radar.

## 6. Mantener el contexto al día

Si cambian niveles clave (nuevo mínimo del ciclo, se usó la reserva, se llenó una orden, cambió la estructura):
actualizar `config.json` (retest/escenarios) y la sección "Contexto de mercado" / "Plan" de `CLAUDE.md`, commitear y
desplegar (CLAUDE.md → Deploy). Nunca commitear montos, contraseñas ni tokens (repo público).
