"""Exercise the real DEV runner's lifecycle with Docker and RAM simulated.

No Docker daemon, SSH connection, application database or live service is used.
Run on Linux: python3 -m unittest discover -s scripts -p test_deploy_dev_current.py
"""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


RUNNER = Path(__file__).with_name("deploy-dev-current.sh")
OCR = ["gmed-crm-clinical-document-parser-1", "gmed-crm-invoice-parser-1"]
MOCK_DOCKER = r'''
import json, os, signal, subprocess, sys, time
from pathlib import Path
root = Path(os.environ["MOCK_ROOT"])
args = sys.argv[1:]
state_file = root / "state.json"
def log(event):
    with (root / "events.jsonl").open("a") as output:
        output.write(json.dumps(event) + "\n")
def state():
    return json.loads(state_file.read_text())
def memory(mb):
    (root / "meminfo").write_text(f"MemAvailable: {mb * 1024} kB\n")
if args[0] == "inspect":
    if os.environ.get("MOCK_INSPECT_FAIL") == args[-1]:
        sys.exit(1)
    print(str(state().get(args[-1], False)).lower())
elif args[0] in ("start", "stop"):
    action, container = args[0], args[-1]
    log([action, container])
    if action == "start" and os.environ.get("MOCK_START_FAIL") == container:
        sys.exit(1)
    current = state()
    current[container] = action == "start"
    state_file.write_text(json.dumps(current))
    if action == "stop":
        memory(int(os.environ.get("MOCK_RECOVER_MB", "6000")))
        if os.environ.get("MOCK_STOP_FAIL") == container:
            sys.exit(17)
elif args[0] == "compose" and "build" in args:
    log(["build", *args[args.index("build") + 1:]])
    child = None
    if os.environ.get("MOCK_LONG_BUILD"):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        (root / "child.pid").write_text(str(child.pid))
    def terminate(signum, _frame):
        if child is not None:
            # The runner must signal the whole session, including this child.
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                log(["orphaned-build-child"])
        log(["build-stopped"])
        sys.exit(128 + signum)
    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    if os.environ.get("MOCK_DROP_MB"):
        memory(int(os.environ["MOCK_DROP_MB"]))
    (root / "building").touch()
    time.sleep(60 if child is not None else 0.1)
    log(["build-ended"])
    sys.exit(int(os.environ.get("MOCK_BUILD_EXIT", "0")))
elif args[0] == "compose" and "up" in args:
    log(["rollback-up"])
    state_file.write_text(json.dumps({name: True for name in state()}))
else:
    raise RuntimeError(f"Unexpected Docker command: {args}")
'''


@unittest.skipUnless(shutil.which("bash") and shutil.which("setsid"), "Linux bash/setsid required")
class DevDeploymentMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.env = {
            **os.environ,
            "MOCK_ROOT": str(self.root),
            "PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}",
            "REPO_DIR": str(self.root / "repo"),
            "DEPLOY_DIR": str(self.root / "deploy"),
            "BUILD_MEMORY_HEADROOM_MB": "6144",
            "BUILD_MEMORY_ABORT_MB": "768",
        }
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.root / "deploy" / "failed").mkdir(parents=True)
        (self.root / "state.json").write_text(json.dumps(dict.fromkeys(OCR, True)))
        self.memory(8000)
        docker = self.root / "docker"
        docker.write_text(f"#!{sys.executable}\n" + MOCK_DOCKER)
        docker.chmod(0o755)
        cosign = self.root / "cosign"
        cosign.write_text(f"#!{sys.executable}\n" + '''
import json, os, sys
from pathlib import Path
with (Path(os.environ["MOCK_ROOT"]) / "signatures.jsonl").open("a") as output:
    output.write(json.dumps(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("MOCK_COSIGN_EXIT", "0")))
''')
        cosign.chmod(0o755)
        source = RUNNER.read_text()
        # Source the production functions and EXIT/INT/TERM traps, before the
        # main path can transfer files or modify a release. Only the RAM source
        # and sampling interval are substituted for fast, deterministic tests.
        prefix, marker, _ = source.partition('\nmkdir -p "$BACKUP_DIR"')
        self.assertTrue(marker, "Runner setup boundary changed")
        self.prefix = prefix.replace("/proc/meminfo", str(self.root / "meminfo"))
        self.prefix = self.prefix.replace("sleep 2", "sleep 0.02")

    def memory(self, mb):
        (self.root / "meminfo").write_text(f"MemAvailable: {mb * 1024} kB\n")

    def events(self):
        path = self.root / "events.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def run_guard(self, body='build_with_memory_guard "$REPO_DIR" backend', **env):
        return subprocess.run(
            ["bash", "-c", self.prefix + "\n" + body],
            env={**self.env, **env}, text=True, capture_output=True, timeout=15,
        )

    def assert_running(self, expected=None):
        actual = json.loads((self.root / "state.json").read_text())
        self.assertEqual(actual, expected or dict.fromkeys(OCR, True))

    def test_available_memory_leaves_ocr_running(self):
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), [["build", "backend"], ["build-ended"]])
        self.assert_running()

    def valid_pins(self):
        names = {
            "GMED_BACKEND_IMAGE": "server", "GMED_FRONTEND_IMAGE": "frontend",
            "GMED_PARSER_IMAGE": "clinical-document-parser", "GMED_INVOICE_PARSER_IMAGE": "invoice-parser",
        }
        return "\n".join(f"{key}=ghcr.io/oleksandrmelnychenko/gmed-crm-{name}@sha256:{'a' * 64}"
                         for key, name in names.items()) + "\n"

    def verify_pins(self, content, **env):
        (self.root / "images.pins").write_text(content)
        return self.run_guard('verify_dev_image_pins "$MOCK_ROOT/images.pins"', **env)

    def test_registry_mode_verifies_all_four_dev_signatures(self):
        result = self.verify_pins(self.valid_pins())
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in (self.root / "signatures.jsonl").read_text().splitlines()]
        self.assertEqual(len(calls), 4)
        for call in calls:
            self.assertIn("https://github.com/oleksandrmelnychenko/gmed-crm/.github/workflows/dev.yml@refs/heads/main", call)
        self.assertEqual(self.events(), [], "Pin verification must not change containers")

    def test_registry_mode_rejects_missing_duplicate_or_unpinned_images(self):
        valid = self.valid_pins()
        for invalid in ["", "\n".join(valid.splitlines()[:3]), valid + valid.splitlines()[0],
                        valid.replace("@sha256:" + "a" * 64, ":latest"),
                        valid.replace("gmed-crm-server", "unrelated-server")]:
            with self.subTest(pins=invalid):
                self.assertNotEqual(self.verify_pins(invalid).returncode, 0)
        self.assertFalse((self.root / "signatures.jsonl").exists())
        self.assertEqual(self.events(), [])

    def test_registry_mode_stops_when_signature_verification_fails(self):
        result = self.verify_pins(self.valid_pins(), MOCK_COSIGN_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), [])

    def test_low_memory_stops_ocr_and_restores_it_after_success(self):
        self.memory(4000)
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events()[:2], [["stop", container] for container in OCR])
        self.assertEqual(self.events()[-2:], [["start", container] for container in OCR])
        self.assert_running()

    def test_build_failure_restores_ocr_and_preserves_exit_code(self):
        self.memory(4000)
        result = self.run_guard(MOCK_BUILD_EXIT="37")
        self.assertEqual(result.returncode, 37, result.stderr)
        self.assert_running()

    def test_partial_stop_failure_is_recovered(self):
        self.memory(4000)
        result = self.run_guard(MOCK_STOP_FAIL=OCR[0])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), [["stop", OCR[0]], ["start", OCR[0]]])
        self.assert_running()

    def test_inspect_failure_after_stopping_one_worker_restores_it(self):
        self.memory(4000)
        result = self.run_guard(MOCK_INSPECT_FAIL=OCR[1])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), [["stop", OCR[0]], ["start", OCR[0]]])
        self.assert_running()

    def test_already_stopped_service_is_not_started_on_build_failure(self):
        self.memory(4000)
        expected = {OCR[0]: True, OCR[1]: False}
        (self.root / "state.json").write_text(json.dumps(expected))
        result = self.run_guard(MOCK_BUILD_EXIT="37")
        self.assertEqual(result.returncode, 37)
        self.assert_running(expected)
        self.assertNotIn(["start", OCR[1]], self.events())

    def test_memory_drop_pauses_workers_during_a_build(self):
        result = self.run_guard(MOCK_DROP_MB="1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events()[0], ["build", "backend"])
        self.assertIn(["stop", OCR[0]], self.events())
        self.assert_running()

    def test_critical_memory_cancels_build_children_before_restoring_workers(self):
        self.memory(4000)
        result = self.run_guard(MOCK_DROP_MB="100", MOCK_LONG_BUILD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cancelling the build", result.stderr)
        events = self.events()
        self.assertIn(["build-stopped"], events)
        self.assertNotIn(["orphaned-build-child"], events)
        self.assertLess(events.index(["build-stopped"]), events.index(["start", OCR[0]]))
        self.assert_running()

    def test_not_enough_memory_cancels_before_launching_a_build(self):
        self.memory(100)
        result = self.run_guard(MOCK_RECOVER_MB="200")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(["build", "backend"], self.events())
        self.assert_running()

    def test_missing_memory_information_fails_without_stopping_workers(self):
        (self.root / "meminfo").write_text("MemTotal: 8000000 kB\n")
        result = self.run_guard()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events(), [])
        self.assert_running()

    def test_restore_failure_cannot_report_success(self):
        self.memory(4000)
        result = self.run_guard(MOCK_START_FAIL=OCR[0])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not be restored", result.stderr)
        self.assertIn(["start", OCR[1]], self.events())

    def test_rollback_does_not_restart_already_recovered_workers(self):
        self.memory(4000)
        backup = self.root / "backup"
        backup.mkdir()
        (backup / "old-release").touch()
        (self.repo / "new-release").touch()
        result = self.run_guard('''
build_with_memory_guard "$REPO_DIR" backend
BACKUP_PATH="$MOCK_ROOT/backup"
ROLLBACK_OVERRIDE="$MOCK_ROOT/rollback.yml"
SWAPPED=1
exit 9
''')
        self.assertEqual(result.returncode, 9, result.stderr)
        self.assertTrue((self.repo / "old-release").exists())
        self.assertIn(["rollback-up"], self.events())
        self.assertFalse(any(event[0] == "start" for event in self.events()))
        self.assert_running()

    def test_termination_restores_workers_and_stops_the_build_group(self):
        self.check_signal_recovery(signal.SIGTERM)

    def test_ssh_hangup_restores_workers_and_stops_the_build_group(self):
        self.check_signal_recovery(signal.SIGHUP)

    def check_signal_recovery(self, stop_signal):
        self.memory(4000)
        process = subprocess.Popen(
            ["bash", "-c", self.prefix + '\nbuild_with_memory_guard "$REPO_DIR" backend'],
            env={**self.env, "MOCK_LONG_BUILD": "1"},
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            deadline = time.monotonic() + 10
            while not (self.root / "building").exists():
                self.assertIsNone(process.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            process.send_signal(stop_signal)
            _, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 128 + stop_signal, stderr)
            self.assertIn(["build-stopped"], self.events())
            self.assertNotIn(["orphaned-build-child"], self.events())
            self.assert_running()
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


if __name__ == "__main__":
    unittest.main()
