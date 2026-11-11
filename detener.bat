@echo off
title Detener Rafa Turnos
echo ===================================================
echo   DETENIENDO SERVICIOS DE RAFA TURNOS
echo ===================================================
echo.

echo [1/3] Deteniendo procesos en puertos 3000, 4200 y 4300...
for %%P in (3000 4200 4300) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R ":%%P .*LISTENING"') do (
    taskkill /f /t /pid %%a >nul 2>&1
  )
)
taskkill /f /fi "WINDOWTITLE eq Rafa Turnos - *" >nul 2>&1

echo [2/3] Deteniendo Base de Datos PostgreSQL (Docker)...
docker compose stop db >nul 2>&1

echo [3/3] Servicios de Rafa Turnos detenidos correctamente.
echo.
echo ===================================================
echo   EL SISTEMA SE HA APAGADO SIN AFECTAR OTROS PROCESOS
echo ===================================================
timeout /t 3 /nobreak >nul
