param(
  [string]$HostName = "console-dev.gmed-health.com",
  [string]$User = "gmed",
  [string]$IdentityFile = "$HOME\.ssh\gmed-dev-hetzner",
  [string]$RemoteArchive = "/home/gmed/deploy/gmed-crm-current.tgz",
  [string]$RemoteDeployScript = "/home/gmed/deploy/deploy-dev-current.sh",
  [string]$HealthUrl = "https://console-dev.gmed-health.com/health",
  [switch]$CommittedOnly,
  [switch]$SkipSmoke,
  [switch]$DryRun
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

function Invoke-GitText {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $result = & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
  return ($result | Out-String).Trim()
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$archive = $null
$temporaryIndex = $null
$temporaryObjects = $null
$previousIndex = $env:GIT_INDEX_FILE
$previousObjectDirectory = $env:GIT_OBJECT_DIRECTORY
$previousAlternateObjects = $env:GIT_ALTERNATE_OBJECT_DIRECTORIES

Push-Location $repoRoot

try {
  $head = Invoke-GitText @("rev-parse", "--short=12", "HEAD")
  $status = Invoke-GitText @("status", "--porcelain=v1", "--untracked-files=all")
  $sourceTree = "HEAD"
  $snapshotLabel = $head

  if ($status -and -not $CommittedOnly) {
    $untrackedFiles = @(& git ls-files --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) {
      throw "git ls-files failed with exit code $LASTEXITCODE"
    }
    $unsafeFiles = @($untrackedFiles | Where-Object {
      $_ -match '(^|/)(release\.env|[^/]+\.(key|pem|p12|pfx)|id_(rsa|ecdsa|ed25519))$'
    })
    if ($unsafeFiles.Count -gt 0) {
      throw "Refusing to publish untracked credential-like files: $($unsafeFiles -join ', ')"
    }

    $temporaryIndex = Join-Path ([System.IO.Path]::GetTempPath()) "gmed-dev-index-$PID-$([guid]::NewGuid().ToString('N'))"
    $temporaryObjects = Join-Path ([System.IO.Path]::GetTempPath()) "gmed-dev-objects-$PID-$([guid]::NewGuid().ToString('N'))"
    $realObjectDirectory = Invoke-GitText @("rev-parse", "--path-format=absolute", "--git-path", "objects")
    [void](New-Item -ItemType Directory -Path $temporaryObjects)
    $env:GIT_INDEX_FILE = $temporaryIndex
    $env:GIT_OBJECT_DIRECTORY = $temporaryObjects
    $env:GIT_ALTERNATE_OBJECT_DIRECTORIES = $realObjectDirectory

    Invoke-Checked "git" @("read-tree", "HEAD")
    Invoke-Checked "git" @("add", "-A", "--", ".")
    $sourceTree = Invoke-GitText @("write-tree")
    $snapshotLabel = "$head-worktree-$($sourceTree.Substring(0, 12))"

    Write-Host "Publishing current working tree snapshot: $snapshotLabel"
    Write-Host "Ignored files (including .env and node_modules) are not included."
  }
  elseif ($status) {
    Write-Warning "Working tree has local changes; -CommittedOnly publishes HEAD $head without them."
  }
  else {
    Write-Host "Publishing committed HEAD: $head"
  }

  $archive = Join-Path ([System.IO.Path]::GetTempPath()) "gmed-crm-$snapshotLabel-$PID.tgz"
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }

  Invoke-Checked "git" @("archive", "--format=tar.gz", "-o", $archive, $sourceTree)

  if ($DryRun) {
    $sizeMb = [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 2)
    Write-Host "Dry run OK: snapshot=$snapshotLabel archive=${sizeMb}MB"
    return
  }

  if (-not (Test-Path -LiteralPath $IdentityFile)) {
    throw "DEV SSH key not found: $IdentityFile"
  }

  $sshOptions = @(
    "-i", $IdentityFile,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=20",
    "-o", "StrictHostKeyChecking=accept-new"
  )
  $remote = "$User@$HostName"
  $localDeployScript = Join-Path $repoRoot "scripts\deploy-dev-current.sh"

  Invoke-Checked "ssh" ($sshOptions + @($remote, "mkdir -p /home/gmed/deploy"))
  Invoke-Checked "scp" ($sshOptions + @($archive, "${remote}:$RemoteArchive"))
  Invoke-Checked "scp" ($sshOptions + @($localDeployScript, "${remote}:$RemoteDeployScript"))
  Invoke-Checked "ssh" ($sshOptions + @($remote, "chmod 700 $RemoteDeployScript && bash $RemoteDeployScript $RemoteArchive"))

  if (-not $SkipSmoke) {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 30
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "Smoke check failed: $HealthUrl returned HTTP $($response.StatusCode)"
    }
    Write-Host "Smoke check OK: $HealthUrl -> HTTP $($response.StatusCode)"
  }

  Write-Host "Published DEV snapshot $snapshotLabel"
}
finally {
  if ($null -ne $previousIndex) {
    $env:GIT_INDEX_FILE = $previousIndex
  }
  else {
    Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
  }
  if ($null -ne $previousObjectDirectory) {
    $env:GIT_OBJECT_DIRECTORY = $previousObjectDirectory
  }
  else {
    Remove-Item Env:GIT_OBJECT_DIRECTORY -ErrorAction SilentlyContinue
  }
  if ($null -ne $previousAlternateObjects) {
    $env:GIT_ALTERNATE_OBJECT_DIRECTORIES = $previousAlternateObjects
  }
  else {
    Remove-Item Env:GIT_ALTERNATE_OBJECT_DIRECTORIES -ErrorAction SilentlyContinue
  }

  if ($temporaryIndex -and (Test-Path -LiteralPath $temporaryIndex)) {
    Remove-Item -LiteralPath $temporaryIndex -Force
  }
  if ($temporaryObjects -and (Test-Path -LiteralPath $temporaryObjects)) {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $objectsPath = [System.IO.Path]::GetFullPath($temporaryObjects)
    if (-not $objectsPath.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected temporary object path: $objectsPath"
    }
    Remove-Item -LiteralPath $objectsPath -Recurse -Force
  }
  if ($archive -and (Test-Path -LiteralPath $archive)) {
    Remove-Item -LiteralPath $archive -Force
  }

  Pop-Location
}
