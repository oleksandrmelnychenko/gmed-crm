#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

REGION=eu-central-1
APP_REPO=https://github.com/oleksandrmelnychenko/gmed-crm.git
APP_BRANCH=main
BACKEND_PORT=3000
FRONTEND_PORT=8080

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git jq unzip awscli

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable docker
systemctl start docker

mkdir -p /opt/gmed
cd /opt/gmed
if [[ ! -d repo/.git ]]; then
  git clone --depth 1 --branch "$APP_BRANCH" "$APP_REPO" repo
else
  cd repo && git fetch origin "$APP_BRANCH" && git checkout "$APP_BRANCH" && git reset --hard "origin/$APP_BRANCH" && cd ..
fi

fetch_ssm() {
  aws ssm get-parameter --name "$1" --with-decryption --region "$REGION" --query 'Parameter.Value' --output text
}

DATABASE_URL=$(fetch_ssm /gmed/dev/DATABASE_URL)
JWT_SECRET=$(fetch_ssm /gmed/dev/JWT_SECRET)
MESSAGE_ENCRYPTION_KEYS=$(fetch_ssm /gmed/dev/MESSAGE_ENCRYPTION_KEYS)
MESSAGE_ENCRYPTION_KEY_ACTIVE=$(fetch_ssm /gmed/dev/MESSAGE_ENCRYPTION_KEY_ACTIVE)
AUDIT_IP_SALT=$(fetch_ssm /gmed/dev/AUDIT_IP_SALT)
CORS_ORIGIN=$(fetch_ssm /gmed/dev/CORS_ORIGIN)

cat > /opt/gmed/release.env <<EOF
GMED_DATABASE_URL=${DATABASE_URL}
GMED_JWT_SECRET=${JWT_SECRET}
GMED_MESSAGE_ENCRYPTION_KEYS=${MESSAGE_ENCRYPTION_KEYS}
GMED_MESSAGE_ENCRYPTION_KEY_ACTIVE=${MESSAGE_ENCRYPTION_KEY_ACTIVE}
GMED_AUDIT_IP_SALT=${AUDIT_IP_SALT}
GMED_CORS_ORIGIN=${CORS_ORIGIN}
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
EOF
chmod 600 /opt/gmed/release.env

cd /opt/gmed/repo
docker compose --env-file /opt/gmed/release.env -f docker-compose.yml -f docker-compose.release.yml up -d --build
docker compose ps
