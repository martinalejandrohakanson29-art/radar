# Radar Swing en TradingView

Dos scripts Pine v6. Para cargarlos: abrir el **Editor de Pine** en TradingView, pegar el archivo, **Guardar** y **Añadir al gráfico**.

## `radar-swing.pine`: indicador con el tablero
- Tabla con BTC, ETH y SOL: estado (COMPRAR / VENDER / MANTENER / AFUERA), precio, nivel clave y distancia, y datos de la posición.
- Sobre el gráfico: gatillo de compra (verde azulado) cuando está afuera, gatillo de venta (rojo) cuando está comprado, media de 200 y fondo verde mientras está comprado.
- Usa velas diarias cerradas aunque el gráfico esté en 1h o 4h, así que no repinta. Las etiquetas COMPRA y VENTA aparecen en la vela siguiente al cierre que dio la señal.
- **Alertas:** en *Crear alerta*, elegir el indicador y la opción **"Cualquier llamada a alert()"**. Con eso una sola alerta avisa por los 3 activos. También están las opciones "COMPRA (gráfico)" y "VENTA (gráfico)" para el símbolo que tengas abierto.

## `radar-swing-backtest.pine`: estrategia
- Sirve para el Strategy Tester. Va en velas **1D**, con un activo por vez.
- Usa los mismos supuestos que `backtest/`: comisión de 0,15% por lado y ejecución en la apertura siguiente.

Los parámetros (30 / 15 / 200) tienen que coincidir con `config.json` → `swing`. Si cambiás uno, cambiá el otro.
