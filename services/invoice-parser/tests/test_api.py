import asyncio
import shutil

from fastapi.testclient import TestClient
import pytest

from invoice_parser.api import create_app
from invoice_parser.runner import ParseFailed
from invoice_parser.settings import Settings
from conftest import invoice_png, native_pdf


KEY = "synthetic-test-key-000000000000000000"
HEADERS = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/pdf"}


def test_native_pdf_through_real_worker():
    with TestClient(create_app(Settings(KEY))) as client:
        response = client.post("/v1/parse", content=native_pdf(), headers=HEADERS)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["fields"]["external_invoice_number"] == "DEMO-2026-001"
    assert result["fields"]["amount_gross"] == "119.00"
    assert result["extraction"]["used_ocr"] is False
    assert response.headers["cache-control"] == "no-store"


def test_real_image_ocr_through_worker():
    if not shutil.which("tesseract"):
        pytest.skip("Tesseract is not installed")
    with TestClient(create_app(Settings(KEY))) as client:
        response = client.post("/v1/parse", content=invoice_png(),
                               headers={**HEADERS, "Content-Type": "image/png"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["extraction"]["used_ocr"] is True
    assert result["fields"]["amount_gross"] == "119.00", result["text"]
    assert result["fields"]["external_invoice_number"] == "DEMO-2026-001"


@pytest.mark.parametrize(("headers", "data", "status"), [
    ({"Content-Type": "application/pdf"}, b"%PDF-bad", 401),
    ({**HEADERS, "Content-Type": "text/plain"}, b"invoice", 415),
    (HEADERS, b"not a PDF", 415),
    (HEADERS, b"", 400),
    (HEADERS, b"%PDF-" + b"0" * 100, 413),
])
def test_input_validation(headers, data, status):
    with TestClient(create_app(Settings(KEY, max_file_bytes=100))) as client:
        assert client.post("/v1/parse", content=data, headers=headers).status_code == status


def test_chunked_body_limit():
    with TestClient(create_app(Settings(KEY, max_file_bytes=10))) as client:
        response = client.post("/v1/parse", content=iter([b"%PDF-", b"123456"]), headers=HEADERS)
    assert response.status_code == 413


def test_deadline_cancels_processing_and_releases_slot(monkeypatch):
    cancelled = []
    async def slow_worker(data, mime):
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.append(True)
    monkeypatch.setattr("invoice_parser.api.run_worker", slow_worker)
    app = create_app(Settings(KEY, timeout_seconds=0.02, max_concurrency=1))
    with TestClient(app) as client:
        response = client.post("/v1/parse", content=b"%PDF-test", headers=HEADERS)
        assert response.status_code == 504
        assert not app.state.slots.locked()
    assert cancelled == [True]


def test_busy_worker_rejects_without_unbounded_queue():
    app = create_app(Settings(KEY, max_concurrency=1))
    with TestClient(app) as client:
        client.portal.call(app.state.slots.acquire)
        response = client.post("/v1/parse", content=b"%PDF-test", headers=HEADERS)
        assert response.status_code == 429
        assert response.headers["retry-after"] == "5"
        app.state.slots.release()


def test_worker_error_is_redacted(monkeypatch):
    async def fail(data, mime):
        raise ParseFailed("PRIVATE INVOICE CONTENT")
    monkeypatch.setattr("invoice_parser.api.run_worker", fail)
    with TestClient(create_app(Settings(KEY))) as client:
        response = client.post("/v1/parse", content=b"%PDF-test", headers=HEADERS)
    assert response.status_code == 422
    assert "PRIVATE" not in response.text


def test_missing_service_key_prevents_startup():
    with pytest.raises(ValueError):
        Settings("")
