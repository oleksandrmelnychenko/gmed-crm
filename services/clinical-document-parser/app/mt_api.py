"""HTTP API for offline machine-translation drafts.

Run as a separate process from the same image:
``python -m uvicorn app.mt_api:app --host 0.0.0.0 --port 8092``.
Request and response text is medical data and is never logged.
"""
from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .mt_engine import MTEngine, TranslationError, default_engine

logger = logging.getLogger("gmed.mt")

app = FastAPI(title="GMED Offline Translation", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)


class TranslateRequest(BaseModel):
    text: str
    source_language: str | None = None
    target_language: str
    protected: list[str] = Field(default_factory=list)


def get_engine() -> MTEngine:
    return default_engine()


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": {"code": code}})


@app.get("/health")
def health() -> dict[str, str]:
    # Liveness only; loading models here would make health checks slow.
    return {"status": "ok"}


@app.post("/v1/translate")
async def translate(request: TranslateRequest, engine: MTEngine = Depends(get_engine)):
    try:
        result = await run_in_threadpool(
            engine.translate,
            request.text,
            request.source_language,
            request.target_language,
            request.protected,
        )
    except TranslationError as error:
        status = 503 if error.code == "model_unavailable" else 422
        if status == 503:
            logger.error("translation model unavailable: %s", error.args[0] if error.args else "?")
        return _error(status, error.code)
    except Exception as error:  # noqa: BLE001 - never echo text-bearing messages
        logger.error("translation failed: %s", type(error).__name__)
        return _error(500, "translation_failed")
    return {
        "text": result.text,
        "detected_source_language": result.detected_source_language,
        "characters": result.characters,
        "warnings": result.warnings,
    }
