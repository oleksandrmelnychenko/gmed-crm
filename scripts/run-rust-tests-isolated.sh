#!/usr/bin/env bash
# Run the complete Rust quality gate against an ephemeral PostgreSQL instance.
# The application database is never exposed to the test container.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/gmed/gmed-crm}"
POSTGRES_IMAGE="${TEST_DATABASE_IMAGE:-postgres:16-alpine}"
RUST_IMAGE="${RUST_TEST_IMAGE:-rust:slim-bookworm}"
TEST_THREADS="${RUST_TEST_THREADS:-2}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
POSTGRES_NAME="gmed-rust-test-postgres-${PPID}-${STAMP}"
POSTGRES_ID=""

cleanup() {
  if [[ -n "$POSTGRES_ID" ]]; then
    docker stop "$POSTGRES_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -f "$REPO_DIR/Cargo.toml" ]]; then
  echo "ERROR: Rust workspace not found at $REPO_DIR" >&2
  exit 1
fi

POSTGRES_ID="$(docker run -d --rm \
  --name "$POSTGRES_NAME" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1::5432 \
  "$POSTGRES_IMAGE")"

for _attempt in $(seq 1 60); do
  if docker exec "$POSTGRES_ID" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$POSTGRES_ID" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
  echo "ERROR: isolated PostgreSQL did not become ready" >&2
  docker logs "$POSTGRES_ID" >&2 || true
  exit 1
fi

POSTGRES_PORT="$(docker port "$POSTGRES_ID" 5432/tcp | awk -F: 'END { print $NF }')"
if [[ ! "$POSTGRES_PORT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not resolve isolated PostgreSQL port" >&2
  exit 1
fi

echo "Running Rust quality gate against isolated PostgreSQL on port $POSTGRES_PORT"

docker run --rm \
  --network host \
  -e SQLX_OFFLINE=true \
  -e RUST_TEST_THREADS="$TEST_THREADS" \
  -e TEST_DATABASE_MAX_CONNECTIONS=4 \
  -e "TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:${POSTGRES_PORT}/postgres" \
  -v "$REPO_DIR:/source:ro" \
  --mount type=volume,destination=/app,volume-nocopy \
  -v gmed-rust-test-cargo-registry:/usr/local/cargo/registry \
  -v gmed-rust-test-cargo-git:/usr/local/cargo/git \
  -v gmed-rust-test-target:/app/target \
  -w /app \
  "$RUST_IMAGE" \
  bash -c '
    set -euo pipefail
    cp -a /source/. /app/
    apt-get update -qq
    apt-get install -y --no-install-recommends \
      ca-certificates libssl-dev pkg-config \
      tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
      tesseract-ocr-rus tesseract-ocr-ukr >/dev/null
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
    cargo test --workspace --locked
  '

echo "Rust format, Clippy, migrations, and workspace tests passed."
