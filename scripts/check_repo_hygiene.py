from __future__ import annotations

import subprocess
import sys
from pathlib import PurePosixPath


FORBIDDEN_TRACKED_PATHS = (
    ".claude/settings.local.json",
    "target",
    "target-test-run",
    "target-patient-slice",
    "dist",
    "frontend/dist",
    "node_modules",
    "frontend/node_modules",
)


# =============================================================================
# Audit migration ratchet
# =============================================================================
#
# The repository is migrating every direct `INSERT INTO audit_log` out of
# handler bodies and onto the `AuditContext` API in `crates/server/src/audit.rs`.
# Every migration commit must LOWER this number. Every commit that leaves it
# unchanged is fine. A commit that RAISES it fails CI with a pointer to the
# migration policy at the top of `crates/server/src/audit.rs`.
#
# When you migrate N handler-side inserts, count the remaining occurrences
# with `git grep -c "INSERT INTO audit_log" -- crates/server/src/routes/` and
# update this constant in the same commit.
AUDIT_INSERT_BUDGET = 70
AUDIT_SEARCH_PATH = "crates/server/src/routes/"
AUDIT_PATTERN = "INSERT INTO audit_log"


def git_ls_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def is_forbidden(path: str) -> bool:
    posix_path = PurePosixPath(path)
    path_str = posix_path.as_posix()
    for forbidden in FORBIDDEN_TRACKED_PATHS:
        if path_str == forbidden or path_str.startswith(f"{forbidden}/"):
            return True
    return False


def count_audit_inserts() -> int:
    """Count lines that contain the manual audit-insert pattern under
    the handler routes directory. `git grep -c` reports per-file match
    counts as `path:N`; we sum the right-hand side."""
    result = subprocess.run(
        ["git", "grep", "-c", "-F", AUDIT_PATTERN, "--", AUDIT_SEARCH_PATH],
        capture_output=True,
        text=True,
    )
    # Exit code 1 means "no matches found". Anything else is a real error.
    if result.returncode not in (0, 1):
        print(
            f"git grep for audit pattern failed with code {result.returncode}: "
            f"{result.stderr.strip()}",
            file=sys.stderr,
        )
        return -1
    total = 0
    for line in result.stdout.splitlines():
        _, _, count_str = line.rpartition(":")
        try:
            total += int(count_str)
        except ValueError:
            continue
    return total


def check_audit_ratchet() -> int:
    actual = count_audit_inserts()
    if actual < 0:
        return 1
    if actual > AUDIT_INSERT_BUDGET:
        print(
            f"Audit migration ratchet FAILED: {actual} `{AUDIT_PATTERN}` "
            f"occurrences found under {AUDIT_SEARCH_PATH}, budget is "
            f"{AUDIT_INSERT_BUDGET}. New handler-side audit inserts are "
            f"forbidden — use `AuditContext` via `Extension<AuditContext>` "
            f"instead. See the migration policy at the top of "
            f"crates/server/src/audit.rs.",
            file=sys.stderr,
        )
        return 1
    if actual < AUDIT_INSERT_BUDGET:
        print(
            f"Audit migration ratchet: budget is {AUDIT_INSERT_BUDGET} but "
            f"only {actual} `{AUDIT_PATTERN}` occurrences remain. Tighten "
            f"the ratchet by setting AUDIT_INSERT_BUDGET = {actual} in "
            f"scripts/check_repo_hygiene.py in this commit.",
            file=sys.stderr,
        )
        return 1
    return 0


def main() -> int:
    tracked = git_ls_files()
    forbidden = sorted(path for path in tracked if is_forbidden(path))
    if forbidden:
        print("Tracked runtime/build artifacts are not allowed:", file=sys.stderr)
        for path in forbidden:
            print(f" - {path}", file=sys.stderr)
        return 1

    ratchet_status = check_audit_ratchet()
    if ratchet_status != 0:
        return ratchet_status

    print("Repo hygiene check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
