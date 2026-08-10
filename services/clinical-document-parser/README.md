# GMED clinical document parser

This service never writes diagnoses, medications, examinations, laboratory
observations, or anamnesis directly. It claims `clinical_document_imports` jobs, performs OCR and
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

Paddle inference runs in a persistent local child process by default. A page
deadline terminates and recreates that process, so a stuck native inference
call cannot hold the queue worker indefinitely. Set
`PARSER_PADDLE_ISOLATE_PROCESS=false` only for local diagnostics. Weak first
passes may use one additional Otsu-binarized image within the same page
deadline; disable this bounded retry with `PARSER_OCR_MULTIPASS=false`.
After repeated Paddle startup/inference failures, a local circuit breaker sends
subsequent pages directly to Tesseract for a cooldown period. Tune it with
`PARSER_PADDLE_FAILURE_THRESHOLD` and `PARSER_PADDLE_COOLDOWN_SECONDS`.

Drafts include page-level extraction provenance, OCR confidence and block
geometry without duplicating recognized text. Candidate confidence is a
review-prioritization signal, not a probability that a clinical statement is
true. Suspected, negated, rule-out and low-confidence statements are left
unselected until a user confirms them. Every result remains subject to human
review.

Paddle block coordinates are scaled back from the model's 1280-pixel input to
the post-orientation/post-deskew OCR image. `orientation_rotation` and
`deskew_angle` describe that coordinate-space transformation. Paddle output is
geometrically ordered and handles the common two-column medical-letter layout.
Repeated aligned numeric cells are treated as a table and kept in row-major
order with tab-separated cells, so laboratory names remain attached to values
and units. Tabular laboratory drafts emit one `lab_result` candidate per
analyte, retaining the original value, unit, reference range, date, page, and
abnormal marker for human review and longitudinal storage.
Medication sections and BMP-like tables emit one structured `medication`
candidate per row. The draft preserves the raw row and extracts explicitly
supported active/trade names, strength, form, route, four-slot dose schedule,
unit, PRN instructions, prescription/intake dates, lifecycle/hold state,
country markers, and ATC/PZN identifiers with field-level confidence and
evidence. A brand-only or ambiguous row never guesses an active ingredient and
is left unselected until a reviewer supplies or confirms it. Paused and stopped
medications also require explicit lifecycle confirmation before persistence.
Likewise, the absence of a pause/stop term never proves that a medication is
active. An implicit `aktiv` value always remains unselected, including in a
structured BMP or a current-medication section. Those contexts are retained as
review evidence only. Automatic selection requires an explicit or semantically
explicit active-status statement in addition to an active ingredient and all
other safety checks.
During draft enrichment, candidate source evidence is matched to these blocks
in memory. Review confidence then uses the matching blocks instead of a noisy
page-wide average; only block numbers and aggregate confidence are persisted.
If matching is ambiguous, the conservative page-level calculation remains in
effect.

If a page or document OCR deadline is exhausted, page rendering fails, OCR
raises, or the PDF readers disagree about page count, that provenance is
retained. The draft receives an incomplete-extraction warning, and every
proposed clinical candidate is left unselected until the user verifies the
source document.

Production limits are configurable with `PARSER_MAX_FILE_BYTES`,
`PARSER_MAX_PDF_PAGES`, `PARSER_MAX_IMAGE_PIXELS`,
`PARSER_MAX_EXTRACTED_TEXT_CHARS`, `PARSER_MAX_DRAFT_CANDIDATES`,
`PARSER_MAX_SOURCE_EVIDENCE_CHARS`, `PARSER_MAX_SERIALIZED_DRAFT_BYTES`, and
`PARSER_LEASE_SECONDS`. OCR timeouts and CPU use are controlled with
`PARSER_OCR_PAGE_TIMEOUT_SECONDS`, `PARSER_OCR_DOCUMENT_TIMEOUT_SECONDS`, and
`PARSER_PADDLE_CPU_THREADS`. Language routing can be tuned with
`PARSER_OCR_PRIMARY_LANGUAGES`, `PARSER_OCR_CYRILLIC_LANGUAGES`,
`PARSER_OCR_UKRAINIAN_LANGUAGES`, and `PARSER_OCR_RUSSIAN_LANGUAGES`.

The worker emits `parser_metric` JSON objects after extraction and candidate
review routing. They contain only duration, counts, engines, route reasons,
block-match coverage, and confidence/timeout counts; they contain no recognized
text, paths, candidate values, or document IDs.

## Test

```bash
python -m pytest -q
python -m unittest benchmarks.test_evaluator -v
```
