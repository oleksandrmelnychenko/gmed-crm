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
  # The four application images are built on this workstation (Docker Desktop)
  # and pushed through an SSH tunnel to the DEV-local registry; the DEV host
  # only pulls changed layers. This is the default: compiling on the 8 GB DEV
  # host runs out of memory. -LocalImages is kept for old command lines.
  [switch]$LocalImages,
  # Compile on the DEV host instead (old behaviour; needs enough free RAM there).
  [switch]$ServerBuild,
  [int]$LocalBuildJobs = 16,
  # Images are rebuilt only when their inputs changed (see Get-ImageSourceKeys);
  # -RebuildAll ignores the registry and builds all four images.
  [switch]$RebuildAll,
  # Compute the image keys, ask the DEV registry which images exist and print
  # the build/reuse plan. Nothing is built, pushed, uploaded, locked or deployed.
  [switch]$PlanOnly,
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
  throw "Docker CLI not found; start Docker Desktop or pass -ServerBuild to compile on the DEV host"
}

$ImageServices = @("backend", "frontend", "clinical-document-parser", "invoice-parser")
$RegistryAccept = "application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json"
# Bump when the key inputs or the local build recipe change in a way the file
# hashes below do not capture; every image is then rebuilt once.
$ImageKeyRecipe = "gmed-dev-image-key-v1"
# Compose files that define the DEV image builds (contexts, Dockerfiles and
# build args such as GMED_CARGO_PROFILE). GMED_CARGO_BUILD_JOBS from the local
# override only changes build parallelism, not the output, so it is not hashed.
$ImageComposeInputs = @("docker-compose.yml", "docker-compose.release.yml", "docker-compose.hetzner.yml", "docker-compose.dev-hetzner.yml")
# Repository paths that reach each image. The frontend is always rebuilt: its
# build args carry the build number and timestamp shown in the UI.
$ImageBuildInputs = @{
  "backend" = @{
    Context = ""
    Dockerfile = "Dockerfile.backend"
    Inputs = @(
      "Dockerfile.backend", ".dockerignore", ".cargo", "Cargo.toml", "Cargo.lock",
      "rust-toolchain.toml", "crates", "migrations", ".sqlx", "docs/comparison/fonts",
      "scripts/prepare-upload-volume.sh"
    )
  }
  # Whole build context, including the Dockerfile. The cached translation model
  # archive is not in git; its SHA-256 is pinned in app/install_translation_model.py.
  "clinical-document-parser" = @{
    Context = "services/clinical-document-parser"
    Dockerfile = "services/clinical-document-parser/Dockerfile"
    Inputs = @("services/clinical-document-parser")
  }
  "invoice-parser" = @{
    Context = ""
    Dockerfile = "services/invoice-parser/Dockerfile"
    Inputs = @(
      "services/invoice-parser/Dockerfile", "services/invoice-parser/Dockerfile.dockerignore", ".dockerignore",
      "services/clinical-document-parser/app/__init__.py",
      "services/clinical-document-parser/app/extraction.py",
      "services/clinical-document-parser/app/lab_grid.py",
      "services/clinical-document-parser/app/paddle_runtime.py",
      "services/invoice-parser/pyproject.toml",
      "services/invoice-parser/invoice_parser",
      "services/invoice-parser/templates"
    )
  }
}

function Get-TreeObjectId {
  param([string]$Tree, [string]$Path)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $result = & git rev-parse --verify --quiet ($Tree + ":" + $Path) 2>$null
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) { return $null }
  return ($result | Out-String).Trim()
}

# Source paths a Dockerfile COPYs from its build context (not from other stages),
# relative to the repository root.
function Get-DockerfileCopySources {
  param([string]$Tree, [string]$Dockerfile, [string]$Context)
  $text = Invoke-GitText @("show", ($Tree + ":" + $Dockerfile))
  $joined = $text -replace "\\\r?\n", " "
  $sources = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($joined -split "\r?\n")) {
    if ($line -match '^\s*RUN\b.*--mount=[^ ]*type=bind') {
      # A bind mount of the context sees every file in it.
      $sources.Add(($Context.TrimEnd("/") + "/").TrimStart("/") + "*")
      continue
    }
    if ($line -notmatch '^\s*(COPY|ADD)\s+(.*)$') { continue }
    $arguments = $Matches[2].Trim()
    if ($arguments -match '(^|\s)--from=') { continue }
    $tokens = @($arguments -split '\s+' | Where-Object { $_ -and -not $_.StartsWith("--") })
    if ($tokens.Count -lt 2 -or $tokens[0].StartsWith("[")) {
      $sources.Add("<unparsed: $arguments>")
      continue
    }
    foreach ($token in $tokens[0..($tokens.Count - 2)]) {
      $relative = $token -replace '^\./', ''
      if ($relative -eq ".") { $relative = "" }
      $path = if ($Context) { ($Context.TrimEnd("/") + "/" + $relative).TrimEnd("/") } else { $relative.TrimEnd("/") }
      $sources.Add($path)
    }
  }
  return $sources
}

function Test-PathCoveredByInputs {
  param([string]$Path, [string[]]$Inputs)
  # For a glob, the directory before the first wildcard must be covered.
  $literal = $Path
  $star = $literal.IndexOfAny([char[]]@('*', '?', '['))
  if ($star -ge 0) {
    $literal = $literal.Substring(0, $star)
    $slash = $literal.LastIndexOf("/")
    $literal = if ($slash -ge 0) { $literal.Substring(0, $slash) } else { "" }
  }
  foreach ($candidate in $Inputs) {
    if ($literal -eq $candidate -or $literal.StartsWith($candidate + "/")) { return $true }
  }
  return $false
}

# Content key per reusable image, computed from the exact tree that is archived
# and published: `src-` + 16 hex of SHA-256 over the recipe, the service name and
# the git object ids of its inputs. Same key = same image inputs.
function Get-ImageSourceKeys {
  param([Parameter(Mandatory = $true)][string]$SourceTree)
  $keys = [ordered]@{}
  foreach ($service in $ImageServices) {
    if (-not $ImageBuildInputs.ContainsKey($service)) { continue }
    $definition = $ImageBuildInputs[$service]
    $inputs = @($definition.Inputs) + $ImageComposeInputs

    $uncovered = @(Get-DockerfileCopySources -Tree $SourceTree -Dockerfile $definition.Dockerfile -Context $definition.Context |
        Where-Object { -not (Test-PathCoveredByInputs -Path $_ -Inputs $definition.Inputs) })
    if ($uncovered.Count -gt 0) {
      Write-Warning "$service copies paths outside its image key inputs ($($uncovered -join ', ')); it is always rebuilt until scripts/publish-dev-current.ps1 lists them."
      $keys[$service] = $null
      continue
    }

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("recipe=$ImageKeyRecipe")
    $lines.Add("service=$service")
    foreach ($path in $inputs) {
      $objectId = Get-TreeObjectId -Tree $SourceTree -Path $path
      if (-not $objectId) {
        Write-Warning "$service image input '$path' is missing from the snapshot."
        $objectId = "missing"
      }
      $lines.Add("$path=$objectId")
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n") + "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $digest = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    $hex = -join ($digest | ForEach-Object { $_.ToString("x2") })
    $keys[$service] = "src-" + $hex.Substring(0, 16)
  }
  return $keys
}

# Ask the DEV registry (over SSH, read-only) which `src-<key>` images exist and
# decide per service: "build" or "reuse".
function Get-ImagePlan {
  param(
    [Parameter(Mandatory = $true)]$SourceKeys,
    [Parameter(Mandatory = $true)][string[]]$SshOptions,
    [Parameter(Mandatory = $true)][string]$Remote,
    [switch]$RebuildAll,
    [switch]$AllowUnreachable
  )
  $plan = [ordered]@{}
  $items = @()
  foreach ($service in $ImageServices) {
    $plan[$service] = @{ Action = "build"; Reason = "always rebuilt" }
    if (-not $SourceKeys.Contains($service)) { continue }
    if (-not $SourceKeys[$service]) { $plan[$service].Reason = "inputs not fully keyed"; continue }
    if ($RebuildAll) { $plan[$service].Reason = "-RebuildAll"; continue }
    $plan[$service].Reason = "not in registry"
    $items += ($service + "=" + $SourceKeys[$service])
  }
  if ($items.Count -eq 0) { return $plan }

  $check = 'for item in ' + ($items -join ' ') + '; do svc=${item%%=*}; key=${item#*=}; code=$(curl -s -o /dev/null -w ''%{http_code}'' -H ''Accept: ' + $RegistryAccept + ''' http://127.0.0.1:5000/v2/gmed-crm-$svc/manifests/$key); echo $svc=$code; done'
  $output = @(& ssh @($SshOptions + @($Remote, $check)))
  if ($LASTEXITCODE -ne 0) { throw "Registry check over ssh failed with exit code $LASTEXITCODE" }
  $codes = @{}
  foreach ($line in $output) {
    if ("$line" -match '^([A-Za-z0-9_.-]+)=(.*)$') { $codes[$Matches[1]] = $Matches[2].Trim() }
  }
  foreach ($item in $items) {
    $service = $item.Split("=")[0]
    $code = $codes[$service]
    if ($code -eq "200") {
      $plan[$service] = @{ Action = "reuse"; Reason = "registry has $($SourceKeys[$service])" }
    }
    elseif ($code -eq "404") {
      continue
    }
    elseif ($AllowUnreachable) {
      $plan[$service].Reason = "registry answered '$code'"
    }
    else {
      throw "DEV registry check for gmed-crm-${service}:$($SourceKeys[$service]) returned '$code' (expected 200 or 404)"
    }
  }
  return $plan
}

function Format-ImagePlan {
  param([Parameter(Mandatory = $true)]$Plan)
  $build = @($Plan.Keys | Where-Object { $Plan[$_].Action -eq "build" })
  $reuse = @($Plan.Keys | Where-Object { $Plan[$_].Action -eq "reuse" })
  $buildText = if ($build.Count) { $build -join ", " } else { "none" }
  $reuseText = if ($reuse.Count) { $reuse -join ", " } else { "none" }
  return "Images: build $buildText; reuse $reuseText"
}

# Point `<Tag>` at the existing `src-<key>` manifests inside the DEV registry, so
# the runner can pull all four images by one tag. Runs on the DEV host; fails
# the publish unless every PUT returns HTTP 201.
function Invoke-RegistryRetag {
  param(
    [Parameter(Mandatory = $true)][string[]]$Services,
    [Parameter(Mandatory = $true)]$SourceKeys,
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string[]]$SshOptions,
    [Parameter(Mandatory = $true)][string]$Remote
  )
  $items = @($Services | ForEach-Object { $_ + "," + $SourceKeys[$_] })
  $retag = 'set -e; r=http://127.0.0.1:5000/v2; tag=' + $Tag + '; t=$(mktemp -d); trap ''rm -rf $t'' EXIT; ' +
    'printf ''Accept: %s\n'' ''' + $RegistryAccept + ''' > $t/accept; ' +
    'for item in ' + ($items -join ' ') + '; do svc=${item%%,*}; src=${item#*,}; ' +
    'curl -fsS -D $t/h -o $t/m -H @$t/accept $r/gmed-crm-$svc/manifests/$src; ' +
    'ct=$(sed -n ''s/^[Cc]ontent-[Tt]ype:[[:space:]]*//p'' $t/h | tr -d ''\r'' | tail -n 1); ' +
    'case $ct in application/*) ;; *) echo ERROR: no manifest content type for gmed-crm-$svc:$src >&2; exit 1;; esac; ' +
    'printf ''Content-Type: %s\n'' $ct > $t/ct; ' +
    'code=$(curl -sS -o /dev/null -w ''%{http_code}'' -X PUT -H @$t/ct --data-binary @$t/m $r/gmed-crm-$svc/manifests/$tag); ' +
    'case $code in 201) echo Reused gmed-crm-$svc:$src as $tag;; *) echo ERROR: retagging gmed-crm-$svc:$src as $tag returned HTTP $code >&2; exit 1;; esac; ' +
    'done'
  Invoke-Checked "ssh" ($SshOptions + @($Remote, $retag))
}

function Publish-LocalImages {
  param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$BuildNumber,
    [Parameter(Mandatory = $true)][string]$BuildTimestamp,
    [Parameter(Mandatory = $true)][string[]]$SshOptions,
    [Parameter(Mandatory = $true)][string]$Remote,
    [Parameter(Mandatory = $true)]$SourceKeys,
    [switch]$RebuildAll
  )

  $docker = Get-DockerCli
  Invoke-Checked $docker @("info", "--format", "{{.ServerVersion}}")

  # The registry must exist before asking it which images can be reused.
  $bootstrap = "docker inspect gmed-dev-registry >/dev/null 2>&1 || docker run -d --name gmed-dev-registry --restart unless-stopped -p 127.0.0.1:5000:5000 -v gmed-dev-registry:/var/lib/registry -e REGISTRY_STORAGE_DELETE_ENABLED=true registry:2 >/dev/null"
  Invoke-Checked "ssh" ($SshOptions + @($Remote, $bootstrap))
  $plan = Get-ImagePlan -SourceKeys $SourceKeys -SshOptions $SshOptions -Remote $Remote -RebuildAll:$RebuildAll
  $services = @($plan.Keys | Where-Object { $plan[$_].Action -eq "build" })
  $reused = @($plan.Keys | Where-Object { $plan[$_].Action -eq "reuse" })
  Write-Host (Format-ImagePlan -Plan $plan)

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
    "ACME_EMAIL=build@example.invalid",
    "VITE_BUILD_NUMBER=$BuildNumber",
    "VITE_BUILD_TIMESTAMP=$BuildTimestamp"
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
  if ($services -contains "clinical-document-parser") {
    $modelCache = Join-Path $env:LOCALAPPDATA "gmed\translation-model.argosmodel"
    if (-not (Test-Path -LiteralPath $modelCache)) {
      [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $modelCache))
      Write-Host "Caching the translation model archive from the DEV host..."
      Invoke-Checked "scp" ($SshOptions + @(($Remote + ":/home/gmed/gmed-crm/services/clinical-document-parser/translation-model.argosmodel"), $modelCache))
    }
    Copy-Item -LiteralPath $modelCache -Destination (Join-Path $buildRoot "services\clinical-document-parser\translation-model.argosmodel")
  }

  if ($services.Count -gt 0) {
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
        # The publish tag for the runner, plus the content key for later reuse.
        $imageTags = @($Tag)
        if ($SourceKeys.Contains($service) -and $SourceKeys[$service]) { $imageTags += $SourceKeys[$service] }
        foreach ($imageTag in $imageTags) {
          $target = "localhost:15000/gmed-crm-" + $service + ":" + $imageTag
          Invoke-Checked $docker @("tag", ("gmed-crm-" + $service + ":latest"), $target)
          Write-Host "Pushing $target"
          Invoke-Checked $docker @("push", "-q", $target)
          Invoke-Quiet $docker @("rmi", $target) | Out-Null
        }
      }
    }
    finally {
      Invoke-Quiet $docker @("rm", "-f", "gmed-dev-tunnel") | Out-Null
    }
  }

  # Reused images get the publish tag inside the registry; the runner pulls
  # all four images by that one tag.
  if ($reused.Count -gt 0) {
    Invoke-RegistryRetag -Services $reused -SourceKeys $SourceKeys -Tag $Tag -SshOptions $SshOptions -Remote $Remote
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

  # Keys come from the same tree as the archive (HEAD or the temporary snapshot
  # tree, still readable while the temporary object directory is active).
  $imageKeys = $null
  if ($PlanOnly -or -not $ServerBuild) {
    $imageKeys = Get-ImageSourceKeys -SourceTree $sourceTree
  }

  if ($PlanOnly) {
    if ($ServerBuild) {
      Write-Warning "-ServerBuild compiles every image on the DEV host; this plan applies to the default workstation build."
    }
    # Read-only: no registry bootstrap, no lock, no upload, no deployment.
    $plan = Get-ImagePlan -SourceKeys $imageKeys -SshOptions $sshOptions -Remote $remote -RebuildAll:$RebuildAll -AllowUnreachable
    foreach ($service in $plan.Keys) {
      $key = if ($imageKeys.Contains($service) -and $imageKeys[$service]) { $imageKeys[$service] } else { "-" }
      Write-Host ("  {0,-26} {1,-22} {2,-6} ({3})" -f $service, $key, $plan[$service].Action, $plan[$service].Reason)
    }
    Write-Host (Format-ImagePlan -Plan $plan)
    Write-Host "Plan only for snapshot ${snapshotLabel}: nothing was built, pushed, uploaded or deployed."
    return
  }

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
  $buildNumber = "dev-sha-$snapshotLabel"
  $buildTimestamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  if (-not $ServerBuild) {
    $prebuiltTag = ($publishId -replace '[^A-Za-z0-9_.-]', '-')
    Publish-LocalImages -Archive $archive -WorkRoot $temporaryPublishRoot -Tag $prebuiltTag -BuildNumber $buildNumber -BuildTimestamp $buildTimestamp -SshOptions $sshOptions -Remote $remote -SourceKeys $imageKeys -RebuildAll:$RebuildAll
  }

  Invoke-Checked "ssh" ($sshOptions + @($remote, "mkdir -p /home/gmed/deploy"))
  Invoke-Checked "scp" ($sshOptions + @($archive, "${remote}:$RemoteArchive"))
  Invoke-Checked "scp" ($sshOptions + @($localDeployScript, "${remote}:$RemoteDeployScript"))
  # Serialize builds as well as restarts: Compose uses shared image tags, so
  # merely locking the final container replacement still permits mixed releases.
  Write-Host "Waiting for the DEV deployment lock, then publishing $snapshotLabel..."
  $migrationMode = if ($DirectMigrations) { "direct" } else { "rehearse" }
  Invoke-Checked "ssh" ($sshOptions + @($remote, "chmod 700 $RemoteDeployScript && flock -x /home/gmed/deploy/deploy.lock env GMED_DEV_MIGRATION_MODE=$migrationMode GMED_DEV_PREBUILT_TAG=$prebuiltTag VITE_BUILD_NUMBER=$buildNumber VITE_BUILD_TIMESTAMP=$buildTimestamp bash $RemoteDeployScript $RemoteArchive"))

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
