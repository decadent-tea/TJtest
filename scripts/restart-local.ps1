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

$scriptRoot = Split-Path -Parent $PSCommandPath
& (Join-Path $scriptRoot 'stop-local.ps1')
$startArgs = @{}
if ($Production) { $startArgs['Production'] = $true }
if ($Development) { $startArgs['Development'] = $true }
& (Join-Path $scriptRoot 'start-local.ps1') @startArgs
