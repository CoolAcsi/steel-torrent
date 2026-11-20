#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs Steel Tide on Windows Server as an auto-starting background task.

.DESCRIPTION
  Copies the app, installs production dependencies, writes .env, and registers a
  scheduled task that starts at boot, runs as the low-privilege LOCAL SERVICE
  account and restarts the server if it exits. No third-party service wrapper
  is needed. The app listens on 127.0.0.1 only; put IIS or Caddy in front of it
  (see docs/DEPLOYMENT.md, "Windows Server").

  Works with Windows PowerShell 5.1 (the version that ships with Windows Server).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1 -PublicUrl https://play.example.com

.EXAMPLE
  .\install.ps1 -PublicUrl https://play.example.com -InstallDir D:\Apps\SteelTide -Port 3100 -OpenFirewall
#>
[CmdletBinding()]
param(
  # The address players will use, with scheme: https://play.example.com
  [Parameter(Mandatory = $true)][string]$PublicUrl,
  [string]$InstallDir = 'C:\SteelTide',
  [int]$Port = 3000,
  [string]$TaskName = 'SteelTide',
  # Also allow inbound TCP 80 and 443 through Windows Firewall (for the reverse proxy).
  [switch]$OpenFirewall
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# --- checks -----------------------------------------------------------------

$uri = $null
if (-not [Uri]::TryCreate($PublicUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http', 'https')) {
  throw "PublicUrl must be a full address such as https://play.example.com (got '$PublicUrl')."
}
$PublicUrl = $PublicUrl.TrimEnd('/')

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'Node.js was not found on PATH. Install Node.js 22 LTS (all users), open a new console and run this again.' }
$nodeExe = $nodeCmd.Source
$version = [version]((& $nodeExe -v).TrimStart('v'))
if ($version -lt [version]'20.12.0') { throw "Node.js 20.12 or newer is required (found $version)." }
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { throw 'npm.cmd was not found on PATH (it is installed with Node.js).' }

Write-Host "Installing Steel Tide from $source to $InstallDir (Node $version)"

# --- stop a previous install --------------------------------------------------

function Stop-SteelTide {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  # Make sure no server from an earlier run still holds the port.
  $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $owners) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $procId -Force }
    elseif ($p) { throw "Port $Port is in use by $($p.ProcessName) (pid $procId). Choose another -Port." }
  }
}
Stop-SteelTide

# --- copy files ---------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($dir in 'game', 'public', 'deploy') {
  & robocopy.exe (Join-Path $source $dir) (Join-Path $InstallDir $dir) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $dir failed (robocopy exit code $LASTEXITCODE)." }
}
foreach ($file in 'server.js', 'package.json', 'package-lock.json') {
  Copy-Item -Force (Join-Path $source $file) (Join-Path $InstallDir $file)
}

Push-Location $InstallDir
try {
  & $npmCmd.Source ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit code $LASTEXITCODE)." }
} finally { Pop-Location }

# --- configuration ------------------------------------------------------------

$envFile = Join-Path $InstallDir '.env'
if (Test-Path $envFile) {
  Write-Host "Keeping existing $envFile (delete it to regenerate)."
} else {
  @(
    'NODE_ENV=production',
    'HOST=127.0.0.1',
    "PORT=$Port",
    "PUBLIC_URL=$PublicUrl",
    'ALLOWED_ORIGINS=',
    'TRUST_PROXY=1',
    'MAX_CLIENTS=1000',
    'MAX_ROOMS=200',
    'MAX_CONN_PER_IP=20',
    'RECONNECT_GRACE_MS=60000',
    'LOG_LEVEL=info'
  ) | Set-Content -Path $envFile -Encoding ASCII
  Write-Host "Wrote $envFile"
}

# The service account may read the app and write only its log folder.
$logDir = Join-Path $InstallDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
& icacls.exe $InstallDir /grant '*S-1-5-19:(OI)(CI)RX' /Q | Out-Null     # S-1-5-19 = LOCAL SERVICE
& icacls.exe $logDir /grant '*S-1-5-19:(OI)(CI)M' /Q | Out-Null

# --- scheduled task -----------------------------------------------------------

$runner = Join-Path $InstallDir 'deploy\windows\run.ps1'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -AppDir `"$InstallDir`" -NodeExe `"$nodeExe`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Steel Tide game server (Node.js). Logs: logs\steel-tide-*.log' | Out-Null
Start-ScheduledTask -TaskName $TaskName

# --- firewall -----------------------------------------------------------------
# Only the proxy's ports are opened. The app port stays closed: it is bound to 127.0.0.1.

if ($OpenFirewall) {
  if (-not (Get-NetFirewallRule -DisplayName 'Steel Tide (HTTP/HTTPS)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Steel Tide (HTTP/HTTPS)' -Direction Inbound -Protocol TCP -LocalPort 80, 443 -Action Allow | Out-Null
  }
  Write-Host 'Windows Firewall: inbound TCP 80 and 443 allowed.'
}

# --- verify -------------------------------------------------------------------

$health = $null
for ($i = 0; $i -lt 20 -and -not $health; $i++) {
  Start-Sleep -Milliseconds 500
  try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2 } catch { }
}
if (-not $health -or $health.status -ne 'ok') {
  throw "The server did not answer on http://127.0.0.1:$Port/healthz. Check $logDir."
}

Write-Host ''
Write-Host "Steel Tide is running (build $($health.build)) on http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "  Task:  $TaskName  (starts at boot, restarts on exit)"
Write-Host "  Logs:  $logDir"
Write-Host ''
Write-Host 'Next: put a reverse proxy in front for HTTPS and WebSockets:'
Write-Host "  IIS    .\deploy\windows\setup-iis.ps1 -HostName $($uri.Host) -AppPort $Port -CertThumbprint <thumbprint>"
Write-Host '  Caddy  edit the host name in deploy\Caddyfile, then run caddy with it (see docs\DEPLOYMENT.md)'
