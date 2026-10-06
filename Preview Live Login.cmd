@echo off
cd /d "%~dp0mobile"
set EXPO_PUBLIC_APP_MODE=live
set EXPO_PUBLIC_DEV_EMAIL_AUTH=true
call npm.cmd run web -- --port 8081
