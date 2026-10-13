# Medical translation data: DE–UK, DE–RU, UK–RU

Downloaded and extracted on 2026-09-24. `UK` in filenames means Ukrainian (`uk`), not United Kingdom. The TSV files are UTF-8 with a header. Rows are aligned through the source's phrase ID, French sentence ID, or ORPHAcode; no machine translation was generated here.

| File | Rows | Content | Source and license |
| --- | ---: | --- | --- |
| `RefugeePhrasebook-medical-de-uk.tsv` | 136 | patient-facing phrases | [Refugee Phrasebook medical sheet](https://docs.google.com/spreadsheets/d/1IKkQP45HuCochP7RsAZYo6yT8ZVfYrJwukk4-uYjzzc/edit?usp=sharing), [CC0 project terms](https://refugeephrasebook.de/about/) |
| `RefugeePhrasebook-medical-de-ru.tsv` | 135 | patient-facing phrases | same as above |
| `RefugeePhrasebook-medical-uk-ru.tsv` | 135 | patient-facing phrases | same as above |
| `DiagnosticInterview-medical-uk-ru.tsv` | 11,076 | clinician–patient questions/instructions; Ukrainian and Russian independently translated from the same French original | [University of Geneva dataset](https://yareta.unige.ch/archives/03497afb-3903-4d13-bf76-2d361dd3d117), [Hugging Face distribution](https://huggingface.co/datasets/jonathanmutal/Medical-Questionnaire-Multilingual-Translation), CC BY 4.0 |
| `Orphadata-rare-diseases-de-uk.tsv` | 11,023 | names of rare diseases, joined by ORPHAcode; **terminology, not sentences** | [Orphadata Science product 1](https://sciences.orphadata.com/alignments/), CC BY 4.0 |

`sources/` contains the untouched source downloads and accompanying attribution material. `build_medical_pairs.py` is the reproducible extraction script. The German Orphadata release is dated 2026-06-23; the Ukrainian release is dated 2024-07-03, so the matching names are not necessarily same-release translations. The medical questionnaire translations are aligned by French source ID, not translated directly UK↔RU. Its source has no independently reserved evaluation set: split by `sentence_id` before model training and keep any separate benchmark disjoint. The Refugee Phrasebook is volunteer-edited and contains evident translation errors (for example `NEED_HOSPITAL` in Russian); it needs human medical-language review before high-stakes use. The extracted files are **research/training candidates, not clinically validated translation data or a production-ready model**.

The MeSpEn German–Russian glossary is also provided under `sources/`. Its 229 raw lines are bilingual medical terms, not sentence pairs, and the language order changes within the file. It was intentionally *not* merged into the clean sentence TSVs. [MeSpEn_Glossaries source](https://zenodo.org/records/2205690), CC BY 4.0.

The previously downloaded general-domain Tatoeba files remain in the parent directory; they are not medical-domain data. The pre-existing ELRC Medical EN–DE file is also in the parent directory and needs filtering before training.

Attribution for Diagnostic Interview: Bouillon et al., “A Speech-enabled Fixed-phrase Translator for Healthcare Accessibility,” NLP4PositiveImpact 2021; Spechbach et al., “A Speech-Enabled Fixed-Phrase Translator for Emergency Settings,” JMIR Medical Informatics 2019. Attribution for Orphadata: Orphadata/Orphanet © INSERM, source releases above. Attribution for MeSpEn: Montserrat Marimon and Martin Krallinger, Barcelona Supercomputing Center, 2018, © SEAD.
