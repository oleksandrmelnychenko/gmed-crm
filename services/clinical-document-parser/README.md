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

English clinical headings, diagnosis assertions (including suspected, negated,
rule-out and historical statements), labelled subject identity and medication
tables are supported. English candidates remain unselected for explicit review.
Ambiguous US/UK slash dates are never guessed.

English imports also receive a separate German machine-translation draft. The
original text, page boundaries, candidate evidence and clinical assertions remain
unchanged. Reviewers can adopt and edit narrative wording in the import sheet;
doing so clears selection and still requires confirmation. Structured medication,
laboratory and vital-sign fields are never overwritten by translation. Changed
numbers and missing supported clinical qualifiers are flagged, and the affected
candidate translation cannot be adopted. These checks do not validate medical
meaning. Paragraphs are translated sentence by sentence to avoid silently
dropping later sentences.

Wrapped English report lines are joined before sentence translation, while
diagnosis rows, headings, table cells and page boundaries stay distinct.
`Report Summary`, `Medical Summary`, and `Thyroid Sonography` are recognized.
Long diagnosis lists retain individual assertions, including exclusions and
historical conditions. Native PDF layout extraction falls back to the complete
plain text stream if layout spacing changes numeric tokens. Unambiguous decimal
dot-to-comma localization and English comma-grouped thousands localized to
German dot groups are restored to the source spelling. Source dot groups with
three fractional digits remain ambiguous; changed digits, signs and ordering
are never repaired. Numeric ranges such as `40–80` and `40-80` are equivalent,
while standalone signed measurements retain their sign.
Missing or added supported negations, and missing laterality or historical
qualifiers, block adoption of the affected candidate translation.
An omitted qualifier permits one bounded retry with shorter comma/semicolon
clauses. The retry is accepted only when the original sentence's numbers and
supported qualifiers are preserved. `Euthyreose` is recognized alongside
adjectival German renderings of `euthyroid`.

Wrapped vital measurements keep an immediately following unit on the same
page and within the same paragraph. English `pulse` / `pulse rate` is extracted
as heart rate. A report without a measurement date still requires the reviewer
to supply that date; dates of earlier diagnoses are not reused for current vitals.

A small reviewed glossary repairs supported phrases that the model leaves in
English and specific documented terminology errors. Each repair requires both
the matching source phrase and its exact untranslated/incorrect target phrase;
it cannot invent an absent procedure. Colon segments and solitary findings are
also checked. This glossary is not a replacement for clinical review.

English prose keeps paragraph context and joins wrapped diagnosis sentences.
`Summary`, `Laboratory`, `Conclusion`, and `Therapy recommendations` terminate
the preceding section. Normal/improved findings remain findings. Prose therapy
recommendations retain alternatives and titration instructions as recommendations;
they do not synthesize an active medication schedule. Historical and target
laboratory values in this prose remain in context rather than becoming current
measurements. Letter signatures, repeated page headings and pharmacy legends
are excluded from the clinical candidates while the source text is retained.
This general-purpose model is not clinically validated: terminology, negations,
names, dosages and dates must be checked against the original.

Translation runs offline with the [Argos English–German 1.3 model](https://github.com/argosopentech/argospm-index)
using CTranslate2 and SentencePiece. The Docker image downloads and verifies the
pinned model archive during its build and tests inference. Runtime translation
does not download models or call an external provider. For local development:

```bash
uv sync --extra dev --extra translation
uv run python -m app.install_translation_model
```

Set `PARSER_TRANSLATION_MODEL_DIR` to use the installed model directory elsewhere.
If the model download host is unavailable, supply an existing archive during the
Docker build with `--secret id=translation_model_archive,src=/path/to/translate-en_de-1_3.argosmodel`.
The build verifies the same pinned SHA-256 checksum before extracting it and
still runs the inference check. The archive is a build input; no model download
is needed at runtime.

The default is `models/translate-en_de-1_3` beside this README. Source text plus
candidate text is limited to 60,000 characters per translation, output to 180,000,
and native inference to a killable 120-second child process. Missing models,
timeouts, invalid output and oversized inputs leave recognition available and
show the translation state in the import sheet. Retry by rescanning the document
after restoring translation. Existing imports retain their original snapshots;
rescan to create an English/German review with the new parser.

Administrative cost estimates are identified before clinical section parsing
and deliberately produce no clinical candidates. Narrative candidate text also
repairs only a narrow allowlist of deterministic native-PDF kerning splits;
unknown word boundaries remain unchanged for reviewer visibility.

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
analyte/date cell, retaining the original value, normalized numeric value,
comparator, unit, reference range, date, page, and abnormal marker for human
review and longitudinal storage. Both vertical one-result tables and wide
longitudinal tables with several date columns are supported. Narrative
admission/discharge laboratory blocks inherit the matching encounter boundary
date. Text results such as `neg.` remain textual and are compared with textual
references rather than being coerced into numbers.
Vertical German OCR tables may use either
`Parameter/Ergebnis/Einheit/Referenzbereich` or
`Bezeichnung/Wert/Einheit/Normbereich`. Repeated letterheads and unrelated
sidebar cells are excluded from clinical values while the unmodified OCR text
remains available to the reviewer.

Ruled laboratory histories with `Testbezeichnung / Toleranz / Einheit` and
several date columns use a dedicated local Tesseract layout route. Repeated
vertical rules define the cells, including leading, internal and trailing
empty results. Continuation pages may omit the date header. Table cleanup
preserves dense explanatory legends instead of treating their text as a rule.
`ab` and `bis` reference limits are recognized. Prefix high/low markers are
interpreted only when the document explicitly explains them in its legend.
The API-compatible `result_text` contains the measurement; `source_result_text`,
`source_abnormal_marker`, `source_unit`, and exact row evidence retain the
original OCR. Unknown units, ambiguous dates/column counts, unreadable results
and marker/reference conflicts require review. Identical measurements on
different dates remain separate observations.
Ambiguous unit glyphs may receive a bounded cell-image re-read at two scales.
It changes only narrowly matched glyph families and retains conservative OCR
confidence; valid units, result/date cells and missing prefixes are not inferred.
Recognized ASCII micro-prefixes are normalized to `µ`. A small explicit analyte
alias list normalizes known glyph confusions such as `HbAlc`; the original label
remains in `source_analyte_name`. Values such as a printed `kA` and contradictions
already present in the source retain their review gates.
Document-subject evidence is extracted only from anchored identity labels or a
supported letter salutation. Generic `Patienten-ID`/`Patienten-Nr.` values are
marked with the `source_document` namespace: they belong to the issuing clinic
and must never be hard-compared with GMed's internal patient ID. Missing,
conflicting, or non-comparable identity evidence remains review-gated.
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
Common discharge tables (`Medikation bei Entlassung`, `Empfohlene Medikation`)
preserve wrapped trade names, remarks, compound strengths, routes, and finite
course end dates. Template disclaimers and following laboratory rows terminate
the medication table. A frequency without a time slot such as `1x täglich` is
kept as an instruction and requires review instead of being guessed as a
morning dose.
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
