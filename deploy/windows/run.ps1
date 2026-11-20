<#
.SYNOPSIS
  Keeps the Steel Tide server running. Started by the scheduled task that
  install.ps1 registers; not meant to be run by hand.

.DESCRIPTION
  Runs node with the settings in .env, appends its output to a dated log file
  and starts it again if it exits. Logs older than 14 days are removed.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [string]$NodeExe = 'node.exe'
)

Set-Location $AppDir
$logDir = Join-Path $AppDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

while ($true) {
  Get-ChildItem $logDir -Filter 'steel-tide-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # A new log file per start; cmd.exe does the redirection so the file stays plain UTF-8.
  $log = Join-Path $logDir ('steel-tide-{0:yyyyMMdd}.log' -f (Get-Date))
  & cmd.exe /d /c "`"$NodeExe`" --env-file=.env server.js >> `"$log`" 2>&1"
  $code = $LASTEXITCODE

  $line = '{{"t":"{0}","level":"warn","event":"wrapper_restart","exitCode":{1}}}' -f (Get-Date).ToUniversalTime().ToString('o'), $code
  Add-Content -Path $log -Value $line -Encoding UTF8
  Start-Sleep -Seconds 2
}
