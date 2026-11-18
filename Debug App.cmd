@echo off
setlocal
title TEKDROID TV - Debug App
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Pasang dari https://nodejs.org lalu jalankan file ini lagi.
  pause
  exit /b 1
)

set PORT=8080
set URL=http://localhost:%PORT%/debug

if not exist "debug\TEKDROID-TV.apk" (
  echo Mengunduh APK agar bisa dipasang dari HP lewat Wi-Fi...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/azizsokayasa30/tvprojectstreming/releases/download/apk-v1.0.10/TEKDROID-TV.apk' -OutFile 'debug\TEKDROID-TV.apk' -UseBasicParsing"
  if errorlevel 1 (
    echo Gagal mengunduh APK. Kamu tetap bisa uji di browser PC.
  )
)

echo.
echo  TEKDROID TV — Aplikasi Debug
echo  ------------------------------
echo  1. Uji di browser PC:  %URL%
echo  2. Pasang APK ke HP: buka halaman debug, scan QR / buka link Wi-Fi
echo.
echo  Tutup jendela ini untuk menghentikan server.
echo.

start "" "%URL%"
node --watch server.js --dev
pause
