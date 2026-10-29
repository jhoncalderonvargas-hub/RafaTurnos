@echo off
title Iniciar Rafa Turnos
echo ===================================================
echo   INICIANDO RAFA TURNOS HOSPITALARIOS
echo ===================================================
echo.

echo [1/3] Verificando Base de Datos PostgreSQL (Docker)...
docker compose up -d
echo.

echo [2/3] Iniciando Backend NestJS (http://localhost:3000)...
start "Rafa Turnos - Backend" cmd /k "cd /d "%~dp0backend" && npm start"
echo.

echo [3/3] Iniciando Frontend Angular (http://localhost:4200)...
start "Rafa Turnos - Frontend" cmd /k "cd /d "%~dp0frontend" && npm start"
echo.

echo Esperando que inicien los servicios para abrir el navegador...
timeout /t 6 /nobreak >nul
start http://localhost:4200

echo ===================================================
echo   SISTEMA EN EJECUCION EXITOSA
echo   - Frontend: http://localhost:4200
echo   - Backend:  http://localhost:3000
echo ===================================================
