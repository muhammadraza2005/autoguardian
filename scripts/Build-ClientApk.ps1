param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2100000000)]
    [int]$Number
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $projectRoot 'mobile'
$outputRoot = Join-Path $projectRoot 'releases'
$apkName = "Auto Guardian APK$Number.apk"
$outputApk = Join-Path $outputRoot $apkName
if (Test-Path -LiteralPath $outputApk) {
    Remove-Item -LiteralPath $outputApk -Force
    Remove-Item -LiteralPath "$outputApk.sha256" -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$outputApk.build.json" -Force -ErrorAction SilentlyContinue
}

$javaRoot = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools/java') -Directory -Filter 'jdk-17*' | Select-Object -First 1
if (!$javaRoot) { throw 'Project-local JDK 17 is missing. See docs/ANDROID-SETUP.md.' }
$env:JAVA_HOME = $javaRoot.FullName
$env:ANDROID_HOME = Join-Path $projectRoot '.tools/android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = Join-Path $projectRoot '.tools/android-user'
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.tools/gradle'
$env:PATH = "$env:JAVA_HOME/bin;$env:ANDROID_HOME/platform-tools;$env:PATH"
$env:AUTOGUARDIAN_REVIEW_NUMBER = "$Number"
$env:EXPO_PUBLIC_APP_MODE = 'demo'
$env:EXPO_PUBLIC_CLIENT_REVIEW = 'true'
$env:EXPO_PUBLIC_API_BASE_URL = ''
$env:EXPO_PUBLIC_SUPABASE_URL = ''
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ''
$env:EXPO_NO_DOTENV = '1'
$env:NODE_ENV = 'production'
$env:CI = '1'

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
Push-Location $mobileRoot
try {
    # CNG generates the native configuration; no generated files are hand-edited.
    & npx.cmd --no-install expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }

    Push-Location (Join-Path $mobileRoot 'android')
    try {
        # Include ARM phones and x86_64 emulator support in a single review APK.
        # Validate and embed the review bundle before the expensive native work.
        & .\gradlew.bat :app:createBundleReleaseJsAndAssets :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64' --console=plain --max-workers=2 --no-daemon
        if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed.' }
    } finally { Pop-Location }

    $builtApk = Join-Path $mobileRoot 'android/app/build/outputs/apk/release/app-release.apk'
    $signer = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/apksigner.bat'
    & $signer verify --verbose $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    Copy-Item -LiteralPath $builtApk -Destination $outputApk
    $hash = (Get-FileHash -LiteralPath $outputApk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $apkName" | Set-Content -LiteralPath "$outputApk.sha256" -Encoding ascii
    $sourceCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
    $sourceStatus = @(& git -C $projectRoot status --short)
    [ordered]@{
        name = $apkName
        reviewNumber = $Number
        applicationId = 'com.autoguardian.mobile.review'
        versionCode = $Number
        sourceCommit = $sourceCommit
        sourceHasUncommittedChanges = $sourceStatus.Count -gt 0
        sourceStatus = $sourceStatus
        builtAt = [DateTimeOffset]::UtcNow.ToString('o')
        mode = 'synthetic-client-review'
        signing = 'local Android debug certificate; not a production release key'
        architectures = @('arm64-v8a', 'armeabi-v7a', 'x86_64')
        bytes = (Get-Item -LiteralPath $outputApk).Length
        sha256 = $hash
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$outputApk.build.json" -Encoding utf8
    Write-Host "Client APK ready: $outputApk"
} finally {
    # Restore the usual native app identity and release bundling for development.
    Remove-Item Env:AUTOGUARDIAN_REVIEW_NUMBER -ErrorAction SilentlyContinue
    & npx.cmd --no-install expo prebuild --platform android --no-install
    $restoreExitCode = $LASTEXITCODE
    Pop-Location
    if ($restoreExitCode -ne 0) {
        Write-Warning 'Native configuration restoration failed. Run Expo prebuild without AUTOGUARDIAN_REVIEW_NUMBER before building the normal app.'
    }
}
