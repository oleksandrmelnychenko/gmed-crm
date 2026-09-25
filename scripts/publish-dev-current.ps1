param(
  [string]$HostName = "console-dev.gmed-health.com",
  [string]$User = "gmed",
  [string]$IdentityFile = "$HOME\.ssh\gmed-dev-hetzner",
  [string]$RemoteArchive = "/home/gmed/deploy/gmed-crm-current.tgz",
  [string]$RemoteDeployScript = "/home/gmed/deploy/deploy-dev-current.sh",
  [string]$HealthUrl = "https://console-dev.gmed-health.com/health",
  [switch]$CommittedOnly,
  [switch]$SkipSmoke,
  [switch]$DirectMigrations,
  # Build the four application images on this workstation (Docker Desktop)
  # and push them through an SSH tunnel to the DEV-local registry; the DEV
  # host then only pulls changed layers instead of compiling.
  [switch]$LocalImages,
  [int]$LocalBuildJobs = 16,
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

# Best-effort native call: Windows PowerShell turns any stderr output into a
# terminating error under ErrorActionPreference=Stop. Returns the exit code.
function Invoke-Quiet {
  param([string]$FilePath, [string[]]$Arguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $FilePath @Arguments *> $null
    return $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
}

function Get-DockerCli {
  $command = Get-Command docker -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $fallback = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  throw "Docker CLI not found; start Docker Desktop or drop -LocalImages"
}

function Publish-LocalImages {
  param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string[]]$SshOptions,
    [Parameter(Mandatory = $true)][string]$Remote
  )

  $docker = Get-DockerCli
  Invoke-Checked $docker @("info", "--format", "{{.ServerVersion}}")

  # Build from the exact snapshot that is published, not from the checkout.
  $buildRoot = Join-Path $WorkRoot "build"
  [void](New-Item -ItemType Directory -Path $buildRoot)
  Invoke-Checked "tar" @("-xzf", $Archive, "-C", $buildRoot)

  # Compose interpolates every service even for `build`; these placeholders
  # never reach an image (no build argument uses them).
  $buildEnv = Join-Path $WorkRoot "build.env"
  @(
    "GMED_JWT_SECRET=build-only-placeholder-not-a-secret-000000",
    "GMED_MESSAGE_ENCRYPTION_KEYS=v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "GMED_INVOICE_PARSER_API_KEY=build-only-placeholder",
    "CADDY_HOSTNAME=console-dev.gmed-health.com",
    "ACME_EMAIL=build@example.invalid"
  ) | Set-Content -LiteralPath $buildEnv -Encoding ascii
  $buildOverride = Join-Path $WorkRoot "build-local.yml"
  @(
    "services:",
    "  backend:",
    "    build:",
    "      args:",
    "        GMED_CARGO_BUILD_JOBS: `"$LocalBuildJobs`""
  ) | Set-Content -LiteralPath $buildOverride -Encoding ascii

  # The public Argos model host may refuse downloads; like the DEV runner,
  # reuse a cached archive (the image build verifies its pinned SHA-256).
  $modelCache = Join-Path $env:LOCALAPPDATA "gmed\translation-model.argosmodel"
  if (-not (Test-Path -LiteralPath $modelCache)) {
    [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $modelCache))
    Write-Host "Caching the translation model archive from the DEV host..."
    Invoke-Checked "scp" ($SshOptions + @(($Remote + ":/home/gmed/gmed-crm/services/clinical-document-parser/translation-model.argosmodel"), $modelCache))
  }
  Copy-Item -LiteralPath $modelCache -Destination (Join-Path $buildRoot "services\clinical-document-parser\translation-model.argosmodel")

  $services = @("backend", "frontend", "clinical-document-parser", "invoice-parser")
  Write-Host "Building DEV images locally: $($services -join ', ')"
  Invoke-Checked $docker (@(
      "compose", "--project-name", "gmed-crm", "--env-file", $buildEnv,
      "-f", (Join-Path $buildRoot "docker-compose.yml"),
      "-f", (Join-Path $buildRoot "docker-compose.release.yml"),
      "-f", (Join-Path $buildRoot "docker-compose.hetzner.yml"),
      "-f", (Join-Path $buildRoot "docker-compose.dev-hetzner.yml"),
      "-f", $buildOverride,
      "build") + $services)

  # The push runs inside Docker Desktop's VM, so the SSH tunnel to the
  # DEV-local registry runs there too (a throwaway container on its network).
  $keyPath = (Resolve-Path -LiteralPath $IdentityFile).Path
  $bootstrap = "docker inspect gmed-dev-registry >/dev/null 2>&1 || docker run -d --name gmed-dev-registry --restart unless-stopped -p 127.0.0.1:5000:5000 -v gmed-dev-registry:/var/lib/registry -e REGISTRY_STORAGE_DELETE_ENABLED=true registry:2 >/dev/null"
  Invoke-Checked "ssh" ($SshOptions + @($Remote, $bootstrap))
  Invoke-Quiet $docker @("rm", "-f", "gmed-dev-tunnel") | Out-Null
  $tunnel = "apk add -q --no-cache openssh-client && cp /key /tmp/k && chmod 600 /tmp/k && exec ssh -i /tmp/k -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -N -L 127.0.0.1:15000:127.0.0.1:5000 $Remote"
  Invoke-Checked $docker @(
    "run", "-d", "--name", "gmed-dev-tunnel", "--network", "host",
    "-v", ($keyPath + ":/key:ro"), "alpine:3.20", "sh", "-c", $tunnel
  )
  try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      Start-Sleep -Seconds 1
      if ((Invoke-Quiet $docker @("run", "--rm", "--network", "host", "alpine:3.20", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:15000/v2/")) -eq 0) { $ready = $true; break }
    }
    if (-not $ready) { throw "SSH tunnel to the DEV registry did not come up" }
    foreach ($service in $services) {
      $target = "localhost:15000/gmed-crm-" + $service + ":" + $Tag
      Invoke-Checked $docker @("tag", ("gmed-crm-" + $service + ":latest"), $target)
      Write-Host "Pushing $target"
      Invoke-Checked $docker @("push", "-q", $target)
      Invoke-Quiet $docker @("rmi", $target) | Out-Null
    }
  }
  finally {
    Invoke-Quiet $docker @("rm", "-f", "gmed-dev-tunnel") | Out-Null
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$archive = $null
$temporaryPublishRoot = $null
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

  # Upload the deploy runner from the exact same tree as the application archive.
  # Reading it directly from the checkout would let dirty local edits leak into a
  # -CommittedOnly deployment even though the application itself came from HEAD.
  $temporaryPublishRoot = Join-Path ([System.IO.Path]::GetTempPath()) "gmed-dev-publish-$PID-$([guid]::NewGuid().ToString('N'))"
  [void](New-Item -ItemType Directory -Path $temporaryPublishRoot)
  Invoke-Checked "tar" @(
    "-xzf", $archive,
    "-C", $temporaryPublishRoot,
    "scripts/deploy-dev-current.sh"
  )
  $localDeployScript = Join-Path $temporaryPublishRoot "scripts\deploy-dev-current.sh"
  if (-not (Test-Path -LiteralPath $localDeployScript)) {
    throw "Deploy runner is missing from snapshot $snapshotLabel"
  }

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

  # A queued publish must keep its own archive and matching runner: another
  # workstation can upload while the current deployment holds the host lock.
  $publishId = "$snapshotLabel-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  if (-not $PSBoundParameters.ContainsKey("RemoteArchive")) {
    $RemoteArchive = "/home/gmed/deploy/gmed-crm-$publishId.tgz"
  }
  if (-not $PSBoundParameters.ContainsKey("RemoteDeployScript")) {
    $RemoteDeployScript = "/home/gmed/deploy/deploy-dev-current-$publishId.sh"
  }

  $prebuiltTag = ""
  if ($LocalImages) {
    $prebuiltTag = ($publishId -replace '[^A-Za-z0-9_.-]', '-')
    Publish-LocalImages -Archive $archive -WorkRoot $temporaryPublishRoot -Tag $prebuiltTag -SshOptions $sshOptions -Remote $remote
  }

  Invoke-Checked "ssh" ($sshOptions + @($remote, "mkdir -p /home/gmed/deploy"))
  Invoke-Checked "scp" ($sshOptions + @($archive, "${remote}:$RemoteArchive"))
  Invoke-Checked "scp" ($sshOptions + @($localDeployScript, "${remote}:$RemoteDeployScript"))
  # Serialize builds as well as restarts: Compose uses shared image tags, so
  # merely locking the final container replacement still permits mixed releases.
  Write-Host "Waiting for the DEV deployment lock, then publishing $snapshotLabel..."
  $migrationMode = if ($DirectMigrations) { "direct" } else { "rehearse" }
  Invoke-Checked "ssh" ($sshOptions + @($remote, "chmod 700 $RemoteDeployScript && flock -x /home/gmed/deploy/deploy.lock env GMED_DEV_MIGRATION_MODE=$migrationMode GMED_DEV_PREBUILT_TAG=$prebuiltTag bash $RemoteDeployScript $RemoteArchive"))

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
  if ($temporaryPublishRoot -and (Test-Path -LiteralPath $temporaryPublishRoot)) {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $publishPath = [System.IO.Path]::GetFullPath($temporaryPublishRoot)
    if (-not $publishPath.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected temporary publish path: $publishPath"
    }
    Remove-Item -LiteralPath $publishPath -Recurse -Force
  }
  if ($archive -and (Test-Path -LiteralPath $archive)) {
    Remove-Item -LiteralPath $archive -Force
  }

  Pop-Location
}
