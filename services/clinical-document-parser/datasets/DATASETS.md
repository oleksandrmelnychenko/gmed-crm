# EN→DE medical / clinical parallel datasets

Inventory for GMed Console clinical-document-parser EN→DE fine-tuning.
Updated: 2026-09-25 (Europe/Kiev).

## Repository storage

Git contains preparation scripts, inventories, provenance metadata and licenses.
The corpus paths below refer to local downloads and generated files; they are
excluded from Git along with training outputs and model weights. Restore those
assets from their documented sources before running preparation or training.

**Safety:** Do not overwrite `models/translate-en_de-1_3`. Do not wipe
`training/en-de/out/elrc-filtered/`. Docker GPU training by other agents must
not be interrupted.

Schema for converted CSVs (matches ELRC):

```
id,lang,source_text,target_text
```

`lang=en-de`, `source_text` = English, `target_text` = German.

---

## Included (commercial-friendly)

| Name | Path (Windows service root `datasets/` or Mac Downloads) | ~Pairs | Size | License | URL |
| --- | --- | ---: | --- | --- | --- |
| **ELRC-Medical-V2** (already present) | `ELRC-Medical-V2-en-de.csv` | 13 291 | ~4.4 MiB | **CC BY 4.0** | HuggingFace/GitHub qanastek/ELRC-Medical-V2 |
| **EMEA v3** (OPUS, full deduped) | `emea-v3/emea-v3-en-de.csv` | **346 474** | ~71 MiB | EU agency docs via OPUS; reuse under **Commission Decision 2011/833/EU** (commercial + non-commercial) with attribution; cite Tiedemann 2012 | https://object.pouta.csc.fi/OPUS-EMEA/v3/moses/de-en.txt.zip |
| **EMEA medical-keyword subsample** | `emea-v3/emea-v3-en-de.medical-keyword-subsample.csv` | **162 442** (uncapped keyword filter) | ~45 MiB | same as EMEA | (derived) |
| **ECDC-TM** (OPUS Moses EN–DE) | `ecdc-v2016-03-16/ecdc-v2016-03-16-en-de.csv` | **2 394** | ~0.55 MiB | **EU/ECDC** worldwide royalty-free perpetual licence for **commercial and non-commercial** reuse (2011/833/EU). Keep copyright notice; no endorsement. See `LICENSE.txt` + official Terms PDF | https://object.pouta.csc.fi/OPUS-ECDC/v2016-03-16/moses/de-en.txt.zip |

Raw Moses / TMX kept under each folder (`raw/`, `official-tmx/`) for provenance.
EMEA raw OPUS Moses had **1 108 752** aligned lines before exact-pair dedupe → 346 474 unique.

### Recommended first merge (next train round)

Prefer the EMEA **keyword subsample** + ECDC + existing ELRC filtered (not the full 346k on the first domain-adapt pass):

```bat
python training\en-de\scripts\prepare_merge_en_de.py ^
  --inputs ^
    datasets\ELRC-Medical-V2-en-de.csv ^
    datasets\emea-v3\emea-v3-en-de.medical-keyword-subsample.csv ^
    datasets\ecdc-v2016-03-16\ecdc-v2016-03-16-en-de.csv ^
  --out-dir training\en-de\out\merged ^
  --seed 42
```

This writes **only** under `training/en-de/out/merged/` and does **not** delete
`out/elrc-filtered/`.

To include full EMEA later (larger / noisier PDF extraction):

```bat
python training\en-de\scripts\prepare_merge_en_de.py ^
  --inputs ^
    datasets\ELRC-Medical-V2-en-de.csv ^
    datasets\emea-v3\emea-v3-en-de.csv ^
    datasets\ecdc-v2016-03-16\ecdc-v2016-03-16-en-de.csv ^
  --out-dir training\en-de\out\merged-full-emea ^
  --seed 42
```

---

## Skipped / research-only (do not merge into commercial GMed train yet)

| Name | Why skipped | Notes |
| --- | --- | --- |
| **UFAL Medical Corpus / HimL WMT17 train** | Explicit **research / non-commercial** certification required; registration + password gate | https://ufal.mff.cuni.cz/ufal_medical_corpus (~25 GB; includes EMEA+PatTR+MuchMore+…) |
| **HimL test sets** | **CC BY-NC-SA** / Cochrane research-only | https://www.himl.eu/test-sets |
| **PatTR patents** | **CC BY-NC-SA 3.0** | https://www.cl.uni-heidelberg.de/statnlpgroup/pattr/ — medical IPC subset would need NC path |
| **MuchMore Springer abstracts** | License **unknown** on DFKI / BigBio card | https://muchmore.dfki.de/resources1.htm — skip until license clarified |
| **WMT Biomedical Medline EN–DE** | `trainWmt22.zip` is **PMID lists only**; abstracts via Entrez; publisher copyright unclear for commercial MT | https://github.com/biomedical-translation-corpora/corpora |
| **TICO-19** | **CC0** but **no German** in TM matrix | https://tico-19.github.io/ |
| **Scielo** | No DE pair | FR/ES/PT only |
| **WikiMatrix medical filter** | Noisy web crawl; skipped for quality | — |
| **medical-verified-2026-09-24** | Wrong language pairs (DE–UK / UK–RU / DE–RU) | Already on disk; not for this EN→DE model |

---

## Citations

- J. Tiedemann, 2012. Parallel Data, Tools and Interfaces in OPUS. LREC 2012.
- Steinberger et al., 2014. An overview of the European Union's highly multilingual parallel corpora. LRE Journal. (ECDC-TM)
- ELRC / Vassilis Papavassiliou et al. — Bilingual corpus from the Publications Office of the EU on the medical domain v.2 (CC BY 4.0).

## Quality notes

- **EMEA**: PDF→text extraction; tables/multi-column artifacts exist. Deduped CSV still benefits from length/ratio filters in `prepare_merge_en_de.py`.
- **ELRC V2**: labelled medical but has substantial EU/admin off-topic text; keep filtering.
- **ECDC**: small, high-quality professional TM (public health / infectious disease).

---

## Already prepared merge (2026-09-25 ~19:33 Kyiv)

Ran once into `training/en-de/out/merged/` (left `out/elrc-filtered/` untouched):

| Split | Pairs |
| --- | ---: |
| train | 142 650 |
| valid | 7 924 |
| test | 7 924 |
| **kept total** | **158 498** |

Sources kept after length/ratio/dedupe filters: ELRC 12 715 + EMEA-kw 143 715 + ECDC 2 068.
Point OpenNMT `data`/`src`/`tgt` paths at `training/en-de/out/merged/train.en|.de` (etc.) for the next train round — do not start that run from this agent task.



---

## DE↔UK / DE↔RU track

See **[DATASETS-de-uk-ru.md](DATASETS-de-uk-ru.md)** for German↔Ukrainian / German↔Russian corpora, licenses, and prepared train paths. Parallel track; does not replace EN→DE.
