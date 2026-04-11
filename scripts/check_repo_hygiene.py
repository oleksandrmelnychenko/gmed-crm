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


def main() -> int:
    tracked = git_ls_files()
    forbidden = sorted(path for path in tracked if is_forbidden(path))
    if forbidden:
        print("Tracked runtime/build artifacts are not allowed:", file=sys.stderr)
        for path in forbidden:
            print(f" - {path}", file=sys.stderr)
        return 1

    print("Repo hygiene check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
