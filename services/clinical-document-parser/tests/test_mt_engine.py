import re

import pytest
from fastapi.testclient import TestClient

from app import mt_api
from app.mt_engine import (
    DEFAULT_GLOSSARY_PATH,
    Glossary,
    Hop,
    MTEngine,
    auto_protected,
    detect_language,
    mask,
    reflow,
    placeholders_valid,
    repair_numbers,
    restore,
    route,
    split_sentences,
)


class FakeBackend:
    """Wraps each segment in a marker; optional hooks simulate model failures."""

    def __init__(self, *, missing=(), mangle=None):
        self.missing = set(missing)
        self.mangle = mangle
        self.calls = []

    def available(self, model):
        return model not in self.missing

    def translate(self, model, texts, tag, beam_size):
        self.calls.append((model, tag, beam_size, list(texts)))
        out = []
        for text in texts:
            if self.mangle:
                text = self.mangle(text, beam_size)
            out.append(f"[{model.upper()}{tag or ''}]{text}")
        return out


def engine(backend=None):
    return MTEngine(backend or FakeBackend(), Glossary.load(DEFAULT_GLOSSARY_PATH))


# -- masking ---------------------------------------------------------------

def test_mask_restore_round_trip_protects_names_and_every_number():
    text = "Anna Beispiel war vom 12.03. bis 18.03.2026 bei uns: Metformin 1000 mg 1-0-1, HbA1c 7,2 %."
    masked, values = mask(text, ["Anna Beispiel"])
    assert not re.search(r"\d", re.sub(r"XQ\d+", "", masked))
    assert "Anna" not in masked
    assert values == ["Anna Beispiel", "12.03", "18.03.2026", "1000", "1-0-1", "HbA1c", "7,2"]
    assert masked.endswith("XQ7 %.")
    assert restore(masked, values) == text


def test_restore_handles_double_digit_placeholders():
    values = [f"v{i}" for i in range(1, 13)]
    translated = " ".join(f"XQ{i}" for i in range(12, 0, -1))
    assert placeholders_valid(translated, 12)
    assert restore(translated, values) == " ".join(f"v{i}" for i in range(12, 0, -1))


def test_placeholder_validation_rejects_missing_duplicate_and_foreign():
    assert not placeholders_valid("XQ1 XQ3", 3)
    assert not placeholders_valid("XQ1 XQ1 XQ2", 2)
    assert not placeholders_valid("XQ1 XQ2 XQ9", 2)
    assert placeholders_valid("kein Platzhalter", 0)


def test_source_text_that_looks_like_a_placeholder_is_itself_masked():
    masked, values = mask("Code XQ5 bleibt", [])
    assert values == ["XQ5"] and masked == "Code XQ1 bleibt"


def test_number_repair_restores_sequential_spellings_only_when_counts_match():
    assert repair_numbers("am 18.03.2026 um 8:30", "on 18.03.2016 at 8.30") == ("on 18.03.2026 at 8:30", True)
    assert repair_numbers("am 18.03.2026", "no date")[1] is False


# -- segmentation ------------------------------------------------------------

def test_sentence_split_handles_cyrillic_abbreviations_ordinals_and_protected_terms():
    parts = split_sentences("Прием 2 недели. Контроль через т.е. месяц. Затем УЗИ.")
    assert [p for p, _ in parts] == ["Прием 2 недели.", "Контроль через т.е. месяц.", "Затем УЗИ."]
    assert [p for p, _ in split_sentences("Termin am 12. März bei Dr. Muster. Danach Kontrolle.")] == [
        "Termin am 12. März bei Dr. Muster.", "Danach Kontrolle."]
    assert len(split_sentences("Klinik St. Anna Nord. Ende.", ["Klinik St. Anna Nord"])) == 2
    assert "".join(p + g for p, g in split_sentences("A b.  C d.")) == "A b.  C d."


def test_long_sentences_are_wrapped():
    text = " ".join(["Wort"] * 300) + "."
    parts = split_sentences(text)
    assert len(parts) > 1 and all(len(p) <= 400 for p, _ in parts)


def test_line_breaks_blank_lines_tabs_and_indentation_are_preserved():
    text = "Befund:\n\n  Erster Satz. Zweiter Satz.\r\nWert\t12\n\f---\n"
    result = engine().translate(text, "de", "ru", [])
    tag = "[DE-ZLE>>rus<<]"
    assert result.text == (
        f"{tag}Befund:\n\n  {tag}Erster Satz. {tag}Zweiter Satz.\r\n{tag}Wert\t12\n\f---\n"
    )
    assert result.characters == len(text) and result.warnings == 0


# -- engine fallback paths ------------------------------------------------------

def test_protected_names_and_numbers_come_back_verbatim():
    result = engine().translate("Anna Beispiel erhielt am 18.03.2026 Metformin 1000 mg 1-0-1.", "de", "uk", ["Anna Beispiel", " "])
    assert result.text == "[DE-ZLE>>ukr<<]Anna Beispiel erhielt am 18.03.2026 Metformin 1000 mg 1-0-1."


def test_dropped_placeholder_is_retried_with_wider_beam():
    backend = FakeBackend(mangle=lambda text, beam: text.replace("XQ2", "") if beam == 4 else text)
    result = engine(backend).translate("Kontrolle am 18.03.2026 mit 5 mg.", "de", "ru", [])
    assert [call[2] for call in backend.calls] == [4, 8]
    assert result.text.endswith("Kontrolle am 18.03.2026 mit 5 mg.") and result.warnings == 0


def test_persistent_placeholder_drop_falls_back_to_visible_numbers_with_repair():
    def mangle(text, beam):
        if "XQ" in text:
            return text.replace("XQ1", "")
        return text.replace("2026", "2016")

    backend = FakeBackend(mangle=mangle)
    result = engine(backend).translate("Kontrolle am 18.03.2026. Gut.", "de", "ru", [])
    assert result.text == "[DE-ZLE>>rus<<]Kontrolle am 18.03.2026. [DE-ZLE>>rus<<]Gut."
    assert result.warnings == 1
    # masked attempts at beam 4 and 8, then the failed segment with numbers visible
    assert backend.calls[-1][3] == ["Kontrolle am 18.03.2026."]


def test_segments_without_letters_are_not_sent_to_the_model():
    backend = FakeBackend()
    result = engine(backend).translate("18.03.2026\n1-0-1", "de", "ru", [])
    assert result.text == "18.03.2026\n1-0-1" and backend.calls == []


def test_ru_uk_pivots_through_english():
    assert route("ru", "uk") == [Hop("zle-en"), Hop("en-zle", ">>ukr<<")]
    assert route("de", "en") == [Hop("de-en")]
    assert route("uk", "de") == [Hop("zle-de")]
    backend = FakeBackend()
    result = engine(backend).translate("Контроль 2 недели.", "ru", "uk", [])
    assert result.text == "[EN-ZLE>>ukr<<][ZLE-EN]Контроль 2 недели."
    assert [c[0] for c in backend.calls] == ["zle-en", "en-zle"]


def test_pivot_checks_only_the_first_model_vocabulary():
    # The English pivot model cannot encode Cyrillic; checking the source
    # text against it masked every letter and returned the text unchanged.
    class Latin(FakeBackend):
        def unencodable(self, model, chars):
            if model.startswith("en-"):
                return {char for char in chars if "а" <= char.lower() <= "я" or char in "іїєґ"}
            return set()

    backend = Latin()
    result = engine(backend).translate("Жовчевий міхур не побільшений.", "uk", "ru", [])
    assert backend.calls[0][3] == ["Жовчевий міхур не побільшений."]
    assert result.text == "[EN-ZLE>>rus<<][ZLE-EN]Жовчевий міхур не побільшений."


# -- language detection -------------------------------------------------------

@pytest.mark.parametrize(("text", "language"), [
    ("Пациентка жалуется на боли.", "ru"),
    ("Пацієнтка скаржиться на біль.", "uk"),
    ("Der Patient wurde mit Verdacht auf Pneumonie aufgenommen.", "de"),
    ("The patient was admitted with suspected pneumonia.", "en"),
    ("Metformin 1000 mg", "de"),
    ("Frau Anna Beispiel erhält Metformin ab 18.03.2026.\n\nV.a. Pneumonie.", "de"),
    ("Status post appendectomy, no fever at discharge.", "en"),
])
def test_language_detection(text, language):
    assert detect_language(text) == language


# -- glossary -------------------------------------------------------------------

def test_german_abbreviations_are_expanded_case_sensitively_outside_names():
    backend = FakeBackend()
    result = engine(backend).translate(
        "V.a. Cholezystolithiasis, Z.n. OP, geb. 04.07.1961, v.a. nachts. V.a. Klinik", "de", "ru", ["V.a. Klinik"])
    assert backend.calls[0][3] == [
        "Verdacht auf Cholezystolithiasis, Zustand nach OP, geboren am XQ1, v.a. nachts."]
    assert result.text.endswith("geboren am 04.07.1961, v.a. nachts. V.a. Klinik")


def test_final_abbreviation_keeps_the_sentence_period():
    glossary = Glossary.load(DEFAULT_GLOSSARY_PATH)
    assert glossary.expand("Kontrolle ggf.", "de") == "Kontrolle gegebenenfalls."
    assert glossary.expand("ggf. Kontrolle", "de") == "gegebenenfalls Kontrolle"


def test_glossary_terms_are_masked_and_rendered_for_the_target_language():
    backend = FakeBackend()
    result = engine(backend).translate(
        "Die MRT zeigte eine 2,3 cm große Raumforderung. Die Milz war o.B.\nWiedervorstellung am 18.03.2027.",
        "de", "ru", [])
    assert backend.calls[0][3] == [
        "Die MRT zeigte eine XQ1 cm große XQ2.", "Die Milz war XQ1.", "XQ1 am XQ2."]
    tag = "[DE-ZLE>>rus<<]"
    assert result.text == (
        f"{tag}Die MRT zeigte eine 2,3 cm große объёмное образование. {tag}Die Milz war без особенностей.\n"
        f"{tag}повторный приём am 18.03.2027."
    )
    # A segment that is only a glossary term is not sent to the model.
    assert engine(FakeBackend()).translate("o.B.", "de", "en", []).text == "unremarkable."


def test_sentence_starting_with_a_rendered_term_is_capitalized():
    class Plain(FakeBackend):
        def translate(self, model, texts, tag, beam_size):
            return list(texts)

    result = engine(Plain()).translate("Wiedervorstellung am 18.03.2027.", "de", "uk", [])
    assert result.text == "Повторний прийом am 18.03.2027."


def test_fallback_keeps_names_masked_while_numbers_are_visible():
    def mangle(text, beam):
        if "XQ2" in text:  # names + numbers masked: model drops a placeholder
            return text.replace("XQ2", "")
        return text.replace("Anna", "Анна").replace("2026", "2016")

    backend = FakeBackend(mangle=mangle)
    result = engine(backend).translate("Anna Beispiel kam am 18.03.2026.", "de", "ru", ["Anna Beispiel"])
    assert backend.calls[-1][3] == ["XQ1 kam am 18.03.2026."]
    assert result.text == "[DE-ZLE>>rus<<]Anna Beispiel kam am 18.03.2026." and result.warnings == 1


def test_number_repair_never_swaps_reordered_numbers():
    assert repair_numbers("am 18.03.2026 in Haus 5", "in Haus 5 am 18.03.2016") == ("in Haus 5 am 18.03.2016", False)
    assert repair_numbers("XQ1 am 2026", "XQ1 at 2016") == ("XQ1 at 2026", True)


def test_abbreviations_only_expand_for_german_source():
    assert Glossary.load(DEFAULT_GLOSSARY_PATH).expand("V.a. test", "en") == "V.a. test"


def test_known_mistranslations_are_repaired_with_case_forms():
    glossary = Glossary.load(DEFAULT_GLOSSARY_PATH)
    source = "Raumforderung in der Leber."
    assert glossary.repair(source, "Пространственная нагрузка в печени.", "ru") == "Объёмное образование в печени."
    assert glossary.repair(source, "признаки пространственной нагрузки", "ru") == "признаки объёмного образования"
    assert glossary.repair(source, "з вимогою простору", "uk") == "з об'ємним утворенням"
    assert glossary.repair(source, "вимога простору 2 см", "uk") == "об'ємне утворення 2 см"
    assert glossary.repair(source, "показала пространственное требование", "ru") == "показала объёмное образование"
    assert glossary.repair("Zustand nach OP", "Condition after surgery", "en") == "Status post surgery"
    # Without the source term the target text is left alone.
    assert glossary.repair("Belastung", "пространственная нагрузка", "ru") == "пространственная нагрузка"


# -- API ------------------------------------------------------------------------

@pytest.fixture
def client():
    backend = FakeBackend(missing={"de-en"})
    mt_api.app.dependency_overrides[mt_api.get_engine] = lambda: engine(backend)
    yield TestClient(mt_api.app)
    mt_api.app.dependency_overrides.clear()


def test_health_does_not_load_models():
    assert TestClient(mt_api.app).get("/health").json() == {"status": "ok"}


def test_translate_endpoint_success_and_detection(client):
    response = client.post("/v1/translate", json={
        "text": "Пациентка Анна жалуется.", "source_language": None,
        "target_language": "de", "protected": ["Анна"],
    })
    assert response.status_code == 200
    assert response.json() == {
        "text": "[ZLE-DE]Пациентка Анна жалуется.", "detected_source_language": "ru",
        "characters": 24, "warnings": 0,
    }


@pytest.mark.parametrize(("body", "status", "code"), [
    ({"text": "Hallo Welt", "source_language": "fr", "target_language": "de"}, 422, "unsupported_language"),
    ({"text": "Hallo Welt", "source_language": "de", "target_language": "pl"}, 422, "unsupported_language"),
    ({"text": "Hallo Welt", "source_language": "de", "target_language": "de"}, 422, "same_language"),
    ({"text": "Der Patient ist stabil.", "source_language": None, "target_language": "de"}, 422, "same_language"),
    ({"text": "  \n ", "source_language": "de", "target_language": "ru"}, 422, "empty_text"),
    ({"text": "a" * 100_001, "source_language": "de", "target_language": "ru"}, 422, "too_large"),
    ({"text": "Hallo Welt", "source_language": "de", "target_language": "en"}, 503, "model_unavailable"),
])
def test_translate_endpoint_errors(client, body, status, code):
    response = client.post("/v1/translate", json=body)
    assert response.status_code == status
    assert response.json() == {"detail": {"code": code}}


def test_translate_endpoint_hides_unexpected_error_text(client):
    class Boom(FakeBackend):
        def translate(self, *args):
            raise RuntimeError("Anna Beispiel secret")

    mt_api.app.dependency_overrides[mt_api.get_engine] = lambda: engine(Boom())
    response = client.post("/v1/translate", json={"text": "Hallo Welt", "source_language": "de", "target_language": "ru"})
    assert response.status_code == 500
    assert "Anna" not in response.text


# -- PDF reflow, symbols, names, headings --------------------------------------

LETTER = (
    "Sehr geehrter Herr Dr. Hausmann,\n"
    "im Folgenden berichten wir über unsere gemeinsame Patientin\n"
    "Frau Anna Muster, die sich vom 01.03.2017 bis zum 05.03.2017 bei uns befand.\n"
    "Diagnosen\n"
    "• Ambulant erworbene Pneumonie (J15.9)\n"
    "• Arterielle Hypertonie\n"
    "Aktuelle Anamnese\n"
    "Frau Muster stellte sich mit Fieber und Dyspnoe in unserer\n"
    "Notfallambulanz vor. Kein Hinweis auf ein fokal-\n"
    "neurologisches Defizit.\n"
    "\n"
    "Blutkultur vom 01.03.2017: Befund ausstehend (wird im endgültigen Arztbrief nachgereicht)\n"
    "Röntgen-Thorax vom 01.03.2017: Infiltrat rechts.\n"
    "Ramipril 5 mg (z.B. Delix)  1-0-0\n"
    "Metformin 850 mg  1-0-1"
)


def test_reflow_joins_wrapped_sentences_and_keeps_blocks():
    glossary = Glossary.load(DEFAULT_GLOSSARY_PATH)
    assert reflow(LETTER, "de", lambda line: glossary.is_heading(line, "de")).split("\n") == [
        "Sehr geehrter Herr Dr. Hausmann,",
        "im Folgenden berichten wir über unsere gemeinsame Patientin Frau Anna Muster, "
        "die sich vom 01.03.2017 bis zum 05.03.2017 bei uns befand.",
        "Diagnosen",
        "• Ambulant erworbene Pneumonie (J15.9)",
        "• Arterielle Hypertonie",
        "Aktuelle Anamnese",
        "Frau Muster stellte sich mit Fieber und Dyspnoe in unserer Notfallambulanz vor. "
        "Kein Hinweis auf ein fokal-neurologisches Defizit.",
        "",
        "Blutkultur vom 01.03.2017: Befund ausstehend (wird im endgültigen Arztbrief nachgereicht)",
        "Röntgen-Thorax vom 01.03.2017: Infiltrat rechts.",
        "Ramipril 5 mg (z.B. Delix)  1-0-0",
        "Metformin 850 mg  1-0-1",
    ]


def test_reflow_collapses_double_spaces_only_inside_sentences():
    text = "Eine Episode, die von Ihnen  mit Antibiotika behandelt wurde.\nRamipril 5 mg  1-0-0"
    assert reflow(text, "de") == "Eine Episode, die von Ihnen mit Antibiotika behandelt wurde.\nRamipril 5 mg  1-0-0"


def test_short_lines_and_lowercase_continuations_in_russian():
    assert reflow("Жалобы\nна боль в груди.\nДиагноз", "ru") == "Жалобы на боль в груди.\nДиагноз"


def test_headings_bullets_and_table_columns_are_not_sent_to_the_model():
    backend = FakeBackend()
    result = engine(backend).translate("Nebendiagnosen:\n• Arterielle Hypertonie Grad 1\nRamipril 5 mg  1-0-0", "de", "ru", [])
    assert backend.calls[0][3] == ["Arterielle Hypertonie XQ1", "Ramipril XQ1 mg"]
    tag = "[DE-ZLE>>rus<<]"
    assert result.text == (
        f"Сопутствующие диагнозы:\n• {tag}Arterielle Hypertonie 1 степени\n{tag}Ramipril 5 mg  1-0-0"
    )


def test_names_after_titles_streets_and_postcodes_are_protected():
    text = ("Sehr geehrte Frau Kollegin, sehr geehrter Herr Dr. Hausmann,\n"
            "Frau Anna Muster, wohnhaft Lindenstraße 2, 50937 Köln. Frau M. lebt allein.\n"
            "Prof. Dr. B. Oss  Dr. W. Alles\nChefärztin")
    assert auto_protected(text, "de") == [
        "50937 Köln", "Anna Muster", "B. Oss", "Hausmann", "Lindenstraße 2", "M.", "W. Alles"]
    backend = FakeBackend()
    result = engine(backend).translate("Frau Muster lebt in der Lindenstraße 2 bei Frau Anna Muster.", "de", "uk", [])
    assert backend.calls[0][3] == ["XQ1 lebt in der XQ2 bei Frau XQ3."]
    assert result.text == "[DE-ZLE>>ukr<<]пані Muster lebt in der Lindenstraße 2 bei Frau Anna Muster."


def test_unencodable_symbols_are_masked_and_bullets_kept_literal():
    class Symbols(FakeBackend):
        def unencodable(self, model, chars):
            return chars & {"°", "μ", "®", "•"}

    backend = Symbols()
    result = engine(backend).translate("• Fieber bis 38,7°C, Leukozyten 16.000/μL, Delix® 1-0-0.", "de", "ru", [])
    assert backend.calls[0][3] == ["Fieber bis XQ1, Leukozyten XQ2, XQ3 XQ4."]
    assert result.text == "• [DE-ZLE>>rus<<]Fieber bis 38,7°C, Leukozyten 16.000/μL, Delix® 1-0-0."


def test_unknown_marker_is_never_emitted():
    backend = FakeBackend(mangle=lambda text, beam: text + " ⁇")
    result = engine(backend).translate("Die Patientin ist stabil.", "de", "ru", [])
    assert "⁇" not in result.text
    assert result.text == "Die Patientin ist stabil." and result.warnings == 1


def test_fully_unmasked_fallback_never_returns_a_translated_name():
    def mangle(text, beam):
        return text.replace("XQ1", "") if "XQ1" in text else text.replace("Muster", "Шаблон")

    result = engine(FakeBackend(mangle=mangle)).translate("Wir sahen Herrn Dr. Muster.", "de", "ru", [])
    assert result.text == "Wir sahen Herrn Dr. Muster." and result.warnings == 1


def test_rendered_label_keeps_the_rest_of_the_sentence_lowercase():
    backend = FakeBackend()
    result = engine(backend).translate("Pulmo: rechtsseitig feuchte Rasselgeräusche. Pulmo: Giemen beidseits.", "de", "ru", [])
    assert backend.calls[0][3] == ["Giemen beidseits."]
    assert result.text == "Лёгкие: справа влажные хрипы. Лёгкие: [DE-ZLE>>rus<<]Giemen beidseits."


@pytest.mark.parametrize(("source", "translated", "language", "expected"), [
    ("Patientin Frau Anna Muster", "пациентке, женщине Anna Muster", "ru", "пациентке, г-же Anna Muster"),
    ("Frau Anna Muster", "пацієнтку, жінку Anna Muster", "uk", "пацієнтку, пані Anna Muster"),
    ("seit dem Tag vor der Aufnahme", "со дня приема", "ru", "со дня поступления"),
    ("Röntgenaufnahme", "со дня приема", "ru", "со дня приема"),
    ("geboren am 01.01.1930", "родившейся в 01.01.1930", "ru", "родившейся 01.01.1930"),
    ("geboren am 01.01.1930", "яка народилася в 01.01.1930", "uk", "яка народилася 01.01.1930"),
])
def test_documented_target_repairs(source, translated, language, expected):
    assert Glossary.load(DEFAULT_GLOSSARY_PATH).repair(source, translated, language) == expected


def test_german_rewrites_and_phrase_terms():
    backend = FakeBackend()
    engine(backend).translate(
        "Sie fühle sich stark abgeschlagen. Appetit seit dem Tag vor der Aufnahme vermindert. "
        "Stuhlgang unauffällig. Kein Pflegegrad.", "de", "ru", [])
    assert backend.calls[0][3] == ["Sie fühle sich sehr schwach.", "Appetit XQ1 vermindert.", "Stuhlgang XQ1."]
    result = engine(FakeBackend()).translate("• Ambulant erworbene Pneumonie (J15.9)\nKein Pflegegrad.", "de", "ru", [])
    assert result.text == "• Внебольничная пневмония (J15.9)\nСтепень ухода (Pflegegrad) не установлена."
