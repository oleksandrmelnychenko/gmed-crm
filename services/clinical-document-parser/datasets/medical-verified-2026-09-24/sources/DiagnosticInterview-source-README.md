---
pretty_name: 'Medical Questionnaire: Multilingual Translation'
license: cc-by-4.0
language:
- fr
- sq
- ar
- ary
- aeb
- arq
- prs
- fa
- ru
- en
- es
- ti
- uk
tags:
- text
- tabular
- medical
- healthcare
- multilingual
- low-resource
- translation
- UMLS
- dialogues
- doctor-to-patient questions
task_categories:
- translation
multilinguality: multilingual
dataset_type: text
size_categories:
- 10K<n<100k
configs:
- config_name: default
  data_files:
  - translations.tsv
  delimitator: "\t"
dataset_info:
  features:
  - name: sentence_id
    dtype: string
  - name: src_lang
    dtype: string
  - name: tgt_lang
    dtype: string
  - name: gender_variant
    dtype: string
  - name: source_text
    dtype: string
  - name: target_text
    dtype: string
  - name: semantic_gloss
    dtype: string
  - name: CUI_semantic_gloss
    dtype: string
  splits:
  - name: train
    num_examples: null
  citation: |
    If you use the translations, please cite:
      @inproceedings{bouillon-etal-2021-speech,
        title = "A Speech-enabled Fixed-phrase Translator for Healthcare Accessibility",
        author = "Bouillon, Pierrette and Gerlach, Johanna and Mutal, Jonathan and Tsourakis, Nikos and Spechbach, Herv{\'e}",
        booktitle = "Proceedings of the 1st Workshop on NLP for Positive Impact",
        month = aug,
        year = "2021",
        publisher = "Association for Computational Linguistics",
        url = "https://aclanthology.org/2021.nlp4posimpact-1.15/",
        doi = "10.18653/v1/2021.nlp4posimpact-1.15",
        pages = "135--142"
      }
      @article{info:doi/10.2196/13167,
        author="Spechbach, Herv{\'e} and Gerlach, Johanna and Mazouri Karker, Sanae and Tsourakis, Nikos and Combescure, Christophe and Bouillon, Pierrette",
        title="A Speech-Enabled Fixed-Phrase Translator for Emergency Settings: Crossover Study",
        journal="JMIR Med Inform",
        year="2019",
        month="May",
        volume="7",
        number="2",
        pages="e13167",
        doi="10.2196/13167"
      }
paper: null
---


# Diagnostic Interview Corpus

The **Diagnostic interview corpus** is a multilingual dataset of **12,754 French medical diagnostic interview sentences** (questions and instructions) with translations into 12 target languages and a **semantic gloss based on UMLS (Unified Medical Language System)**.

It supports research on:

- Low-resource **multilingual medical machine translation**
- **Semantic representation** based on UMLS concepts
- **Generation of pictograph sequences** based on concept sequences for patients with limited health literacy.

To access concept–pictograph pairs, please refer to [this repository](https://doi.org/10.26037/yareta:vo7jydjb25ektpwcvlxwktr72m).

---

## Languages

- **Source:** French
- **Targets:** The following table lists the target languages together with their codes as used in the datasets. The codes follow **ISO 639-1** when available (e.g., `sq` for Albanian, `es` for Spanish), and **ISO 639-3** or extended conventions when needed (e.g., `prs` for Dari, `ary` for Moroccan Arabic, `en-simple` for Simple English, and `umls` for semantic glosses).

| Language                  | Code     |
|---------------------------|----------|
| Albanian                  | sq       |
| Modern Standard Arabic    | ar       |
| Moroccan Arabic           | ary      |
| Tunisian Arabic           | aeb      |
| Algerian Arabic (Dziria)  | arq      |
| Dari                      | prs      |
| Farsi                     | fa       |
| Russian                   | ru       |
| Simple English            | en-simple|
| Spanish                   | es       |
| Tigrinya                  | ti       |
| Ukrainian                 | uk       |
| UMLS (semantic glosses)   | umls     |


- **Semantic gloss:** Representation as a sequence of concepts, using UMLS concepts for medical concepts and custom concepts for functional elements such as agents or modes. Two versions of the gloss are provided: 1) using concept names, 2) using UMLS CUIs (Concept Unique Identifiers) for UMLS concepts and names for custom concepts. Note: as opposed to the CUIs, some UMLS concept names may change over time due to UMLS updates.
---

## Dataset

The dataset includes one file:

- **`translations.csv`**: French sentences with their human translations into the target languages.

### translation.csv

#### Data Structure

Each row in the table corresponds to a **target language** (`tgt_lang`) and, where applicable, a **gender variant** (`default` / `female`).

- `sentence_id`: Unique identifier for the source sentence (shared across languages/variants)
- `src_lang`: Source language code
- `tgt_lang`: Target language code
- `gender_variant`: Some target languages in the corpus use **grammatical gender** in ways that affect medical communication. For these cases, the dataset includes **two translation variants**:
  - `default`: gender-neutral or conventionally masculine (e.g., Albanian _jeni student?_ “Are you a student?”)
  - `female`: explicitly marked female form (e.g., Albanian _jeni studente?_)
- `source_text`: Original French sentence
- `target_text`: Translation into the target language
- `semantic_gloss`: Semantic representation: pipe-separated sequence of concepts using concept names (UMLS + custom concepts).
- `CUI_semantic_gloss`: Semantic representation: pipe-separated sequence of concepts using CUIs for UMLS concepts and names for custom concepts (aligned 1:1 with `semantic_gloss`)

#### Distribution

- 12,754 unique French sentences
- 12 parallel translations
- Two semantic gloss representations per sentence: one using concept names, and one using CUIs for UMLS concepts

The following table summarises the data by language. Each row corresponds to a **target language** (`tgt_lang`) and, where applicable, a **gender variant** (`default` / `female`).

- `tgt_lang`: Target language code
- `gender_variant`: `default` or `female`
- `n_rows`: total rows for this language/variant (from both files)
- `n_unique_sentences` = unique sentences for this language/variant
- `total_rows` = overall rows across all gender variants for this language
- `total_unique_sentences` = overall unique sentences across all gender variants for this language

| tgt_lang  | gender_variant | n_rows | n_unique_sentences | total_rows | total_unique_sentences |
| --------- | -------------- | ------ | ------------------ | ---------- | ---------------------- |
| aeb       | default        | 11084  | 11084              | 17072      | 11086                  |
| aeb       | female         | 5988   | 5988               | 17072      | 11086                  |
| ar        | default        | 12638  | 12638              | 23105      | 12638                  |
| ar        | female         | 10467  | 10467              | 23105      | 12638                  |
| arq       | default        | 11084  | 11084              | 17072      | 11086                  |
| arq       | female         | 5988   | 5988               | 17072      | 11086                  |
| ary       | default        | 11084  | 11084              | 17072      | 11086                  |
| ary       | female         | 5988   | 5988               | 17072      | 11086                  |
| en-simple | default        | 12602  | 12602              | 12602      | 12602                  |
| es        | default        | 12662  | 12662              | 12865      | 12662                  |
| es        | female         | 203    | 203                | 12865      | 12662                  |
| fa        | default        | 12732  | 12732              | 12732      | 12732                  |
| prs       | default        | 12711  | 12711              | 12714      | 12711                  |
| prs       | female         | 3      | 3                  | 12714      | 12711                  |
| ru        | default        | 11084  | 11084              | 11090      | 11084                  |
| ru        | female         | 6      | 6                  | 11090      | 11084                  |
| sq        | default        | 12736  | 12736              | 12752      | 12736                  |
| sq        | female         | 16     | 16                 | 12752      | 12736                  |
| ti        | default        | 12711  | 12711              | 24390      | 12711                  |
| ti        | female         | 11679  | 11679              | 24390      | 12711                  |
| uk        | default        | 11076  | 11076              | 11080      | 11076                  |
| uk        | female         | 4      | 4                  | 11080      | 11076                  |

---

## Example

```text
French: Avez-vous des nausées ou des vomissements ?
English: Do you have nausea or vomiting?
UMLS gloss: You | Nausea | or – article | Vomiting | Question
```

---

## Citation

If you use the translations, please cite:

```
@inproceedings{bouillon-etal-2021-speech,
    title = "A Speech-enabled Fixed-phrase Translator for Healthcare Accessibility",
    author = "Bouillon, Pierrette  and
      Gerlach, Johanna  and
      Mutal, Jonathan  and
      Tsourakis, Nikos  and
      Spechbach, Herv{\'e}",
    editor = "Field, Anjalie  and
      Prabhumoye, Shrimai  and
      Sap, Maarten  and
      Jin, Zhijing  and
      Zhao, Jieyu  and
      Brockett, Chris",
    booktitle = "Proceedings of the 1st Workshop on NLP for Positive Impact",
    month = aug,
    year = "2021",
    address = "Online",
    publisher = "Association for Computational Linguistics",
    url = "https://aclanthology.org/2021.nlp4posimpact-1.15/",
    doi = "10.18653/v1/2021.nlp4posimpact-1.15",
    pages = "135--142"
}
```

```
@article{info:doi/10.2196/13167,
	author="Spechbach, Herv{\'e}
	and Gerlach, Johanna
	and Mazouri Karker, Sanae
	and Tsourakis, Nikos
	and Combescure, Christophe
	and Bouillon, Pierrette",
	title="A Speech-Enabled Fixed-Phrase Translator for Emergency Settings: Crossover Study",
	journal="JMIR Med Inform",
	year="2019",
	month="May",
	day="07",
	volume="7",
	number="2",
	pages="e13167",
	keywords="anamnesis; emergencies; tools for translation and interpreting; fixed-phrase translator; speech modality",
	issn="2291-9694",
	doi="10.2196/13167",
	url="http://medinform.jmir.org/2019/2/e13167/",
	url="https://doi.org/10.2196/13167",
	url="http://www.ncbi.nlm.nih.gov/pubmed/31066702"
}
```

---

## Acknowledgments

This corpus was developed in the context of the BabelDr and PictoDr projects at the University of Geneva, in collaboration with Geneva University Hospitals. This work is part of the PROPICTO project, funded by the Swiss National Science Foundation (N°197864) and the French National Research Agency (ANR-20-CE93-0005). This project also received funding by the ”Fondation Privée des Hôpitaux Universitaires de Genève”.
