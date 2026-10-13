# EN→DE training path (ELRC Medical V2)

Коротко (UK): сирий ELRC CSV уже лежить у `datasets/`. Ця тека — **побічний** шлях підготовки даних і навчання. Продакшн-модель `models/translate-en_de-1_3` **не чіпаємо**. Torch у Windows `.venv` блокується Application Control — готуйте дані на хості, тренуйте в Docker (GPU RTX 5080).

---

## Status / safety

| Item | Path / note |
| --- | --- |
| Source CSV | `datasets/ELRC-Medical-V2-en-de.csv` (~4.4 MiB, **13 291** data rows, SHA-256 `2acb17fe0ab8f5de148d753cdf311f6512a5d6d1fd3a1f2e8d589b4d2a3f69a3`) |
| License | `datasets/ELRC-Medical-V2-LICENSE` (CC BY 4.0) |
| Production model | `models/translate-en_de-1_3` — **DO NOT overwrite** |
| Hard gate | `app/translation_runtime.py` requires `metadata.json` → `from_code=en`, `to_code=de`, `package_version=1.3` |
| Model dir env | `PARSER_TRANSLATION_MODEL_DIR` already selects the package directory (default = production path) |
| Optional gate relax | `PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL=1` still requires `en`→`de`, but allows any `package_version` (default off = identical production behavior) |
| Torch on host | Blocked by Windows Application Control in `.venv` — use Docker for train |

ELRC-Medical-V2 is labelled “medical” but contains substantial off-topic EU/admin text. Always filter before training. Keyword-ish medical hits in the raw file are only ~850/13k — treat filtered output as a research candidate, not a clinical gold set.

CSV schema:

```
id,lang,source_text,target_text
```

All rows use `lang=en-de`. `source_text` = English, `target_text` = German.

---

## 1) Filter / clean (host Python, no torch)

From `services/clinical-document-parser`:

```bat
python training\en-de\scripts\prepare_elrc_en_de.py
```

Or explicitly:

```bat
python training\en-de\scripts\prepare_elrc_en_de.py ^
  --csv datasets\ELRC-Medical-V2-en-de.csv ^
  --out-dir training\en-de\out\elrc-filtered
```

Outputs under `training/en-de/out/elrc-filtered/`:

- `train.en` / `train.de`, `valid.en` / `valid.de`, `test.en` / `test.de`
- `pairs.tsv` (id, en, de, split)
- `prepare_report.json`

Default filters: drop empty/identical, min 12 chars / 3 words, max 800 chars, length ratio ≤ 2.5, strip `^N` footnote markers, dedupe, 5%/5% valid/test, seed 42.

---

## 2) Train (OpenNMT-py) — prefer Docker

Host `.venv` cannot reliably install/run torch (Application Control). Docker **29.8** is present; GPU is RTX 5080 16GB.

```bat
docker build -f training\en-de\Dockerfile.train -t gmed-en-de-train:local .

docker run --rm -it --gpus all ^
  -v "%CD%:/workspace" -w /workspace gmed-en-de-train:local bash
```

Inside the container:

```bash
onmt_build_vocab -config training/en-de/configs/opennmt_en_de.yaml -n_sample -1
onmt_train -config training/en-de/configs/opennmt_en_de.yaml
```

Checkpoints go to `training/en-de/out/opennmt/` only. The YAML `save_model` path deliberately avoids `models/translate-en_de-1_3`.

**Corpus size warning:** ~10k filtered pairs is small for a from-scratch Transformer. Prefer continued training / domain adaptation of a public EN–DE checkpoint, or merge additional licensed medical bitext, before expecting production-quality DE clinical drafts.

Do **not** start a multi-hour run until CUDA base image tags match the host driver; edit `Dockerfile.train` pins first.

---

## 3) Convert to CTranslate2 (int8)

```bash
ct2-opennmt-py-converter \
  --model_path training/en-de/out/opennmt/model_step_XXXX.pt \
  --output_dir training/en-de/out/packages/translate-en_de-elrc-ct2/model \
  --quantization int8
```

Then assemble a side package (mirror production layout):

```
training/en-de/out/packages/translate-en_de-elrc-ct2/
  metadata.json          # from_code=en, to_code=de, package_version=<your tag>
  sentencepiece.model    # the SPM used at train/infer time
  model/                 # CT2 output (config.json, model.bin, vocab…)
  README.md
```

Example `metadata.json`:

```json
{
  "package_version": "elrc-0.1",
  "from_code": "en",
  "from_name": "English",
  "to_code": "de",
  "to_name": "German",
  "source": "ELRC-Medical-V2 filtered + OpenNMT-py → CT2 int8",
  "notes": "Side package only. Not the production Argos 1.3 model."
}
```

---

## 4) Validate offline

```bat
python training\en-de\scripts\validate_ct2_offline.py ^
  --model-dir training\en-de\out\packages\translate-en_de-elrc-ct2 ^
  --allow-any-version
```

Needs `ctranslate2` + `sentencepiece` (works without torch). For GPU: `--device cuda`.

---

## 5) Optionally point the parser at the side package

Already supported:

```bat
set PARSER_TRANSLATION_MODEL_DIR=C:\Users\oleks\Developer\gmed\services\clinical-document-parser\training\en-de\out\packages\translate-en_de-elrc-ct2
```

Production hard-gate still expects `package_version=1.3`. For a custom package either:

1. Keep default behavior and only swap after you intentionally set version `1.3` in metadata (not recommended — confuses provenance), **or**
2. Set the optional escape hatch (default remains pinned):

```bat
set PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL=1
```

With that flag, runtime still requires `from_code=en` and `to_code=de`, but accepts any `package_version`. Leave the flag unset in production.

Never overwrite `models/translate-en_de-1_3`.

---

## Next-step checklist

1. `python training\en-de\scripts\prepare_elrc_en_de.py` — inspect `prepare_report.json`
2. Spot-check `out/elrc-filtered/train.en|.de` for off-topic leftovers; tighten filters if needed
3. Decide train strategy: domain-adapt an existing EN–DE checkpoint vs from-scratch (latter needs more data)
4. Align `Dockerfile.train` CUDA/torch tags with the RTX 5080 driver; build image
5. Short dry-run (`train_steps` low) → CT2 convert → `validate_ct2_offline.py`
6. Only then consider `PARSER_TRANSLATION_MODEL_DIR` (+ optional `ALLOW_NONPINNED`) for a review-only A/B

## Blockers

- **Torch / Application Control:** host `.venv` cannot install or load torch. Training path assumes Docker GPU.
- **Data quality / size:** ELRC V2 is noisy and small after filtering; not sufficient alone for a production clinical EN→DE model.
- **Production gate:** default runtime rejects non-`1.3` packages; use the documented env flag only for explicit experiments.
