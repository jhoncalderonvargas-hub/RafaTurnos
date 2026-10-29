@echo off
title Detener Rafa Turnos
echo ===================================================
echo   DETENIENDO SERVICIOS DE RAFA TURNOS
echo ===================================================
echo.

echo [1/3] Deteniendo procesos de Node (Frontend y Backend)...
taskkill /f /im node.exe >nul 2>&1

echo [2/3] Deteniendo Base de Datos PostgreSQL (Docker)...
docker compose down >nul 2>&1

echo [3/3] Servicios detenidos correctamente.
echo.
echo ===================================================
echo   EL SISTEMA SE HA APAGADO COMPLETAMENTE
echo ===================================================
timeout /t 3 /nobreak >nul
