@echo off
setlocal enabledelayedexpansion
title Iniciar Rafa Turnos
echo ===================================================
echo   INICIANDO RAFA TURNOS HOSPITALARIOS
echo ===================================================
echo.

echo [1/4] Verificando Base de Datos PostgreSQL (Docker)...
docker compose up -d db
if errorlevel 1 (
  echo [ERROR] No se pudo iniciar PostgreSQL con Docker Compose. Verifica Docker Desktop.
  pause
  exit /b 1
)

set /a INTENTOS=0
:ESPERAR_DB
docker exec postgres-dev pg_isready -U admin -d turnos >nul 2>&1
if not errorlevel 1 goto DB_LISTA
set /a INTENTOS+=1
if %INTENTOS% GEQ 15 (
  echo [ADVERTENCIA] PostgreSQL tardo en responder; continuando...
  goto DB_LISTA
)
timeout /t 2 /nobreak >nul
goto ESPERAR_DB

:DB_LISTA
echo     Aplicando migraciones pendientes de Prisma...
pushd "%~dp0backend"
call npx prisma migrate deploy
popd
echo.

echo [2/4] Iniciando Simulador Intranet SSO (http://localhost:4300)...
start "Rafa Turnos - Simulador Intranet" cmd /k "cd /d "%~dp0simulador-intranet" && node server.js"
echo.

echo [3/4] Iniciando Backend NestJS (http://localhost:3000)...
start "Rafa Turnos - Backend" cmd /k "cd /d "%~dp0backend" && npm run start:dev"
echo.

echo [4/4] Iniciando Frontend Angular (http://localhost:4200)...
start "Rafa Turnos - Frontend" cmd /k "cd /d "%~dp0frontend" && npm start"
echo.

echo Esperando a que compilen los servicios para abrir el Portal Intranet SSO...
timeout /t 8 /nobreak >nul
start http://localhost:4300

echo ===================================================
echo   SISTEMA EN EJECUCION
echo   - Intranet SSO: http://localhost:4300
echo   - Frontend:     http://localhost:4200
echo   - Backend API:  http://localhost:3000/api/v1/health
echo ===================================================
