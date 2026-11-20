#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops Steel Tide and removes its scheduled task and firewall rule.
  Pass -RemoveFiles to delete the install folder as well.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\SteelTide',
  [int]$Port = 3000,
  [string]$TaskName = 'SteelTide',
  [switch]$RemoveFiles
)

$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task $TaskName."
}

$owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $owners) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $procId -Force; Write-Host "Stopped node (pid $procId)." }
}

Get-NetFirewallRule -DisplayName 'Steel Tide (HTTP/HTTPS)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($RemoveFiles -and (Test-Path $InstallDir)) {
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "Deleted $InstallDir."
}
