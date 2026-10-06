@echo off
cd /d "%~dp0backend"
call npm.cmd run build
if errorlevel 1 exit /b 1
call npm.cmd start
