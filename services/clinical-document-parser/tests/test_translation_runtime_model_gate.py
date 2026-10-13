import json
import sys
from types import SimpleNamespace

import pytest

from app.translation_runtime import translate_payload


@pytest.fixture
def model(monkeypatch, tmp_path):
    # Exercise package validation without loading model weights or native engines.
    monkeypatch.setitem(sys.modules, "ctranslate2", SimpleNamespace(Translator=lambda *a, **k: None))
    monkeypatch.setitem(sys.modules, "sentencepiece", SimpleNamespace(SentencePieceProcessor=lambda **k: None))
    monkeypatch.delenv("PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL", raising=False)

    def write(source="en", target="de", version="1.3"):
        (tmp_path / "metadata.json").write_text(
            json.dumps({"from_code": source, "to_code": target, "package_version": version}),
            encoding="utf-8",
        )
        return tmp_path

    return write


def test_production_default_accepts_pinned_package(model):
    assert translate_payload({"text": "", "candidates": {}}, model()) == {"text": "", "candidates": {}}


@pytest.mark.parametrize("flag", [None, "", "0", "false", "no"])
def test_nonpinned_package_requires_explicit_opt_in(model, monkeypatch, flag):
    if flag is not None:
        monkeypatch.setenv("PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL", flag)
    with pytest.raises(ValueError, match="Unexpected translation model"):
        translate_payload({"text": "", "candidates": {}}, model(version="experiment-0.1"))


@pytest.mark.parametrize("flag", ["1", "true", " YES "])
def test_experimental_package_accepted_only_with_opt_in(model, monkeypatch, flag):
    monkeypatch.setenv("PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL", flag)
    assert translate_payload({"text": "", "candidates": {}}, model(version="experiment-0.1")) == {"text": "", "candidates": {}}


@pytest.mark.parametrize("source,target", [("de", "en"), ("ru", "de"), ("en", "uk")])
def test_opt_in_never_allows_wrong_language_pair(model, monkeypatch, source, target):
    monkeypatch.setenv("PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL", "1")
    with pytest.raises(ValueError, match="Unexpected translation model"):
        translate_payload({"text": "", "candidates": {}}, model(source, target))
