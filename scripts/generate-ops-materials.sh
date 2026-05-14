#!/usr/bin/env bash
# Local ops bootstrap generator.
#
# This does not call paid/external APIs. It creates local key material
# and gitignored helper files so the remaining console/API steps are
# deterministic instead of copy-paste archaeology.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGE_KEY_DIR="${AGE_KEY_DIR:-$HOME/.config/sops/age}"
OUT_DIR="${OUT_DIR:-$ROOT/.ops-bootstrap}"
SOPS_CONFIG="$ROOT/infra/terraform/.sops.yaml"

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/generate-ops-materials.sh [--force]

Generates:
  - age private keys in $AGE_KEY_DIR, if missing
  - public recipient summary in .ops-bootstrap/age-recipients.env
  - Tailscale ACL/policy starter in .ops-bootstrap/tailscale-policy.hujson
  - DNS checklist in .ops-bootstrap/dns-records.txt
  - external values template in .ops-bootstrap/external-values.env

It also updates infra/terraform/.sops.yaml with the generated public
recipients. Private keys never enter the repo.
EOF
}

force=false
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ "${1:-}" == "--force" ]]; then
  force=true
elif [[ $# -gt 0 ]]; then
  usage
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $1" >&2
    exit 1
  fi
}

require_command age-keygen
require_command awk

mkdir -p "$AGE_KEY_DIR" "$OUT_DIR"
chmod 700 "$AGE_KEY_DIR"

generate_key() {
  local name="$1"
  local path="$AGE_KEY_DIR/${name}.key"
  if [[ -e "$path" && "$force" != true ]]; then
    echo "Keeping existing key: $path" >&2
  else
    if [[ -e "$path" ]]; then
      echo "Regenerating key because --force was set: $path" >&2
    else
      echo "Generating key: $path" >&2
    fi
    age-keygen -o "$path" >/dev/null
    chmod 600 "$path"
  fi
  age-keygen -y "$path"
}

DEV_AGE_PUBLIC="$(generate_key gmed-dev)"
PROD_AGE_PUBLIC="$(generate_key gmed-prod)"
MONITORING_AGE_PUBLIC="$(generate_key gmed-monitoring)"
BACKUP_MASTER_PUBLIC="$(generate_key gmed-backup-master)"
BACKUP_RECOVERY_PUBLIC="$(generate_key gmed-backup-recovery)"

cat > "$OUT_DIR/age-recipients.env" <<EOF
DEV_AGE_PUBLIC=$DEV_AGE_PUBLIC
PROD_AGE_PUBLIC=$PROD_AGE_PUBLIC
MONITORING_AGE_PUBLIC=$MONITORING_AGE_PUBLIC
BACKUP_MASTER_PUBLIC=$BACKUP_MASTER_PUBLIC
BACKUP_RECOVERY_PUBLIC=$BACKUP_RECOVERY_PUBLIC
EOF
chmod 600 "$OUT_DIR/age-recipients.env"

update_sops_rule() {
  local env_name="$1"
  local recipient="$2"
  local tmp
  tmp="$(mktemp)"

  if grep -q "path_regex: environments/${env_name}-hetzner/" "$SOPS_CONFIG"; then
    awk -v env_name="$env_name" -v recipient="$recipient" '
      $0 ~ "path_regex: environments/" env_name "-hetzner/" {
        in_rule = 1
        print
        next
      }
      in_rule == 1 && $1 == "age:" {
        print "    age: " recipient
        in_rule = 0
        next
      }
      { print }
    ' "$SOPS_CONFIG" > "$tmp"
    mv "$tmp" "$SOPS_CONFIG"
  else
    cat >> "$SOPS_CONFIG" <<EOF

  - path_regex: environments/${env_name}-hetzner/.*\\.sops\\.yaml$
    age: ${recipient}
EOF
    rm -f "$tmp"
  fi
}

update_sops_rule dev "$DEV_AGE_PUBLIC"
update_sops_rule prod "$PROD_AGE_PUBLIC"
update_sops_rule monitoring "$MONITORING_AGE_PUBLIC"

cat > "$OUT_DIR/tailscale-policy.hujson" <<'EOF'
{
  "tagOwners": {
    "tag:gmed-dev": ["autogroup:admin"],
    "tag:gmed-prod": ["autogroup:admin"],
    "tag:gmed-monitoring": ["autogroup:admin"],
  },

  "acls": [
    {
      "action": "accept",
      "src": ["tag:gmed-monitoring"],
      "dst": [
        "tag:gmed-prod:9091,9100,9080,9187",
        "tag:gmed-dev:9091,9100,9080,9187",
      ],
    },
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": [
        "tag:gmed-prod:22",
        "tag:gmed-dev:22",
        "tag:gmed-monitoring:22,3000,9090,3100",
      ],
    },
  ],

  "ssh": [
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:gmed-dev", "tag:gmed-prod", "tag:gmed-monitoring"],
      "users": ["gmed", "root"],
    },
  ],
}
EOF

cat > "$OUT_DIR/dns-records.txt" <<'EOF'
# Fill after terraform apply prints public IPs.
#
# console.gmed-health.com:
#   A     <prod_ipv4>
#   AAAA  <prod_ipv6>     # optional if output exists and Caddy listens on IPv6
#
# console-dev.gmed-health.com:
#   A     <dev_ipv4>
#   AAAA  <dev_ipv6>      # optional if output exists and Caddy listens on IPv6
#
# gmed-monitoring:
#   Prefer Tailscale MagicDNS. Public DNS is not required for monitoring.
EOF

cat > "$OUT_DIR/external-values.env" <<'EOF'
# Values that still come from external systems. Keep this file local.

# Operator identity
ADMIN_SSH_PUBLIC_KEY=
ADMIN_IP_ALLOWLIST_CIDR=
ACME_EMAIL=ops@gmed-health.com
OPS_EMAIL=ops@gmed-health.com

# Hetzner
HCLOUD_TOKEN_DEV=
HCLOUD_TOKEN_PROD=
HCLOUD_TOKEN_MONITORING=
BACKUP_S3_ENDPOINT=https://fsn1.your-objectstorage.com
BACKUP_S3_REGION=fsn1
BACKUP_S3_BUCKET=gmed-prod-backups
BACKUP_S3_ACCESS_KEY=
BACKUP_S3_SECRET_KEY=

# Tailscale auth keys generated after applying .ops-bootstrap/tailscale-policy.hujson
TAILSCALE_AUTH_KEY_DEV=
TAILSCALE_AUTH_KEY_PROD=
TAILSCALE_AUTH_KEY_MONITORING=

# Healthchecks.io
HEALTHCHECKS_PING_URL=
BACKUP_HEALTHCHECKS_PING_URL=
MONITORING_HEALTHCHECKS_PING_URL=

# Alertmanager SMTP
ALERTMANAGER_SMTP_HOST=
ALERTMANAGER_SMTP_FROM=alerts@gmed-health.com
ALERTMANAGER_SMTP_USERNAME=
ALERTMANAGER_SMTP_PASSWORD=
ALERTMANAGER_TO_EMAIL=ops@gmed-health.com

# GHCR release image pins
GMED_BACKEND_IMAGE=
GMED_FRONTEND_IMAGE=
EOF
chmod 600 "$OUT_DIR/external-values.env"

cat <<EOF
Generated ops materials in $OUT_DIR

Next:
  1. Store private keys from $AGE_KEY_DIR in the right vault/offline location.
  2. Paste .ops-bootstrap/tailscale-policy.hujson into Tailscale policy.
  3. Generate tagged Tailscale auth keys and fill .ops-bootstrap/external-values.env.
  4. Use the generated public backup recipients in PROD secrets.sops.yaml.
EOF
