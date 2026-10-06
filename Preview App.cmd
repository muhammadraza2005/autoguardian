@echo off
cd /d "%~dp0mobile"
set EXPO_PUBLIC_APP_MODE=demo
set EXPO_PUBLIC_DEV_EMAIL_AUTH=false
call npm.cmd run web -- --port 8081
