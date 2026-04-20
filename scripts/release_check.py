from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def resolve_command(command: list[str]) -> list[str]:
    if os.name == "nt" and command and command[0] == "npm":
        return ["npm.cmd", *command[1:]]
    return command


def run_step(label: str, command: list[str], extra_env: dict[str, str] | None = None) -> None:
    resolved = resolve_command(command)
    print(f"\n== {label} ==")
    print(" ".join(resolved))
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    if os.name == "nt":
        subprocess.run(
            subprocess.list2cmdline(resolved),
            cwd=ROOT,
            env=env,
            check=True,
            shell=True,
        )
        return

    subprocess.run(resolved, cwd=ROOT, env=env, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Workspace release preflight for Rust backend + frontend.",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run the fast preflight path without full Rust tests/clippy.",
    )
    args = parser.parse_args()

    rust_env = {"SQLX_OFFLINE": os.environ.get("SQLX_OFFLINE", "true")}
    rust_test_env = dict(rust_env)
    rust_test_command = ["cargo", "test", "--workspace", "--locked"]
    if os.name == "nt":
        rust_test_command.extend(["-j", os.environ.get("CARGO_BUILD_JOBS", "1")])
        rust_test_env["CARGO_TARGET_DIR"] = os.environ.get(
            "CARGO_TEST_TARGET_DIR",
            str(ROOT / "target" / "preflight-test"),
        )
        rust_test_env.setdefault("CARGO_PROFILE_DEV_DEBUG", "0")
        rust_test_env.setdefault("CARGO_PROFILE_TEST_DEBUG", "0")

    steps: list[tuple[str, list[str], dict[str, str] | None]] = []

    if args.quick:
        steps.extend(
            [
                ("Rust Check", ["cargo", "check", "--workspace"], rust_env),
                ("Frontend Release Check", ["npm", "--prefix", "frontend", "run", "release:check"], None),
            ]
        )
    else:
        steps.extend(
            [
                ("Rust Format", ["cargo", "fmt", "--all", "--", "--check"], rust_env),
                ("Rust Clippy", ["cargo", "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"], rust_env),
                ("Rust Test", rust_test_command, rust_test_env),
                ("Frontend Release Check", ["npm", "--prefix", "frontend", "run", "release:check:full"], None),
            ]
        )

    steps.append(
        ("Repo Hygiene", [sys.executable, "scripts/check_repo_hygiene.py"], None),
    )

    for label, command, env in steps:
        run_step(label, command, env)

    print("\nRelease preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
