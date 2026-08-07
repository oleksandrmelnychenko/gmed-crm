# GMED clinical document parser

This service never writes diagnoses, medications, examinations, or anamnesis
directly. It claims `clinical_document_imports` jobs, performs OCR and
rule-based structure extraction, and stores a review draft. The Rust API owns
authorization, audit, human confirmation, and clinical persistence.

## Run the API locally

```bash
uv sync --extra dev
uv run uvicorn app.api:app --host 127.0.0.1 --port 8090
```

## Run the queue worker

Set `DATABASE_URL` and `GMED_UPLOAD_DIR`, then:

```bash
uv run python -m app.worker
```

The rules in `rules/` are intentionally data-driven. New clinic layouts should
normally add aliases and extraction hints instead of creating a clinic-specific
code path.

The first supported German profiles are cardiology letters, oncology reports,
and radiology reports. Native text is preserved page-by-page; only weak or
image-only pages are rendered. Production uses the bundled PaddleOCR mobile
models for Latin text and falls back to local Tesseract for failures and
Cyrillic pages. Set `PARSER_OCR_ENGINE=tesseract` to disable PaddleOCR. No
document content leaves the host.

Drafts include page-level extraction provenance, OCR confidence and block
geometry without duplicating recognized text. Candidate confidence is a
review-prioritization signal, not a probability that a clinical statement is
true. Suspected, negated, rule-out and low-confidence statements are left
unselected until a user confirms them. Every result remains subject to human
review.

Production limits are configurable with `PARSER_MAX_FILE_BYTES`,
`PARSER_MAX_PDF_PAGES`, `PARSER_MAX_IMAGE_PIXELS`,
`PARSER_MAX_EXTRACTED_TEXT_CHARS`, `PARSER_MAX_DRAFT_CANDIDATES`,
`PARSER_MAX_SOURCE_EVIDENCE_CHARS`, `PARSER_MAX_SERIALIZED_DRAFT_BYTES`, and
`PARSER_LEASE_SECONDS`. OCR timeouts and CPU use are controlled with
`PARSER_OCR_PAGE_TIMEOUT_SECONDS`, `PARSER_OCR_DOCUMENT_TIMEOUT_SECONDS`, and
`PARSER_PADDLE_CPU_THREADS`.
