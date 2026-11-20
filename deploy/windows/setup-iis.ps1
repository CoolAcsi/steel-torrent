#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Configures IIS as the HTTPS / WebSocket reverse proxy in front of Steel Tide.

.DESCRIPTION
  Enables the IIS features the proxy needs, turns on Application Request
  Routing's proxy, allows the forwarded-header server variables, and creates a
  site whose only content is web.config. Run install.ps1 first.

  URL Rewrite 2.1 and Application Request Routing 3.0 are separate Microsoft
  downloads; this script checks for them and stops with a clear message if they
  are missing rather than downloading anything itself.

.EXAMPLE
  .\setup-iis.ps1 -HostName play.example.com -CertThumbprint 0123456789ABCDEF0123456789ABCDEF01234567
#>
[CmdletBinding()]
param(
  # Public host name, without scheme: play.example.com
  [Parameter(Mandatory = $true)][string]$HostName,
  # Thumbprint of a certificate for that host in LocalMachine\My. Omit to add HTTPS later.
  [string]$CertThumbprint,
  [int]$AppPort = 3000,
  [string]$SiteName = 'SteelTide',
  [string]$SiteDir = 'C:\inetpub\steel-tide'
)

$ErrorActionPreference = 'Stop'

# --- IIS features -------------------------------------------------------------

if (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) {
  Install-WindowsFeature -Name Web-Server, Web-WebSockets, Web-Mgmt-Console | Out-Null
} else {
  throw 'Install-WindowsFeature is not available. This script is for Windows Server.'
}
Import-Module WebAdministration

$modules = (Get-WebGlobalModule).Name
$missing = @()
if ($modules -notcontains 'RewriteModule') { $missing += 'URL Rewrite 2.1' }
if ($modules -notcontains 'ApplicationRequestRouting') { $missing += 'Application Request Routing 3.0' }
if ($missing.Count) {
  throw "Missing IIS extension(s): $($missing -join ', '). Install them from Microsoft's IIS downloads page, then run this script again."
}

# --- server-wide proxy settings ----------------------------------------------

$apphost = 'MACHINE/WEBROOT/APPHOST'
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
# Keep the public Host header, and send the client address without its port.
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name 'preserveHostHeader' -Value $true
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name 'includePortInXForwardedFor' -Value $false
Set-WebConfigurationProperty -PSPath $apphost -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value $false

# web.config sets these two headers; IIS only lets a site do that for allow-listed names.
$filter = 'system.webServer/rewrite/allowedServerVariables'
$allowed = (Get-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.').Collection | ForEach-Object { $_.name }
foreach ($name in 'HTTP_X_FORWARDED_HOST', 'HTTP_X_FORWARDED_PROTO') {
  if ($allowed -notcontains $name) {
    Add-WebConfigurationProperty -PSPath $apphost -Filter $filter -Name '.' -Value @{ name = $name }
  }
}

# --- site ---------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $SiteDir | Out-Null
$config = Get-Content -Raw (Join-Path $PSScriptRoot 'web.config')
$config = $config.Replace('http://127.0.0.1:3000/', "http://127.0.0.1:$AppPort/")
Set-Content -Path (Join-Path $SiteDir 'web.config') -Value $config -Encoding UTF8

if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
  New-Website -Name $SiteName -PhysicalPath $SiteDir -Port 80 -HostHeader $HostName | Out-Null
}

if ($CertThumbprint) {
  $CertThumbprint = ($CertThumbprint -replace '\s', '').ToUpperInvariant()
  if (-not (Test-Path "Cert:\LocalMachine\My\$CertThumbprint")) {
    throw "No certificate with thumbprint $CertThumbprint in LocalMachine\My."
  }
  if (-not (Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue)) {
    New-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $HostName -SslFlags 1   # 1 = SNI
  }
  $binding = Get-WebBinding -Name $SiteName -Protocol https
  $binding.AddSslCertificate($CertThumbprint, 'My')
}

Start-Website -Name $SiteName

Write-Host ''
Write-Host "IIS site '$SiteName' forwards $HostName to http://127.0.0.1:$AppPort" -ForegroundColor Green
if (-not $CertThumbprint) {
  Write-Host 'No certificate was bound. Until one is, the HTTPS redirect has nowhere to go:'
  Write-Host '  obtain a certificate for the host (for example with a Let''s Encrypt client for IIS),'
  Write-Host '  then run this script again with -CertThumbprint.'
}
Write-Host "Check from this server:  Invoke-WebRequest https://$HostName/ -UseBasicParsing | Select-Object StatusCode"
