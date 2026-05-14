#!/usr/bin/env bash
# Resolve GHCR tag digests into PROD image pins.
#
# Requires either GHCR_TOKEN + GHCR_USER, or an authenticated GitHub CLI
# (`gh auth login`). The token needs package read access for private
# packages. No Docker daemon is required.

set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" || "$TAG" == "-h" || "$TAG" == "--help" ]]; then
  cat >&2 <<'EOF'
Usage:
  scripts/resolve-ghcr-digests.sh <tag>

Example:
  scripts/resolve-ghcr-digests.sh v2026.05.14

Outputs:
  GMED_BACKEND_IMAGE=ghcr.io/...@sha256:...
  GMED_FRONTEND_IMAGE=ghcr.io/...@sha256:...
EOF
  [[ -z "$TAG" ]] && exit 1 || exit 0
fi

OWNER="${GHCR_OWNER:-oleksandrmelnychenko}"
REPO="${GHCR_REPO:-gmed-crm}"
GHCR_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

if [[ -z "$GHCR_TOKEN" ]]; then
  if command -v gh >/dev/null 2>&1; then
    GHCR_TOKEN="$(gh auth token)"
    GHCR_USER="${GHCR_USER:-$(gh api user --jq .login)}"
  else
    echo "ERROR: set GHCR_TOKEN/GHCR_USER or install/authenticate gh." >&2
    exit 1
  fi
fi

if [[ -z "$GHCR_USER" ]]; then
  echo "ERROR: set GHCR_USER when GHCR_TOKEN is provided directly." >&2
  exit 1
fi

resolve_digest() {
  local image="$1"
  local url="https://ghcr.io/v2/${OWNER}/${image}/manifests/${TAG}"
  local headers
  headers="$(curl -fsSI \
    -u "${GHCR_USER}:${GHCR_TOKEN}" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    "$url")"
  printf '%s\n' "$headers" \
    | awk 'tolower($0) ~ /^docker-content-digest:/ { gsub("\r", ""); sub(/^[^:]+:[[:space:]]*/, ""); print }' \
    | tail -n 1
}

backend_image="${REPO}-server"
frontend_image="${REPO}-frontend"
backend_digest="$(resolve_digest "$backend_image")"
frontend_digest="$(resolve_digest "$frontend_image")"

if [[ -z "$backend_digest" || -z "$frontend_digest" ]]; then
  echo "ERROR: failed to resolve one or both digests for tag '$TAG'." >&2
  exit 1
fi

cat <<EOF
GMED_BACKEND_IMAGE=ghcr.io/${OWNER}/${backend_image}@${backend_digest}
GMED_FRONTEND_IMAGE=ghcr.io/${OWNER}/${frontend_image}@${frontend_digest}
EOF
