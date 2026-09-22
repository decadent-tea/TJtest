[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$pidPath = Join-Path $runtimeDir 'studio.pid'

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host '未找到后台启动记录，项目可能已经停止。'
  exit 0
}

$rootPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$allProcesses = @(Get-CimInstance Win32_Process)
$root = $allProcesses | Where-Object ProcessId -eq $rootPid | Select-Object -First 1

if (-not $root) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host "PID $rootPid 已不存在，已清理启动记录。"
  exit 0
}

$children = New-Object System.Collections.Generic.List[int]
$pending = New-Object System.Collections.Generic.Queue[int]
$pending.Enqueue($rootPid)
while ($pending.Count -gt 0) {
  $parentPid = $pending.Dequeue()
  foreach ($child in $allProcesses | Where-Object ParentProcessId -eq $parentPid) {
    if (-not $children.Contains([int]$child.ProcessId)) {
      $children.Add([int]$child.ProcessId)
      $pending.Enqueue([int]$child.ProcessId)
    }
  }
}

$treePids = @($rootPid) + @($children)
$projectPattern = [regex]::Escape($projectRoot)
$projectProcess = $allProcesses | Where-Object {
  $_.ProcessId -in $treePids -and $_.CommandLine -match $projectPattern
} | Select-Object -First 1
if (-not $projectProcess) {
  throw "PID $rootPid 不属于当前项目，未执行停止操作。"
}

foreach ($targetPid in @($children | Sort-Object -Descending) + $rootPid) {
  Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $pidPath -Force
Write-Host '项目后台进程已停止。'
