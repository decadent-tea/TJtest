param([switch]$Development)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw '请使用 PowerShell 7（pwsh）运行此脚本。' }
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 24 或更新版本。' }
$studioNodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($studioNodeMajor -lt 24) { throw '本项目需要 Node.js 24 或更新版本。' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' } }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw '浏览器安装失败。' }
if ($Development) {
  Write-Host '管理页面：http://127.0.0.1:5173/。按 Ctrl+C 停止。'
  npm run dev
} else {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw '构建失败。' }
  Write-Host '管理页面：http://127.0.0.1:4318/。按 Ctrl+C 停止。'
  npm start
}
