#!/usr/bin/env bash
# First-deploy helper for PROD / monitoring hosts.
#
# It automates the out-of-band steps that remain intentionally outside
# Terraform state: copy the age private key, install it as /etc/gmed/age.key,
# clone the repo, and invoke the right deploy script.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/bootstrap-remote-host.sh <prod|monitoring> <ssh-host> <age-key-file>

Examples:
  scripts/bootstrap-remote-host.sh prod console.gmed-health.com ~/.config/sops/age/gmed-prod.key
  scripts/bootstrap-remote-host.sh monitoring 203.0.113.42 ~/.config/sops/age/gmed-monitoring.key

Environment overrides:
  SSH_USER=gmed
  REPO_URL=https://github.com/oleksandrmelnychenko/gmed-crm.git
  REPO_BRANCH=main
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 3 ]]; then
  usage
  exit 1
fi

target="$1"
ssh_host="$2"
age_key_file="$3"

case "$target" in
  prod)
    deploy_script="scripts/deploy-prod.sh"
    ;;
  monitoring)
    deploy_script="scripts/deploy-monitoring.sh"
    ;;
  *)
    echo "ERROR: target must be 'prod' or 'monitoring'." >&2
    exit 1
    ;;
esac

if [[ ! -r "$age_key_file" ]]; then
  echo "ERROR: age key file missing or unreadable: $age_key_file" >&2
  exit 1
fi

SSH_USER="${SSH_USER:-gmed}"
REPO_URL="${REPO_URL:-https://github.com/oleksandrmelnychenko/gmed-crm.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
remote="${SSH_USER}@${ssh_host}"
remote_key="/tmp/gmed-age-key.$$"

echo "Copying age key to $remote:$remote_key"
scp "$age_key_file" "$remote:$remote_key"

echo "Installing key, cloning repo, and running $deploy_script on $remote"
ssh "$remote" \
  "REMOTE_KEY='$remote_key' REPO_URL='$REPO_URL' REPO_BRANCH='$REPO_BRANCH' DEPLOY_SCRIPT='$deploy_script' bash -s" <<'REMOTE'
set -euo pipefail

sudo install -o root -g root -m 600 "$REMOTE_KEY" /etc/gmed/age.key
shred -u "$REMOTE_KEY"

sudo install -d -o root -g root -m 755 /opt/gmed
if [[ ! -d /opt/gmed/repo/.git ]]; then
  sudo git clone --depth 50 --branch "$REPO_BRANCH" "$REPO_URL" /opt/gmed/repo
else
  sudo git -C /opt/gmed/repo fetch origin "$REPO_BRANCH"
fi

sudo env GIT_BRANCH="$REPO_BRANCH" "/opt/gmed/repo/$DEPLOY_SCRIPT"
REMOTE

echo "Remote bootstrap complete."
