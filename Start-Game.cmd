@echo off
setlocal
cd /d "%~dp0"
title Wanggeng - Local Game

rem Reuse this game's preview if it is already running.
powershell -NoProfile -Command "try { $page = Invoke-WebRequest 'http://127.0.0.1:4173/' -UseBasicParsing -TimeoutSec 2; if ($page.Content -match 'id=.game-frame.' -and $page.Content -match '/assets/') { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:4173/"
  exit /b 0
)

where node >nul 2>&1
if errorlevel 1 goto missing_node
where npm >nul 2>&1
if errorlevel 1 goto missing_node
if exist "node_modules\vite\package.json" goto build
call npm ci
if errorlevel 1 goto failed

:build
call npm run build
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:4173/ to play.
echo Keep this window open while playing. Closing it stops the local game.
echo.
call npm run preview -- --port 4173 --strictPort --open
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo Node.js and npm are required. Install Node.js 22.12 or newer, then try again.
pause
exit /b 1

:failed
echo.
echo The game could not start. See the error above.
echo If port 4173 is in use, close the other preview window and try again.
pause
exit /b 1
