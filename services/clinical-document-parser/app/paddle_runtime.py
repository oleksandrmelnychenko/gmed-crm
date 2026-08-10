from __future__ import annotations

import atexit
from collections.abc import Callable
from dataclasses import dataclass
from multiprocessing import get_context
from multiprocessing.connection import Connection
import threading
import time
from typing import Any


@dataclass(frozen=True, slots=True)
class PaddleRuntimeOptions:
    detection_model: str
    recognition_model: str
    detection_side_length: int
    cpu_threads: int


def _as_plain_value(value: object) -> object:
    to_list = getattr(value, "tolist", None)
    if callable(to_list):
        value = to_list()
    if isinstance(value, dict):
        return {str(key): _as_plain_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_as_plain_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _result_payload(result: object) -> dict[str, object]:
    value: object = result if isinstance(result, dict) else getattr(result, "json", {})
    if callable(value):
        value = value()
    if not isinstance(value, dict):
        return {}
    nested = value.get("res", value)
    if not isinstance(nested, dict):
        return {}
    return {
        key: _as_plain_value(nested.get(key))
        for key in ("rec_texts", "rec_scores", "rec_boxes", "rec_polys")
        if key in nested
    }


def _worker(connection: Connection, options: PaddleRuntimeOptions) -> None:
    try:
        from paddleocr import PaddleOCR

        pipeline = PaddleOCR(
            text_detection_model_name=options.detection_model,
            text_recognition_model_name=options.recognition_model,
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_textline_orientation=True,
            text_det_limit_side_len=options.detection_side_length,
            text_det_limit_type="max",
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=max(1, options.cpu_threads),
        )
        connection.send(("ready", None))
        while True:
            request = connection.recv()
            if request is None:
                return
            try:
                results = pipeline.predict(
                    request,
                    text_det_limit_side_len=options.detection_side_length,
                    text_det_limit_type="max",
                )
                connection.send(("ok", [_result_payload(result) for result in results]))
            except BaseException as exc:
                # Return only the exception class. Messages may contain local paths
                # or OCR library diagnostics derived from document content.
                connection.send(("error", type(exc).__name__))
    except BaseException as exc:
        try:
            connection.send(("startup_error", type(exc).__name__))
        except BaseException:
            pass
    finally:
        connection.close()


class PaddleProcessRuntime:
    """Single local Paddle process that can be terminated after a hard timeout."""

    def __init__(
        self,
        options: PaddleRuntimeOptions,
        *,
        worker_target: Callable[[Connection, PaddleRuntimeOptions], None] = _worker,
        failure_threshold: int = 2,
        cooldown_seconds: float = 60.0,
    ) -> None:
        self._options = options
        self._worker_target = worker_target
        self._failure_threshold = max(1, failure_threshold)
        self._cooldown_seconds = max(1.0, cooldown_seconds)
        self._consecutive_failures = 0
        self._disabled_until = 0.0
        self._lock = threading.Lock()
        self._process: Any | None = None
        self._connection: Connection | None = None
        atexit.register(self.close)

    def predict(self, image: object, timeout: float) -> list[dict[str, object]]:
        if timeout <= 0:
            raise TimeoutError("Paddle OCR deadline exhausted")
        with self._lock:
            now = time.monotonic()
            if self._disabled_until > now:
                raise RuntimeError("Paddle OCR circuit breaker is open")
            if self._disabled_until:
                self._disabled_until = 0.0
                self._consecutive_failures = 0
            try:
                result = self._predict_locked(image, timeout)
            except Exception:
                self._record_failure()
                raise
            self._consecutive_failures = 0
            return result

    def _predict_locked(
        self, image: object, timeout: float
    ) -> list[dict[str, object]]:
        deadline = time.monotonic() + timeout
        self._ensure_started(max(0.0, deadline - time.monotonic()))
        assert self._connection is not None
        connection = self._connection
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            self._stop()
            raise TimeoutError("Paddle OCR request send timed out")
        send_complete = threading.Event()
        send_errors: list[BaseException] = []

        def send_request() -> None:
            try:
                connection.send(image)
            except BaseException as exc:
                send_errors.append(exc)
            finally:
                send_complete.set()

        sender = threading.Thread(
            target=send_request,
            name="gmed-paddle-ocr-send",
            daemon=True,
        )
        sender.start()
        if not send_complete.wait(remaining):
            self._stop()
            sender.join(timeout=0.5)
            raise TimeoutError("Paddle OCR request send timed out")
        if send_errors:
            self._stop()
            raise RuntimeError("Paddle OCR worker is unavailable") from send_errors[0]
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not self._connection.poll(remaining):
            self._stop()
            raise TimeoutError("Paddle OCR inference timed out")
        try:
            status, payload = self._connection.recv()
        except (EOFError, OSError) as exc:
            self._stop()
            raise RuntimeError("Paddle OCR worker stopped unexpectedly") from exc
        if status != "ok":
            raise RuntimeError(f"Paddle OCR worker failed ({payload})")
        return payload if isinstance(payload, list) else []

    def _record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._failure_threshold:
            self._disabled_until = time.monotonic() + self._cooldown_seconds
            self._stop()

    def _ensure_started(self, timeout: float) -> None:
        if self._process is not None and self._process.is_alive():
            return
        self._stop()
        context = get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=self._worker_target,
            args=(child, self._options),
            name="gmed-paddle-ocr",
            daemon=True,
        )
        process.start()
        child.close()
        self._process = process
        self._connection = parent
        if not parent.poll(timeout):
            self._stop()
            raise TimeoutError("Paddle OCR startup timed out")
        try:
            status, payload = parent.recv()
        except (EOFError, OSError) as exc:
            self._stop()
            raise RuntimeError("Paddle OCR worker stopped during startup") from exc
        if status != "ready":
            self._stop()
            raise RuntimeError(f"Paddle OCR startup failed ({payload})")

    def close(self) -> None:
        with self._lock:
            self._stop()

    def _stop(self) -> None:
        connection = self._connection
        process = self._process
        self._connection = None
        self._process = None
        if connection is not None:
            connection.close()
        if process is not None:
            process.join(timeout=0.5)
            if process.is_alive():
                process.terminate()
                process.join(timeout=2)
            if process.is_alive():
                kill = getattr(process, "kill", None)
                if callable(kill):
                    kill()
                    process.join(timeout=2)
            close = getattr(process, "close", None)
            if not process.is_alive() and callable(close):
                close()
