# DE↔UK / DE↔RU parallel datasets (GMed Console)

Updated: 2026-09-25 (Europe/Kiev).

**Scope:** open-license bitext for German↔Ukrainian and German↔Russian document MT.
**Safety:** Does **not** overwrite production Argos EN→DE. Does **not** touch `training/en-de/` or its Docker train. Parallel track only.

`UK` / `uk` = Ukrainian (not United Kingdom).

Converted CSV schema (ELRC-style):

```
id,lang,source_text,target_text
```

`lang` = `de-uk` or `de-ru`; `source_text` = German; `target_text` = Ukrainian/Russian.
Bidirectional training = same bitext, columns swapped (`de2xx/` and `xx2de/`).

---

## 1) Existing `medical-verified-2026-09-24` inventory

| File | Rows | Pair | Use for this track |
| --- | ---: | --- | --- |
| `Orphadata-rare-diseases-de-uk.tsv` | 11 023 | DE–UK | Terminology (rare-disease names). CSV also under `datasets/de-uk/csv/`. **0 kept** in sentence prepare (`min_words≥2` + short names). Keep as glossary. **CC BY 4.0** |
| `RefugeePhrasebook-medical-de-uk.tsv` | 136 | DE–UK | Tiny patient phrases; **noisy**. Included. **CC0** |
| `RefugeePhrasebook-medical-de-ru.tsv` | 135 | DE–RU | Same. Included. **CC0** |
| `RefugeePhrasebook-medical-uk-ru.tsv` | 135 | UK–RU | Not used (no German) |
| `DiagnosticInterview-medical-uk-ru.tsv` | 11 076 | UK–RU | Not used (no German) |
| `sources/MeSpEn-German-Russian-raw.tsv` | ~229 | DE–RU | Broken/inconsistent glossary — **not** merged |

EN–DE corpora (EMEA, ECDC, ELRC-Medical-V2) left untouched (wrong pair).

---

## 2) Downloaded OPUS / ELRC (Windows)

| Path | Content |
| --- | --- |
| `datasets/de-uk/raw/` · `datasets/de-ru/raw/` | Moses `.zip` |
| `datasets/*/extracted/` | Unzipped Moses |
| `datasets/*/csv/` | `id,lang,source_text,target_text` CSVs |
| `datasets/DATASETS-de-uk-ru.md` | This file |
| `datasets/download_opus_deuruk.ps1` | Download helper |
| `datasets/convert_opus_moses.py` | Moses→CSV (+ medical TSV) |

### DE–UK corpora in `datasets/de-uk/csv/`

| File | ~Pairs | Domain | License | Notes |
| --- | ---: | --- | --- | --- |
| `ELRC-5179-acts_Ukrainian-de-uk.csv` | 129 623 | EU/UA legislation | ELRC **CC BY-SA 4.0** (often redistributed CC BY) | Best document-domain DE–UK |
| `ELRC-5191-Auslandsgesellschaft-de-uk.csv` | 1 987 | NGO/civic | ELRC open | Small |
| `ELRC-wikipedia_health-de-uk.csv` | 230 | Health wiki | ELRC open | Tiny medical |
| `EUbookshop-de-uk.csv` | 1 627 | EU pubs | EU open reuse | Small |
| `WikiMatrix-de-uk.csv` | 165 076 | Wikipedia | **CC BY-SA** | Medium noise |
| `wikimedia-de-uk.csv` | 74 402 | Wikimedia | CC BY-SA | |
| `Tatoeba-de-uk.csv` | 23 868 | General | **CC BY 2.0** | Short/clean |
| `QED-de-uk.csv` | 132 659 | Edu video | Mixed crawl — **research-leaning** | Subtitle-ish |
| `RefugeePhrasebook-medical-de-uk.csv` | 136 | Clinical phrases | **CC0** | Noisy |
| `Orphadata-rare-diseases-de-uk.csv` | 11 023 | Disease names | **CC BY 4.0** | Terminology; not in sentence merge |
| `TED2020-de-uk.csv` | 163 012 | Talks | Typical TED **CC BY-NC-ND** | **NC track only** |

### DE–RU corpora in `datasets/de-ru/csv/`

| File | ~Pairs | Domain | License | Notes |
| --- | ---: | --- | --- | --- |
| `MultiUN-de-ru.csv` | 164 792 | UN docs | UN / OPUS | Strong document domain |
| `News-Commentary-de-ru.csv` | 220 336 | News | WMT stack — confirm commercial before product | High quality |
| `WikiMatrix-de-ru.csv` | 368 206 | Wikipedia | CC BY-SA | |
| `wikimedia-de-ru.csv` | 28 084 | Wikimedia | CC BY-SA | |
| `Tatoeba-de-ru.csv` | 150 463 | General | CC BY 2.0 | |
| `QED-de-ru.csv` | 339 259 | Edu video | Mixed — research-leaning | |
| `EUbookshop-de-ru.csv` | 8 987 | EU pubs | EU open | |
| `GlobalVoices-de-ru.csv` | 22 220 | News/civic | Typically CC | |
| `TildeMODEL-de-ru.csv` | 9 493 | Mixed TM | Check Tilde terms | |
| `WMT-News-de-ru.csv` | 6 003 | News | WMT | |
| `ELRC-wikipedia_health-de-ru.csv` | 320 | Health | ELRC open | Tiny medical |
| `ELRC-5067-SciPar-de-ru.csv` | 198 | Scientific | ELRC open | Tiny |
| `RefugeePhrasebook-medical-de-ru.csv` | 135 | Clinical phrases | CC0 | Noisy |
| `TED2020-de-ru.csv` | 290 024 | Talks | TED **NC** | NC track only |

### Not downloaded (deferred)

| Corpus | Why |
| --- | --- |
| CCMatrix / NLLB de-uk (~7.5M) / de-ru (~46M) | Huge + web-mined noise |
| MultiParaCrawl | Noisy crawl |
| OpenSubtitles | Subtitle ≠ clinical docs |
| Europarl | No Ukrainian; DE–RU available later if needed |

**FLORES-200:** eval only — not downloaded yet (do not train on it).

---

## 3) Prepared training paths

Scripts: `training/de-uk/scripts/prepare_bidirectional.py`, `training/de-ru/scripts/prepare_bidirectional.py`

Filters: `min_chars=8`, `max_chars=800`, `min_words=2`, `max_ratio=2.5`, `seed=42`, ~5% valid / ~5% test.

### Commercial merge (TED excluded) — **preferred**

| Direction | Train | Valid | Test | Total kept | Path |
| --- | ---: | ---: | ---: | ---: | --- |
| **DE→UK** | 448 098 | 24 894 | 24 894 | **497 886** | `training/de-uk/out/merged-commercial/de2uk/` |
| **UK→DE** | 448 098 | 24 894 | 24 894 | same | `training/de-uk/out/merged-commercial/uk2de/` |
| **DE→RU** | 1 103 031 | 61 279 | 61 279 | **1 225 589** | `training/de-ru/out/merged-commercial/de2ru/` |
| **RU→DE** | 1 103 031 | 61 279 | 61 279 | same | `training/de-ru/out/merged-commercial/ru2de/` |

Reports: `.../out/merged-commercial/prepare_report.json`

### NC track (includes TED2020) — research / non-commercial risk

| Direction | Train | Valid | Test | Total | Path |
| --- | ---: | ---: | ---: | ---: | --- |
| DE↔UK +TED | 543 319 | 30 184 | 30 184 | **603 687** | `training/de-uk/out/merged-with-ted-nc/` |
| DE↔RU +TED | 1 256 651 | 69 813 | 69 813 | **1 396 277** | `training/de-ru/out/merged-with-ted-nc/` |

Each direction dir: `train.{src,tgt}`, `valid.*`, `test.*`.

---

## 4) Quality caveats

- **Medical DE–UK / DE–RU still tiny:** Orphadata terms + ~200–320 health-wiki + noisy phrasebook ≪ clinical documents.
- WikiMatrix / QED / wikimedia: alignment noise; filters help only partially.
- Refugee Phrasebook: known errors — not clinically validated.
- Orphadata: names, not sentences — glossary later, not sentence MT.
- News-Commentary (DE–RU): confirm commercial rights before paid product.
- QED: optional drop for stricter commercial filter.

---

## 5) Gaps & recommended next step

**Gaps**
1. Almost no **clinical document** DE–UK / DE–RU bitext (EMEA/ECDC are EN–DE).
2. No FLORES / clinical held-out eval prepared.
3. Large filtered crawls not pulled.
4. More UA government / ELRC legal packs beyond 5179 not exhausted.

**Recommended next step**
1. **More medical/document DE–UK data** before any GPU train (domain gap is critical).
2. DE–RU ~1.2M commercial pairs is enough for a **general-domain** baseline; still weak clinically.
3. When user asks to train: use `merged-commercial` only; build **new** Argos/CT2 packages (`de_uk`, `uk_de`, `de_ru`, `ru_de`) + parser pair wiring — separate from EN→DE production.
4. Do **not** start GPU train for these pairs until user asks.

---

## 6) Parent note (product)

GMed production today = **EN→DE Argos only**. Adding DE↔UK/RU needs new Argos/CT2 packages and parser language-pair code (separate product work). Data + prepare skeleton only are ready.

## Citations

Tiedemann 2012 (OPUS); ELRC-SHARE; Orphadata/Orphanet © INSERM; Refugee Phrasebook CC0; WikiMatrix; QED; TED2020 via OPUS (NC).
