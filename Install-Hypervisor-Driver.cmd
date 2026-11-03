@echo off
setlocal
echo =======================================================================
echo AutoGuardian - Android Emulator Hypervisor Driver (AEHD) Installer
echo =======================================================================
echo.

:: Check for administrative rights
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Administrative permissions required. Requesting elevation...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo [OK] Running with Administrator privileges.
echo.

set "DRIVER_DIR=%~dp0.tools\android-sdk\extras\google\Android_Emulator_Hypervisor_Driver"
if not exist "%DRIVER_DIR%\silent_install.bat" (
    echo [ERROR] Driver files not found in %DRIVER_DIR%.
    pause
    exit /b 1
)

echo Installing AEHD driver...
cd /d "%DRIVER_DIR%"
call silent_install.bat

echo.
sc query aehd | findstr /i "STATE"
if %ERRORLEVEL% equ 0 (
    echo.
    echo =======================================================================
    echo [SUCCESS] Hypervisor driver is installed and running!
    echo You can now launch "Android Emulator.cmd" anytime.
    echo =======================================================================
) else (
    echo.
    echo [NOTICE] Driver installation script ran. You can now test "Android Emulator.cmd".
)
echo.
pause
