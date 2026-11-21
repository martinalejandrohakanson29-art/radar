@echo off
rem Corre el radar. Con "abrir" como argumento abre el reporte siempre.
cd /d "%~dp0"
if /i "%1"=="abrir" (
  "C:\Program Files\nodejs\node.exe" radar.mjs --open >> radar.log 2>&1
) else (
  "C:\Program Files\nodejs\node.exe" radar.mjs >> radar.log 2>&1
)
