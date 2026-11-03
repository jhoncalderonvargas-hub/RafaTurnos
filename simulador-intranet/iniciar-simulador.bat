@echo off
title Simulador Externo Intranet Hospitalaria (Puerto 4300)
cd /d "%~dp0"
echo Iniciando Simulador Externo de Intranet Hospitalaria en http://localhost:4300 ...
node server.js
pause
