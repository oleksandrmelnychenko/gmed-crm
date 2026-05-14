#!/usr/bin/env bash
# Manual deploy script for PROD.
#
# On PROD the age private key is NOT in TF state — Terraform brings the
# server up and stops at the hardened-OS stage. The first deploy and
# every subsequent redeploy are driven by this script, run on the host
# as root (via sudo).
#
# Preconditions (set up once after `terraform apply`):
#   1. SCP the age private key to the host:
#        scp /path/to/prod.key gmed@console.gmed-health.com:/tmp/age.key
#   2. Install it:
#        ssh gmed@console.gmed-health.com
#        sudo install -o root -g root -m 600 /tmp/age.key /etc/gmed/age.key
#        shred -u /tmp/age.key
#   3. Clone the repo:
#        sudo install -d -o root -g root -m 755 /opt/gmed
#        sudo git clone --depth 50 \
#          https://github.com/oleksandrmelnychenko/gmed-crm.git \
#          /opt/gmed/repo
#
# After that, run this script for every deploy:
#   sudo /opt/gmed/repo/scripts/deploy-prod.sh
#
# It is intentionally idempotent — re-running it on a healthy host is a
# no-op apart from a pull and a compose reconciliation.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/gmed/repo}"
RELEASE_ENV="${RELEASE_ENV:-/opt/gmed/release.env}"
AGE_KEY_FILE="${AGE_KEY_FILE:-/etc/gmed/age.key}"
SECRETS_PATH="${SECRETS_PATH:-infra/terraform/environments/prod-hetzner/secrets.sops.yaml}"
GIT_BRANCH="${GIT_BRANCH:-main}"
LOG_FILE="${LOG_FILE:-/var/log/gmed-deploy.log}"
TMP_ENV=""

# cosign verification anchor. ANY image we run must be signed by the
# release workflow in THIS repository — Sigstore Fulcio's certificate
# embeds the workflow identity, so the regex below is the trust
# anchor. Update the owner/repo if the repository moves.
COSIGN_CERT_IDENTITY_REGEXP="${COSIGN_CERT_IDENTITY_REGEXP:-^https://github\.com/oleksandrmelnychenko/gmed-crm/\.github/workflows/release\.yml@refs/.*$}"
COSIGN_OIDC_ISSUER="${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
COSIGN_VERSION="${COSIGN_VERSION:-v2.4.1}"

# Run as root: needs to read /etc/gmed/age.key and run `docker compose`.
if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: deploy-prod.sh must be run as root (sudo)." >&2
  exit 1
fi

install -d -m 755 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
exec > >(TZ=UTC awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_FILE") 2>&1

finish() {
  local rc=$?
  trap - EXIT
  if [[ -n "${TMP_ENV:-}" ]]; then
    rm -f "$TMP_ENV" || true
  fi
  echo "deploy-prod finished rc=$rc"
  exit "$rc"
}
trap finish EXIT

echo "deploy-prod started branch=$GIT_BRANCH repo=$REPO_DIR"

for path in "$REPO_DIR/.git" "$AGE_KEY_FILE"; do
  if [[ ! -e "$path" ]]; then
    echo "ERROR: $path missing. See the script header for first-time setup steps." >&2
    exit 1
  fi
done

# Refresh the repo. `git reset --hard` discards any local drift; PROD
# treats the repo as a read-only artifact.
cd "$REPO_DIR"
git fetch origin "$GIT_BRANCH"
git checkout "$GIT_BRANCH"
git reset --hard "origin/$GIT_BRANCH"

# Decrypt secrets to a fresh release.env. Atomic write: decrypt to a
# temp file in the same dir, fsync, rename — that way a partial decrypt
# never replaces the live env file.
TMP_ENV="$(mktemp -p "$(dirname "$RELEASE_ENV")" release.env.XXXXXX)"

SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" \
  sops -d --output-type dotenv "$REPO_DIR/$SECRETS_PATH" > "$TMP_ENV"

# Sanity check before we go live: required keys must be present.
required_keys=(
  GMED_DATABASE_URL
  GMED_JWT_SECRET
  GMED_MESSAGE_ENCRYPTION_KEYS
  GMED_MESSAGE_ENCRYPTION_KEY_ACTIVE
  GMED_AUDIT_IP_SALT
  GMED_CORS_ORIGIN
  CADDY_HOSTNAME
  ACME_EMAIL
  POSTGRES_USER
  POSTGRES_PASSWORD
  GMED_BACKEND_IMAGE
  GMED_FRONTEND_IMAGE
  POSTGRES_METRICS_USER
  POSTGRES_METRICS_PASSWORD
  LOKI_URL
)
for key in "${required_keys[@]}"; do
  if ! grep -q "^${key}=" "$TMP_ENV"; then
    echo "ERROR: secrets.sops.yaml is missing required key: $key" >&2
    exit 1
  fi
done

install -m 600 "$TMP_ENV" "$RELEASE_ENV"

# Source the decrypted env into this shell so later steps (Tailscale
# auth, cosign verify) can read the values. `set -a` exports every
# subsequent assignment.
set -a
# shellcheck disable=SC1090
. "$RELEASE_ENV"
set +a

# Ensure backup tooling is present. rclone and age are tiny; apt-get
# install is a fast no-op when already installed.
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  rclone age >/dev/null

# Install cosign from upstream releases (Ubuntu apt does not ship it).
# Pinned by version + verified by the binary's own self-test on first
# invocation. The download URL is HTTPS to github.com which we already
# trust for the repo clone.
if [[ ! -x /usr/local/bin/cosign ]] || ! /usr/local/bin/cosign version 2>/dev/null | grep -q "${COSIGN_VERSION#v}"; then
  ARCH="$(dpkg --print-architecture)"   # arm64 | amd64
  curl -fsSL \
    "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-linux-${ARCH}" \
    -o /usr/local/bin/cosign
  chmod +x /usr/local/bin/cosign
fi

# Cosign keyless verification. Each image ref MUST be digest-pinned
# (`@sha256:...`). Floating tags would race the verify/pull window —
# we'd verify one digest and `docker pull` could resolve a different
# one if the tag rotated between calls.
for image_var in GMED_BACKEND_IMAGE GMED_FRONTEND_IMAGE; do
  ref="${!image_var}"
  if [[ "$ref" != *"@sha256:"* ]]; then
    echo "ERROR: $image_var must be digest-pinned (ends with @sha256:...). Got: $ref" >&2
    echo "Pick a digest from the release workflow run summary on GitHub Actions." >&2
    exit 1
  fi
  echo "Verifying cosign signature on $ref"
  /usr/local/bin/cosign verify \
    --certificate-identity-regexp "$COSIGN_CERT_IDENTITY_REGEXP" \
    --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" \
    "$ref" >/dev/null
done

# Tailscale: bring up the daemon if a key is present in the release.env
# and the daemon is not already authenticated. Idempotent — `tailscale
# up` on an already-authenticated daemon with matching args is a fast
# no-op. We deliberately do NOT auto-disable Tailscale if the key is
# absent (might be a transient sops edit).
if [[ -n "${TAILSCALE_AUTH_KEY:-}" ]] && command -v tailscale >/dev/null 2>&1; then
  if ! tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
    echo "Bringing up Tailscale"
    HOSTNAME_FLAG=""
    if [[ -n "${TAILSCALE_HOSTNAME:-}" ]]; then
      HOSTNAME_FLAG="--hostname=${TAILSCALE_HOSTNAME}"
    fi
    tailscale up \
      --authkey="$TAILSCALE_AUTH_KEY" \
      $HOSTNAME_FLAG \
      --accept-routes=false \
      --accept-dns=false \
      --ssh=false
    echo "Tailscale: $(tailscale ip -4 2>/dev/null || echo 'pending')"
  fi
fi

# Install / refresh the backup cron entry. crond rejects files in
# /etc/cron.d that are group- or world-writable, so 644 is mandatory.
if [[ -r "$REPO_DIR/infra/cron/gmed-backup.cron" ]]; then
  install -o root -g root -m 644 \
    "$REPO_DIR/infra/cron/gmed-backup.cron" \
    /etc/cron.d/gmed-backup
  # Touch the log file so the very first cron run does not need to
  # create it with cron's default umask.
  touch /var/log/gmed-backup.log
  chmod 640 /var/log/gmed-backup.log
fi

# Install / refresh the external application health ping if configured.
# This is intentionally separate from Prometheus: Healthchecks.io is the
# outside watcher for "host or monitoring stack is gone".
if [[ -n "${HEALTHCHECKS_PING_URL:-}" ]]; then
  cat > /etc/cron.d/gmed-app-healthcheck <<EOF
# Auto-installed by deploy-prod.sh. Pings Healthchecks.io only after
# the public app health endpoint responds successfully.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root curl -fsS --max-time 10 "https://${CADDY_HOSTNAME}/health" >/dev/null 2>&1 && curl -fsS --retry 3 --max-time 10 "$HEALTHCHECKS_PING_URL" >/dev/null 2>&1
EOF
  chmod 600 /etc/cron.d/gmed-app-healthcheck
else
  rm -f /etc/cron.d/gmed-app-healthcheck
fi

# Bring (or keep) services up. No --build: PROD pulls cosign-verified
# images, never builds them locally. The ghcr override is layered LAST
# so its `image:` directives win over any inherited `build:` block.
docker compose \
  --env-file "$RELEASE_ENV" \
  -f docker-compose.yml \
  -f docker-compose.release.yml \
  -f docker-compose.hetzner.yml \
  -f docker-compose.prod-hetzner.yml \
  -f docker-compose.ghcr.yml \
  up -d --remove-orphans

if [[ -x "$REPO_DIR/scripts/ensure-prod-metrics-user.sh" ]]; then
  "$REPO_DIR/scripts/ensure-prod-metrics-user.sh"
  docker restart gmed-postgres-exporter >/dev/null 2>&1 || true
fi

# Prune dangling images so the host doesn't accumulate layers from
# older pinned digests. The volumes (pgdata, uploads, caddy_data) are
# explicitly excluded by `docker image prune` (it only touches images).
docker image prune -f --filter "until=24h"

date -u +%Y-%m-%dT%H:%M:%SZ > /etc/gmed/deploy.last
echo "Deploy complete."
