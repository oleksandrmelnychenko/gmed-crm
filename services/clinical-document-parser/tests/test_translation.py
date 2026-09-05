import json
import subprocess
from types import SimpleNamespace

import pytest

from app import translation
from app.install_translation_model import install_model
from app.parser import parse_clinical_text
from app.translation_segments import sentence_chunks


def english_draft():
    return parse_clinical_text("Diagnoses\nSuspected pneumonia\fRecommendations\nReview in 2 weeks.")


def mock_model(monkeypatch, tmp_path):
    (tmp_path / "model").mkdir()
    (tmp_path / "model" / "model.bin").touch()
    monkeypatch.setattr(translation, "MODEL_DIRECTORY", tmp_path)


def test_translated_draft_never_replaces_source_candidates_or_assertions(monkeypatch, tmp_path):
    mock_model(monkeypatch, tmp_path)
    draft = english_draft()
    before = draft.model_dump()

    def run(command, **kwargs):
        assert command[2] == "app.translation_runtime"
        assert kwargs["timeout"] == 120
        assert kwargs["stderr"] == subprocess.DEVNULL
        request = json.loads(kwargs["input"])
        assert request["text"] == draft.raw_text
        return SimpleNamespace(stdout=json.dumps({"text": "Diagnosen\nVerdacht auf Pneumonie\fEmpfehlungen\nKontrolle in 2 Wochen.",
            "candidates": {item.id: ("Verdacht auf Pneumonie" if item.target == "diagnosis" else "Kontrolle in 2 Wochen.") for item in draft.candidates}}))

    monkeypatch.setattr(translation.subprocess, "run", run)
    result = translation.with_german_translation(draft)
    assert result.translation.status == "review_required"
    assert result.translation.text.count("\f") == 1
    assert result.candidates == draft.candidates
    assert draft.model_dump() == before
    assert not any(item.selected for item in result.candidates)


@pytest.mark.parametrize("failure", [
    subprocess.TimeoutExpired("model", 120), subprocess.CalledProcessError(1, "model"),
    OSError("private document details"),
])
def test_translation_failure_keeps_ocr_and_has_no_private_error(monkeypatch, tmp_path, failure):
    mock_model(monkeypatch, tmp_path)
    draft = english_draft()
    def fail(*args, **kwargs):
        raise failure
    monkeypatch.setattr(translation.subprocess, "run", fail)
    result = translation.with_german_translation(draft)
    assert result.translation.status == "failed"
    assert result.raw_text == draft.raw_text
    assert result.candidates == draft.candidates
    assert "private document" not in result.model_dump_json()


def test_missing_model_returns_unavailable_without_starting_process(monkeypatch, tmp_path):
    monkeypatch.setattr(translation, "MODEL_DIRECTORY", tmp_path)
    assert translation.with_german_translation(english_draft()).translation.status == "unavailable"


def test_oversized_document_is_never_silently_truncated(monkeypatch):
    monkeypatch.setattr(translation, "MAX_TRANSLATION_CHARS", 5)
    assert translation.with_german_translation(english_draft()).translation.status == "too_large"


def test_german_document_is_not_retranslated():
    draft = parse_clinical_text("Diagnosen\nArterielle Hypertonie\nAnamnese\nDer Patient kommt zur Kontrolle.")
    assert translation.with_german_translation(draft) is draft


@pytest.mark.parametrize("payload", [
    "bad json", {"text": "empty candidates", "candidates": {}},
    {"text": "\f", "candidates": {}}, {"text": 42, "candidates": {}},
])
def test_invalid_model_output_fails_without_losing_recognition(monkeypatch, tmp_path, payload):
    mock_model(monkeypatch, tmp_path)
    monkeypatch.setattr(translation.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=json.dumps(payload)))
    assert translation.with_german_translation(english_draft()).translation.status == "failed"


def test_changed_numbers_are_flagged_and_candidate_cannot_be_adopted(monkeypatch, tmp_path):
    mock_model(monkeypatch, tmp_path)
    draft = parse_clinical_text("Recommendations\nReview in 2 weeks.")
    payload = {"text": "Kontrolle in 3 Wochen.", "candidates": {draft.candidates[0].id: "Kontrolle in 3 Wochen."}}
    monkeypatch.setattr(translation.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=json.dumps(payload)))
    result = translation.with_german_translation(draft)
    assert result.translation.status == "review_required"
    assert result.translation.warnings == ["translation_numbers_changed"]
    assert result.translation.candidate_values == {}


def test_model_installation_requires_pinned_checksum(tmp_path):
    with pytest.raises(ValueError, match="checksum"):
        install_model(b"incorrect model", tmp_path)
    assert not list(tmp_path.iterdir())


def test_missing_clinical_qualifier_blocks_candidate_adoption(monkeypatch, tmp_path):
    mock_model(monkeypatch, tmp_path)
    draft = parse_clinical_text("Findings\nEuthyroid autoimmune thyroiditis.")
    payload = {"text": "Befund\nAutoimmunthyreoiditis.", "candidates": {draft.candidates[0].id: "Autoimmunthyreoiditis."}}
    monkeypatch.setattr(translation.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=json.dumps(payload)))
    result = translation.with_german_translation(draft)
    assert result.translation.warnings == ["translation_terms_changed"]
    assert result.translation.candidate_values == {}
    assert result.candidates == draft.candidates
    assert translation.clinical_qualifiers_preserved("Euthyroid autoimmune thyroiditis.", "Euthyreote Autoimmunthyreoiditis.")


@pytest.mark.skipif(not (translation.MODEL_DIRECTORY / "model/model.bin").exists(), reason="local translation model not installed")
def test_real_local_model_preserves_negation_dose_and_pages():
    pytest.importorskip("ctranslate2")
    pytest.importorskip("sentencepiece")
    draft = parse_clinical_text("Discharge summary\nDiagnoses\nNo evidence of pneumonia\fCurrent medications\nMetformin 500 mg twice daily")
    result = translation.with_german_translation(draft)
    assert result.translation.status == "review_required"
    assert "Keine" in result.translation.text
    assert result.translation.text.startswith("Entlassungsbericht\nDiagnosen\n")
    assert "500 mg" in result.translation.text
    assert result.translation.text.count("\f") == 1
    assert result.translation.warnings == []


def test_translation_sentence_boundaries_preserve_decimals_titles_and_domains():
    assert sentence_chunks("Dr. Alice reviewed the 1.5 mg dose. Continue treatment. Review at example.org.") == [
        "Dr. Alice reviewed the 1.5 mg dose.", "Continue treatment.", "Review at example.org.",
    ]


@pytest.mark.skipif(not (translation.MODEL_DIRECTORY / "model/model.bin").exists(), reason="local translation model not installed")
def test_local_model_does_not_drop_second_sentence_of_recommendation():
    pytest.importorskip("ctranslate2")
    pytest.importorskip("sentencepiece")
    draft = parse_clinical_text("Recommendations\nContinue the current treatment. Repeat the examination in 6 weeks.")
    result = translation.with_german_translation(draft)
    assert result.translation.status == "review_required"
    value = result.translation.candidate_values[draft.candidates[0].id]
    assert "6 Wochen" in value
    assert "Behandlung" in value
