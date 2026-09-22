[CmdletBinding()]
param(
  [switch]$Production,
  [switch]$Development
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Production -and $Development) {
  throw '不能同时指定 -Production 和 -Development。'
}
$runDevelopment = -not $Production

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$pidPath = Join-Path $runtimeDir 'studio.pid'
$logPath = Join-Path $runtimeDir 'studio.log'
$errorLogPath = Join-Path $runtimeDir 'studio.error.log'
$apiPort = 4318
$webPort = 5173

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Fail([string]$Message) {
  throw $Message
}

function Get-ListeningPort([int]$Port) {
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail '未检测到 Node.js，请先安装 Node.js 24 或更新版本。'
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) {
  Fail "当前 Node.js 版本为 v$nodeMajor，需要 Node.js 24 或更新版本。"
}

$ports = @(Get-ListeningPort $apiPort)
if ($runDevelopment) { $ports += @(Get-ListeningPort $webPort) }
if ($ports.Count -gt 0) {
  $used = $ports | Select-Object -ExpandProperty LocalPort -Unique
  Fail "项目端口已被占用：$($used -join ', ')。请先检查现有实例。"
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  Push-Location $projectRoot
  try {
    npm ci
    if ($LASTEXITCODE -ne 0) { Fail '依赖安装失败。' }
  } finally {
    Pop-Location
  }
}

Push-Location $projectRoot
try {
  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { Fail '浏览器安装失败。' }

  if (-not $runDevelopment) {
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail '构建失败，未启动后台进程。' }
  }
} finally {
  Pop-Location
}

$escapedRoot = $projectRoot.Replace("'", "''")
$commandName = if ($runDevelopment) { 'npm run dev' } else { 'npm start' }
$command = "Set-Location -LiteralPath '$escapedRoot'; $commandName"
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$process = Start-Process `
  -FilePath $pwsh `
  -ArgumentList @('-NoLogo', '-NoProfile', '-Command', $command) `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errorLogPath `
  -WindowStyle Hidden `
  -PassThru

Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok') {
      $ready = $true
      break
    }
  } catch {
    # The child process may still be starting. The final check reports its logs.
  }
}

if (-not $ready) {
  Write-Host "后台进程未通过健康检查，PID $($process.Id)。请查看：$errorLogPath" -ForegroundColor Red
  exit 1
}

if ($runDevelopment) {
  Write-Host "项目已在后台启动：http://127.0.0.1:$webPort/" -ForegroundColor Green
} else {
  Write-Host "项目已在后台启动：http://127.0.0.1:$apiPort/" -ForegroundColor Green
}
Write-Host "PID：$($process.Id)"
Write-Host "日志：$logPath"
