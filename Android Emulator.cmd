@echo off
setlocal
set "ANDROID_HOME=%~dp0.tools\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "ANDROID_AVD_HOME=%~dp0.tools\avd"
set "ANDROID_USER_HOME=%~dp0.tools\android-user"
set "GRADLE_USER_HOME=%~dp0.tools\gradle"
set "JAVA_HOME="
for /d %%J in ("%~dp0.tools\java\jdk-17*") do set "JAVA_HOME=%%~fJ"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%"
if not exist "%ANDROID_AVD_HOME%\AutoGuardian_Pixel_5.ini" (
  echo The AutoGuardian virtual phone has not finished installing.
  pause
  exit /b 1
)
"%ANDROID_HOME%\emulator\emulator.exe" -accel-check >nul 2>&1
if errorlevel 1 (
  echo [NOTICE] Hardware acceleration driver is not detected.
  echo Please run "Install-Hypervisor-Driver.cmd" (Run as Administrator) or restart Windows.
  echo.
  pause
  exit /b 1
)
"%ANDROID_HOME%\platform-tools\adb.exe" -s emulator-5554 get-state >nul 2>&1
if errorlevel 1 start "" "%ANDROID_HOME%\emulator\emulator.exe" -avd AutoGuardian_Pixel_5 -port 5554 -gpu auto
echo Waiting for the Android virtual phone...
set /a bootAttempts=0
:waitForBoot
set "bootComplete="
for /f "delims=" %%B in ('adb.exe -s emulator-5554 shell getprop sys.boot_completed 2^>nul') do set "bootComplete=%%B"
if "%bootComplete%"=="1" goto ready
set /a bootAttempts+=1
if %bootAttempts% geq 180 (
  echo Android did not finish booting. Check the emulator window and try again.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto waitForBoot
:ready
cd /d "%~dp0mobile"
call npm.cmd run android -- --device emulator-5554 --port 8081
pause
