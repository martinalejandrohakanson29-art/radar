# Backtest del sistema swing

Sin dependencias (Node 18+). Velas diarias de Binance; señal al cierre, ejecución a la apertura siguiente, 0,15% de costo por lado.

```
node backtest/descargar.mjs            # baja el histórico (BTC, ETH, SOL) a backtest/*.json
node backtest/run.mjs BTCUSDT ETHUSDT SOLUSDT   # 20 estrategias: 2018-22 / 2023-26 / todo
node backtest/grid.mjs                 # robustez: grilla entrada x salida del Donchian
node backtest/port.mjs                 # cartera 1/3, vol target, filtro BTC, rotación
node backtest/escenarioA.mjs           # versión sin niveles del Escenario A del radar
node backtest/estado.mjs               # costos, retorno por año y estado actual
```

Resultado (nov 2026): Donchian 30/15 + media 200 en cartera 1/3 por activo → 40% anual, caída máx. -29%, Sharpe 1,28
(2021-26), contra 18% / -85% / 0,59 de comprar y mantener. Reversión a la media y el Escenario A no tuvieron ventaja.
