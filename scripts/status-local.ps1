[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$pidPath = Join-Path $runtimeDir 'studio.pid'
$recordedPid = $null
$process = $null
if (Test-Path -LiteralPath $pidPath) {
  $recordedPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
  $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
}

$health = $null
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/health' -TimeoutSec 2 } catch { }
$listeners = @(Get-NetTCPConnection -LocalPort 4318,5173 -State Listen -ErrorAction SilentlyContinue)

[pscustomobject]@{
  PidFile = if ($recordedPid) { $pidPath } else { $null }
  ProcessId = if ($process) { $process.Id } else { $recordedPid }
  ProcessRunning = [bool]$process
  ApiHealthy = [bool]($health -and $health.status -eq 'ok')
  ActiveRuns = if ($null -ne $health) { @($health.active).Count } else { $null }
  ListeningPorts = (($listeners | Select-Object -ExpandProperty LocalPort -Unique) -join ', ')
} | Format-List
