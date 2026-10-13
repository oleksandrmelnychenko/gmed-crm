# training/de-uk — German ↔ Ukrainian (skeleton)

Prepared data only. **Do not** start GPU train until user asks.
**Do not** touch `training/en-de/` or production `models/translate-en_de-*`.

## Layout
- `scripts/prepare_bidirectional.py`
- `out/merged-commercial/` — TED excluded (commercial-preferred)
  - `de2uk/{train,valid,test}.{de,uk}` — 448 098 / 24 894 / 24 894
  - `uk2de/{train,valid,test}.{uk,de}` — same counts
- `out/merged-with-ted-nc/` — includes TED2020 (NC)

See `datasets/DATASETS-de-uk-ru.md`.
