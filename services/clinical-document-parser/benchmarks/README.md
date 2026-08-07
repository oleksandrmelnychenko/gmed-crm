# Clinical document parser benchmark

This harness measures OCR and structured extraction quality without copying
clinical text, candidate values, patient identifiers, or document paths into
its report. Per-case report references are ordinal and cannot be joined back to
external identifiers without the separately protected ground truth. Ground
truth remains an external JSON file. Do not commit real
documents, extracted text, or real ground-truth files.

## Metrics

- OCR character and word similarity after Unicode and whitespace normalization.
- Candidate precision, recall, and F1, both micro-averaged and per target.
- Assertion/status accuracy for matched candidates. Common German and English
  values are canonicalized (`bestaetigt` -> `confirmed`, `verdacht` ->
  `suspected`, and so on).
- Section contamination: predictions whose source section is known but does
  not allow the predicted target.
- Unsafe false-positive diagnoses: diagnosis predictions matching an explicit
  per-case denylist of negated, ruled-out, family-only, or otherwise unsafe
  statements.

Candidate matching is one-to-one, target-aware, and fuzzy so line wraps and
minor OCR differences do not create artificial errors. The default threshold
is `0.84` and is recorded in every report.

## Ground truth

Validate files against `schema.json`. A synthetic, non-PHI example lives in
`examples/synthetic_ground_truth.json`. A real external file can point to a PDF
using `document.path`, or benchmark precomputed output using `--predictions`.

Keep real ground truth outside the repository, ideally in an encrypted clinical
evaluation store with access logging. Use opaque random `case_id` values. Even
though reports only use ordinal references, identifiers themselves should not
contain patient names or medical record numbers.

```json
{
  "schema_version": 1,
  "cases": [
    {
      "case_id": "opaque-random-id",
      "document": { "path": "D:/secure/input.pdf", "mime_type": "application/pdf" },
      "reference": {
        "raw_text": "human-corrected text stays only in this external file",
        "candidates": [
          { "target": "diagnosis", "value": "human-reviewed value", "assertion": "confirmed" }
        ]
      },
      "section_rules": [
        { "section": "Diagnosen", "allowed_targets": ["diagnosis"] }
      ],
      "forbidden_diagnoses": [
        { "value": "a negated finding that must not become a diagnosis", "reason": "negated" }
      ]
    }
  ]
}
```

`raw_text`, `candidates`, `section_rules`, and `forbidden_diagnoses` are
optional. At least one OCR or candidate reference must be present per case.
When `candidates` is omitted, predictions are not mislabeled as false positives;
candidate metrics for that case are marked unevaluated. Omitted metrics are
reported as `null` rather than guessed.

## Run

From `services/clinical-document-parser`:

```powershell
python -m benchmarks.run `
  --ground-truth D:\secure\clinical-parser-ground-truth.json `
  --fail-on-unsafe `
  --minimum-candidate-f1 0.90 `
  --minimum-ocr-similarity 0.95 `
  --output D:\secure\reports\parser-metrics.json
```

If `--predictions` is omitted, every case must have `document.path` and the
current extraction/parser pipeline is run locally. To score saved drafts:

```powershell
python -m benchmarks.run `
  --ground-truth D:\secure\clinical-parser-ground-truth.json `
  --predictions D:\secure\parser-predictions.json
```

The process exits with `2` when a configured quality gate fails and `64` for an
invalid configuration. Reports intentionally contain only aggregate/per-case
counts, ratios, and ordinal case references. Never add a debug mode that emits
source or candidate text in CI logs.

## Test

```powershell
python -m unittest benchmarks.test_evaluator -v
```
