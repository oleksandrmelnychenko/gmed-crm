#!/usr/bin/env bash
# Local Rust quality gate for WSL2: the same fmt / clippy / test steps as the
# `rust` job in .github/workflows/ci.yml, plus the database integration tests
# (CI has no TEST_DATABASE_ADMIN_URL, so it skips them).
#
# Run from Windows:  wsl.exe -d Ubuntu-24.04 -- bash scripts/ci-local.sh [steps]
# or inside WSL from the repository root. Steps: fmt clippy test (default all);
# `test -- <filter>` passes the rest to `cargo test`.
#
# Sources are copied to the Linux filesystem (much faster than /mnt/c) and the
# cargo target directory persists between runs. A throwaway PostgreSQL cluster
# is started for the tests and stopped afterwards; set PG_BIN if PostgreSQL is
# not on PATH (e.g. binaries unpacked with `apt-get download` + `dpkg-deb -x`).

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${GMED_CI_DIR:-$HOME/gmed-ci}"
BUILD_DIR="$WORK_DIR/src"
export CARGO_TARGET_DIR="$WORK_DIR/target"
export SQLX_OFFLINE=true
PG_PORT="${GMED_CI_PG_PORT:-55432}"
PG_DATA="$WORK_DIR/pgdata"
TEST_THREADS="${RUST_TEST_THREADS:-8}"

if [[ -z "${PG_BIN:-}" && -x "$HOME/pgdist/root/usr/lib/postgresql/16/bin/postgres" ]]; then
  PG_BIN="$HOME/pgdist/root/usr/lib/postgresql/16/bin"
  export LD_LIBRARY_PATH="$HOME/pgdist/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
pg() { if [[ -n "${PG_BIN:-}" ]]; then "$PG_BIN/$1" "${@:2}"; else "$@"; fi; }

# shellcheck disable=SC1091
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"

steps=()
test_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; test_args=("$@"); break ;;
    *) steps+=("$1"); shift ;;
  esac
done
[[ ${#steps[@]} -eq 0 ]] && steps=(fmt clippy test)

mkdir -p "$BUILD_DIR"
# Only what the Rust workspace compiles or embeds (include_str!/include_bytes!).
rsync -a --delete --delete-excluded \
  --include=/Cargo.toml --include=/Cargo.lock --include=/rust-toolchain.toml \
  --include=/deny.toml --include='/.sqlx/***' --include='/crates/***' \
  --include='/migrations/***' --include=/docs/ --include='/docs/backlog/***' \
  --include=/docs/comparison/ --include='/docs/comparison/fonts/***' \
  --exclude='*' \
  "$SRC_DIR/" "$BUILD_DIR/"

cd "$BUILD_DIR"
started_pg=0
cleanup() {
  local status=$?
  if [[ "$started_pg" -eq 1 ]]; then
    pg pg_ctl -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

for step in "${steps[@]}"; do
  case "$step" in
    fmt)
      echo "== cargo fmt --check"
      cargo fmt --all -- --check
      ;;
    clippy)
      echo "== cargo clippy"
      cargo clippy --workspace --all-targets --locked -- -D warnings
      ;;
    test)
      if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
        rm -rf "$PG_DATA"
        pg initdb -D "$PG_DATA" -U postgres --auth=trust >/dev/null
      fi
      pg pg_ctl -D "$PG_DATA" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=300 -c fsync=off" -l "$WORK_DIR/pg.log" -w start >/dev/null
      started_pg=1
      echo "== cargo test (PostgreSQL on 127.0.0.1:$PG_PORT, $TEST_THREADS threads)"
      TEST_DATABASE_ADMIN_URL="postgres://postgres@127.0.0.1:$PG_PORT/postgres" \
      TEST_DATABASE_MAX_CONNECTIONS=4 \
      RUST_TEST_THREADS="$TEST_THREADS" \
        cargo test --workspace --locked --no-fail-fast "${test_args[@]}"
      ;;
    *)
      echo "Unknown step: $step (use fmt, clippy, test)" >&2
      exit 2
      ;;
  esac
done
echo "Local Rust gate passed: ${steps[*]}"
