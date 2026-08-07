from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .extraction import extract_text
from .parser import parse_clinical_text


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
        return parse_clinical_text(text).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
