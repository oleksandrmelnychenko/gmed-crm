#!/usr/bin/env bash
# One shard of the Rust test gate on a GitHub-hosted runner (ci.yml and
# release.yml). Together the shards run exactly what
# `cargo test --workspace --locked --no-fail-fast` ran: every test of every
# workspace target (cargo-nextest, one process per test, in parallel across
# the test binaries) and, in shard 1, the doc tests (nextest does not run
# those).
#
# All DB suites of the shard share one throwaway PostgreSQL on this runner and
# one migrated template (TEST_DATABASE_SHARED_TEMPLATE): each test copies the
# template into its own database, as before.
#
# Usage: scripts/ci-rust-tests.sh <shard> <shard-count> <workflow-file>

set -euo pipefail

shard="${1:?shard number}"
shards="${2:?shard count}"
workflow_file="${3:?workflow file for the failure annotation}"
test_threads="${GMED_TEST_THREADS:-8}"
postgres_image="${TEST_DATABASE_IMAGE:-postgres:16-alpine}"
container="gmed-ci-test-postgres"

for attempt in 1 2 3; do
  if docker pull "$postgres_image"; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  sleep "$((attempt * 5))"
done

# A throwaway test server: durability buys nothing (same flags the harness
# uses for its own container). Room for every parallel test process.
# authentication_timeout: a connection a finished test left half-opened sits
# in the login handshake, and DROP DATABASE waits for it (ProcSignalBarrier)
# until this timeout; the default 60 s made every test take 60 s.
docker run -d --rm --name "$container" --shm-size=1g \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p 127.0.0.1:5432:5432 \
  "$postgres_image" \
  -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  -c max_connections=500 -c authentication_timeout=2s >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d postgres

export TEST_DATABASE_ADMIN_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"
export TEST_DATABASE_SHARED_TEMPLATE="gmed_ci_template"

annotate_failure() {
  local log="$1" details
  details="$(sed -E 's/\x1b\[[0-9;]*m//g' "$log" \
    | grep -E '^ *(FAIL|SIGSEGV|SIGABRT|SIGKILL|TIMEOUT|LEAK) |^---- |panicked at|assertion|^  left:|^ right:|^failures:$|^test result: FAILED|^error: ' \
    | tail -n 80)"
  if [ -z "$details" ]; then
    details="$(tail -c 8000 "$log")"
  fi
  details="${details//'%'/'%25'}"
  details="${details//$'\r'/'%0D'}"
  details="${details//$'\n'/'%0A'}"
  echo "::error file=${workflow_file},title=Rust tests failed (shard ${shard}/${shards})::$details"
}

status=0
test_log="$(mktemp)"
set +e
cargo nextest run --workspace --locked --profile ci \
  --partition "count:${shard}/${shards}" --test-threads "$test_threads" 2>&1 | tee "$test_log"
nextest_status="${PIPESTATUS[0]}"
set -e
if [ "$nextest_status" -ne 0 ]; then
  annotate_failure "$test_log"
  status="$nextest_status"
fi

if [ "$shard" -eq 1 ]; then
  doc_log="$(mktemp)"
  set +e
  cargo test --workspace --locked --no-fail-fast --doc 2>&1 | tee "$doc_log"
  doc_status="${PIPESTATUS[0]}"
  set -e
  if [ "$doc_status" -ne 0 ]; then
    annotate_failure "$doc_log"
    status="$doc_status"
  fi
fi

exit "$status"
