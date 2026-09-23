import re

import pytest
from fastapi.testclient import TestClient

from app import mt_api
from app.mt_engine import (
    DEFAULT_GLOSSARY_PATH,
    Glossary,
    Hop,
    MTEngine,
    detect_language,
    mask,
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
