from __future__ import annotations

from multiprocessing.connection import Connection
import time
import unittest

from app.paddle_runtime import PaddleProcessRuntime, PaddleRuntimeOptions


def slow_test_worker(
    connection: Connection, _options: PaddleRuntimeOptions
) -> None:
    connection.send(("ready", None))
    connection.recv()
    time.sleep(10)


def failing_startup_worker(
    connection: Connection, _options: PaddleRuntimeOptions
) -> None:
    connection.send(("startup_error", "SyntheticFailure"))
    connection.close()


def never_read_request_worker(
    connection: Connection, _options: PaddleRuntimeOptions
) -> None:
    connection.send(("ready", None))
    time.sleep(10)


class PaddleProcessRuntimeTest(unittest.TestCase):
    def test_timeout_terminates_stuck_inference_process(self) -> None:
        runtime = PaddleProcessRuntime(
            PaddleRuntimeOptions(
                detection_model="test",
                recognition_model="test",
                detection_side_length=1280,
                cpu_threads=1,
            ),
            worker_target=slow_test_worker,
        )
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(TimeoutError, "timed out"):
                runtime.predict({"synthetic": True}, timeout=1.0)
        finally:
            runtime.close()

        self.assertLess(time.monotonic() - started, 4.0)

    def test_repeated_failures_open_circuit_breaker(self) -> None:
        runtime = PaddleProcessRuntime(
            PaddleRuntimeOptions(
                detection_model="test",
                recognition_model="test",
                detection_side_length=1280,
                cpu_threads=1,
            ),
            worker_target=failing_startup_worker,
            failure_threshold=2,
            cooldown_seconds=30,
        )
        try:
            for _ in range(2):
                with self.assertRaisesRegex(RuntimeError, "startup failed"):
                    runtime.predict({"synthetic": True}, timeout=2.0)
            with self.assertRaisesRegex(RuntimeError, "circuit breaker is open"):
                runtime.predict({"synthetic": True}, timeout=2.0)
        finally:
            runtime.close()

    def test_blocked_request_send_respects_deadline(self) -> None:
        runtime = PaddleProcessRuntime(
            PaddleRuntimeOptions(
                detection_model="test",
                recognition_model="test",
                detection_side_length=1280,
                cpu_threads=1,
            ),
            worker_target=never_read_request_worker,
        )
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(TimeoutError, "send timed out"):
                runtime.predict(b"x" * (8 * 1024 * 1024), timeout=0.5)
        finally:
            runtime.close()

        self.assertLess(time.monotonic() - started, 4.0)


if __name__ == "__main__":
    unittest.main()
