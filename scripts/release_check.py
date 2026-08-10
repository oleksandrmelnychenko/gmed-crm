from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PARSER_ROOT = ROOT / "services" / "clinical-document-parser"


def resolve_command(command: list[str]) -> list[str]:
    if os.name == "nt" and command and command[0] == "npm":
        return ["npm.cmd", *command[1:]]
    return command


def run_step(
    label: str,
    command: list[str],
    extra_env: dict[str, str] | None = None,
    cwd: Path = ROOT,
) -> None:
    resolved = resolve_command(command)
    print(f"\n== {label} ==")
    print(" ".join(resolved))
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    if os.name == "nt":
        subprocess.run(
            subprocess.list2cmdline(resolved),
            cwd=cwd,
            env=env,
            check=True,
            shell=True,
        )
        return

    subprocess.run(resolved, cwd=cwd, env=env, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Workspace release preflight for the Rust backend, frontend, and "
            "clinical document parser."
        ),
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

    steps: list[tuple[str, list[str], dict[str, str] | None, Path]] = []

    if args.quick:
        steps.extend(
            [
                ("Rust Check", ["cargo", "check", "--workspace"], rust_env, ROOT),
                (
                    "Frontend Release Check",
                    ["npm", "--prefix", "frontend", "run", "release:check"],
                    None,
                    ROOT,
                ),
            ]
        )
    else:
        steps.extend(
            [
                (
                    "Rust Format",
                    ["cargo", "fmt", "--all", "--", "--check"],
                    rust_env,
                    ROOT,
                ),
                (
                    "Rust Clippy",
                    [
                        "cargo",
                        "clippy",
                        "--workspace",
                        "--all-targets",
                        "--locked",
                        "--",
                        "-D",
                        "warnings",
                    ],
                    rust_env,
                    ROOT,
                ),
                ("Rust Test", rust_test_command, rust_test_env, ROOT),
                (
                    "Frontend Release Check",
                    ["npm", "--prefix", "frontend", "run", "release:check:full"],
                    None,
                    ROOT,
                ),
            ]
        )

    steps.extend(
        [
            (
                "Clinical Parser Compile",
                [sys.executable, "-m", "compileall", "-q", "app", "benchmarks", "tests"],
                None,
                PARSER_ROOT,
            ),
            (
                "Clinical Parser and OCR Tests",
                [sys.executable, "-m", "pytest", "-q"],
                None,
                PARSER_ROOT,
            ),
            (
                "Clinical Parser Benchmark Tests",
                [sys.executable, "-m", "unittest", "benchmarks.test_evaluator", "-q"],
                None,
                PARSER_ROOT,
            ),
            (
                "Clinical Parser Synthetic Quality Gate",
                [
                    sys.executable,
                    "-m",
                    "benchmarks.run",
                    "--ground-truth",
                    "benchmarks/examples/synthetic_ground_truth.json",
                    "--fail-on-unsafe",
                    "--minimum-candidate-f1",
                    "0.90",
                    "--minimum-ocr-similarity",
                    "0.95",
                    "--minimum-cohort-candidate-f1",
                    "0.90",
                    "--minimum-cohort-ocr-similarity",
                    "0.95",
                    "--required-cohort",
                    "arztbrief",
                    "--minimum-required-cohort-cases",
                    "1",
                ],
                None,
                PARSER_ROOT,
            ),
        ]
    )
    steps.extend(
        [
            (
                "Print Binding Audit",
                [sys.executable, "scripts/audit_print_bindings.py"],
                None,
                ROOT,
            ),
            (
                "Repo Hygiene",
                [sys.executable, "scripts/check_repo_hygiene.py"],
                None,
                ROOT,
            ),
        ]
    )

    for label, command, env, cwd in steps:
        run_step(label, command, env, cwd)

    print("\nRelease preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
