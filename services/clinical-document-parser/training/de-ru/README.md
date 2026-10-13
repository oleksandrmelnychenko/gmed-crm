# training/de-ru — German ↔ Russian (skeleton)

Prepared data only. **Do not** start GPU train until user asks.
**Do not** touch `training/en-de/` or production Argos EN→DE.

## Layout
- `scripts/prepare_bidirectional.py`
- `out/merged-commercial/` — TED excluded
  - `de2ru/{train,valid,test}.{de,ru}` — 1 103 031 / 61 279 / 61 279
  - `ru2de/{train,valid,test}.{ru,de}` — same counts
- `out/merged-with-ted-nc/` — includes TED2020 (NC)

See `datasets/DATASETS-de-uk-ru.md`.
