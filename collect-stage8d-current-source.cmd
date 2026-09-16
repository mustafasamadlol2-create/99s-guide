@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo 99's Guide - Stage 8D Current Source Collector
echo ================================================
echo This does NOT modify production, Supabase, D1, or R2.
echo It creates a ZIP containing source files only.
echo No .env files or secrets are included.
echo.

set "TMP=%CD%\stage8d-source-pack-temp"
set "OUT=%CD%\stage8d-current-source-pack.zip"

if exist "%TMP%" rmdir /s /q "%TMP%"
if exist "%OUT%" del /q "%OUT%"

mkdir "%TMP%" >nul 2>&1
mkdir "%TMP%\server" >nul 2>&1
mkdir "%TMP%\server\services" >nul 2>&1
mkdir "%TMP%\server\middleware" >nul 2>&1
mkdir "%TMP%\prisma" >nul 2>&1
mkdir "%TMP%\cloudflare-content-api" >nul 2>&1
mkdir "%TMP%\cloudflare-content-api\src" >nul 2>&1

if not exist "server.ts" (
  echo ERROR: server.ts not found. Run this from the project root.
  exit /b 1
)
if not exist "prisma\schema.prisma" (
  echo ERROR: prisma\schema.prisma not found.
  exit /b 1
)
if not exist "cloudflare-content-api\src\index.ts" (
  echo ERROR: cloudflare-content-api\src\index.ts not found.
  exit /b 1
)

copy /y "server.ts" "%TMP%\server.ts" >nul
copy /y "prisma\schema.prisma" "%TMP%\prisma\schema.prisma" >nul
copy /y "cloudflare-content-api\src\index.ts" "%TMP%\cloudflare-content-api\src\index.ts" >nul

if exist "cloudflare-content-api\wrangler.jsonc" copy /y "cloudflare-content-api\wrangler.jsonc" "%TMP%\cloudflare-content-api\wrangler.jsonc" >nul
if exist "package.json" copy /y "package.json" "%TMP%\package.json" >nul
if exist "stage8b-private-d1-manifest.json" copy /y "stage8b-private-d1-manifest.json" "%TMP%\stage8b-private-d1-manifest.json" >nul
if exist "stage8c-private-snapshot-manifest.json" copy /y "stage8c-private-snapshot-manifest.json" "%TMP%\stage8c-private-snapshot-manifest.json" >nul

for %%F in (server\*.ts) do copy /y "%%F" "%TMP%\server\" >nul 2>&1
for %%F in (server\services\*.ts) do copy /y "%%F" "%TMP%\server\services\" >nul 2>&1
for %%F in (server\middleware\*.ts) do copy /y "%%F" "%TMP%\server\middleware\" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Compress-Archive -Path '%TMP%\*' -DestinationPath '%OUT%' -CompressionLevel Optimal -Force"
if errorlevel 1 (
  echo ERROR: Failed to create ZIP.
  exit /b 1
)

rmdir /s /q "%TMP%"

echo.
echo Created:
echo %OUT%
echo.
echo INCLUDED:
echo - server.ts
echo - server\*.ts
echo - server\services\*.ts
echo - server\middleware\*.ts
echo - prisma\schema.prisma
echo - cloudflare-content-api\src\index.ts
echo - cloudflare-content-api\wrangler.jsonc if present
echo - package.json if present
echo - Stage 8B/8C manifests if present
echo.
echo EXCLUDED:
echo - .env
echo - node_modules
echo - database dumps
echo - auth tokens
echo - CONTENT_SYNC_SECRET
echo.
echo STAGE 8D SOURCE PACK READY
