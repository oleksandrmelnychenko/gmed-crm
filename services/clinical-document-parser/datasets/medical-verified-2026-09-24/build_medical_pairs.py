#!/usr/bin/env python3
"""Extract aligned medical phrase pairs without inventing translations."""

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path("/tmp/aura-medical-output")
ROOT.mkdir(exist_ok=True)


def write_tsv(name, header, rows):
    path = ROOT / name
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)
    print(name, len(rows))


with Path("/tmp/aura-medical-phrasebook-2022.csv").open(
    encoding="utf-8-sig", newline=""
) as handle:
    sheet = list(csv.reader(handle))
columns = sheet[1]
id_col = columns.index("ID")
language_cols = {
    "de": columns.index("German [Deutsch]"),
    "ru": columns.index("Russian"),
    "uk": columns.index("Ukrainian"),
}
phrase_rows = sheet[3:]
for source, target in (("de", "uk"), ("de", "ru"), ("uk", "ru")):
    result = []
    for row in phrase_rows:
        if len(row) != len(columns):
            raise ValueError(f"Unexpected phrasebook row width: {len(row)}")
        phrase_id = row[id_col].strip()
        src = row[language_cols[source]].strip()
        tgt = row[language_cols[target]].strip()
        if phrase_id and src and tgt:
            result.append((phrase_id, src, tgt))
    write_tsv(
        f"RefugeePhrasebook-medical-{source}-{target}.tsv",
        ("phrase_id", source, target),
        result,
    )


translations = defaultdict(dict)
with Path("/tmp/aura-medical-questionnaire-translations.tsv").open(
    encoding="utf-8-sig", newline=""
) as handle:
    for row in csv.DictReader(handle, delimiter="\t"):
        if row["gender_variant"] != "default" or row["tgt_lang"] not in {"uk", "ru"}:
            continue
        sentence_id = row["sentence_id"].strip()
        lang = row["tgt_lang"]
        source = row["source_text"].strip()
        target = row["target_text"].strip()
        if not sentence_id or not source or not target:
            continue
        value = (source, target)
        previous = translations[sentence_id].get(lang)
        if previous is not None and previous != value:
            raise ValueError(f"Conflicting {lang} translations for {sentence_id}")
        translations[sentence_id][lang] = value

result = []
for sentence_id in sorted(translations):
    pair = translations[sentence_id]
    if "uk" not in pair or "ru" not in pair:
        continue
    fr_uk, uk = pair["uk"]
    fr_ru, ru = pair["ru"]
    if fr_uk != fr_ru:
        raise ValueError(f"Mismatched French pivot for {sentence_id}")
    result.append((sentence_id, uk, ru, fr_uk))
write_tsv(
    "DiagnosticInterview-medical-uk-ru.tsv",
    ("sentence_id", "uk", "ru", "original_fr"),
    result,
)


def orphadata_names(path):
    with Path(path).open(encoding="utf-8") as handle:
        records = json.load(handle)["JDBOR"][0]["DisorderList"][0]["Disorder"]
    names = {}
    for record in records:
        code = record["OrphaCode"].strip()
        name = record["Name"][0]["label"].strip()
        if code in names and names[code] != name:
            raise ValueError(f"Conflicting ORPHAcode {code}")
        if code and name:
            names[code] = name
    return names


de_names = orphadata_names("/tmp/aura-medical-extract/de_product1.json")
uk_names = orphadata_names("/tmp/aura-medical-extract/ua_product1.json")
result = [(code, de_names[code], uk_names[code]) for code in sorted(set(de_names) & set(uk_names), key=int)]
write_tsv(
    "Orphadata-rare-diseases-de-uk.tsv",
    ("ORPHAcode", "de", "uk"),
    result,
)
