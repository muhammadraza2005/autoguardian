@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "ANDROID_HOME=%PROJECT_ROOT%.tools\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "ANDROID_AVD_HOME=%PROJECT_ROOT%.tools\avd"
set "ANDROID_USER_HOME=%PROJECT_ROOT%.tools\android-user"
set "JAVA_HOME="
for /d %%J in ("%PROJECT_ROOT%.tools\java\jdk-17*") do set "JAVA_HOME=%%~fJ"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%"

echo =======================================================================
echo AutoGuardian - Emulator Launcher and APK Auto-Installer
echo =======================================================================
echo.

:: Check if AEHD is running
sc query aehd >nul 2>&1
if errorlevel 1 (
  echo [!] The Android Emulator Hypervisor Driver (AEHD) is required for hardware acceleration.
  echo [*] Installing AEHD driver now...
  
  :: Check if we have admin rights to install the driver
  net session >nul 2>&1
  if %ERRORLEVEL% neq 0 (
    echo [*] Administrator permission is needed to install the hypervisor driver.
    echo [*] Requesting Windows elevation... Please click 'Yes' on the prompt.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%PROJECT_ROOT%.tools\android-sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat\"\"' -Verb RunAs -Wait"
  ) else (
    call "%PROJECT_ROOT%.tools\android-sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat"
  )
)

:: Recheck after driver install
sc query aehd >nul 2>&1
if errorlevel 1 (
  echo.
  echo [!] AEHD driver is not active yet.
  echo [*] Attempting to launch the emulator directly...
) else (
  echo [OK] AEHD Hardware Acceleration Driver is ACTIVE!
)

echo.
echo [*] Checking if virtual phone is already running...
"%ANDROID_HOME%\platform-tools\adb.exe" -s emulator-5554 get-state >nul 2>&1
if errorlevel 1 (
  echo [*] Booting Android Virtual Phone (AutoGuardian_Pixel_5)...
  start "" "%ANDROID_HOME%\emulator\emulator.exe" -avd AutoGuardian_Pixel_5 -port 5554 -gpu auto
)

echo [*] Waiting for virtual phone to finish booting...
set /a bootAttempts=0
:waitForBoot
set "bootComplete="
for /f "delims=" %%B in ('"%ANDROID_HOME%\platform-tools\adb.exe" -s emulator-5554 shell getprop sys.boot_completed 2^>nul') do set "bootComplete=%%B"
if "%bootComplete%"=="1" goto readyToInstall
set /a bootAttempts+=1
if %bootAttempts% geq 180 (
  echo [!] Boot timed out. Please check the emulator window.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto waitForBoot

:readyToInstall
echo [OK] Virtual phone booted successfully!
echo.
echo [*] Installing Auto Guardian APK1.apk...
"%ANDROID_HOME%\platform-tools\adb.exe" -s emulator-5554 install -r "%PROJECT_ROOT%releases\Auto Guardian APK1.apk"
if errorlevel 1 (
  echo [X] Installation failed.
  pause
  exit /b 1
)

echo [OK] APK installed successfully!
echo [*] Launching AutoGuardian app on emulator...
"%ANDROID_HOME%\platform-tools\adb.exe" -s emulator-5554 shell monkey -p com.autoguardian.mobile.review -c android.intent.category.LAUNCHER 1
echo.
echo =======================================================================
echo [SUCCESS] AutoGuardian is now running on the emulator!
echo =======================================================================
echo.
pause
