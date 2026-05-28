param(
  [string]$HostName = "178.105.225.248",
  [string]$User = "gmed",
  [string]$IdentityFile = "$HOME\.ssh\gmed-dev-hetzner",
  [string]$RemoteArchive = "/home/gmed/deploy/gmed-crm-current.tgz",
  [string]$RemoteDeployScript = "/home/gmed/gmed-crm/scripts/deploy-dev-current.sh",
  [string]$HealthUrl = "https://console-dev.gmed-health.com/health",
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
  $status = & git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed"
  }
  if ($status) {
    & git status -sb
    throw "Working tree is not clean. Commit or stash changes before publishing; this script publishes HEAD only."
  }

  $head = (& git rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $head) {
    throw "Could not resolve HEAD"
  }

  $archive = Join-Path ([System.IO.Path]::GetTempPath()) "gmed-crm-$head.tgz"
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }

  Invoke-Checked "git" @("archive", "--format=tar.gz", "-o", $archive, "HEAD")

  $sshOptions = @("-i", $IdentityFile, "-o", "StrictHostKeyChecking=accept-new")
  $remote = "$User@$HostName"

  Invoke-Checked "ssh" ($sshOptions + @($remote, "mkdir -p /home/gmed/deploy"))
  Invoke-Checked "scp" ($sshOptions + @($archive, "${remote}:$RemoteArchive"))
  Invoke-Checked "ssh" ($sshOptions + @($remote, "bash $RemoteDeployScript $RemoteArchive"))

  if (-not $SkipSmoke) {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 30
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "Smoke check failed: $HealthUrl returned HTTP $($response.StatusCode)"
    }
    Write-Host "Smoke check OK: $HealthUrl -> HTTP $($response.StatusCode)"
  }

  Write-Host "Published DEV commit $head"
}
finally {
  Pop-Location
}
