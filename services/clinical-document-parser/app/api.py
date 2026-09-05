from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .extraction import extract_text
from .parser import parse_clinical_text
from .translation import with_german_translation


app = FastAPI(title="GMED Clinical Document Parser", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/parse")
async def parse_document(
    file: UploadFile = File(...),
    extracted_text: str | None = Form(default=None),
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty document")
    try:
        text = extract_text(data, file.content_type, extracted_text)
        translated = await run_in_threadpool(with_german_translation, parse_clinical_text(text))
        return translated.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
