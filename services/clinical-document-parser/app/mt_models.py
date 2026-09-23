"""Pinned OPUS-MT models for the offline translation service.

Kept separate from ``mt_engine`` so the Docker model-conversion stage only
rebuilds when this list (or the build script) changes.
"""
from __future__ import annotations

# key -> (HuggingFace repo, pinned revision). Converted at image build time.
MODELS: dict[str, tuple[str, str]] = {
    "de-zle": ("Helsinki-NLP/opus-mt-tc-big-de-zle", "d4db2a2cbaa6c2f1ea57d0ed40924d35767b05f9"),
    "zle-de": ("Helsinki-NLP/opus-mt-tc-big-zle-de", "b2e247f0c413ca6aa51a32f2f2be8666cf72405e"),
    "en-zle": ("Helsinki-NLP/opus-mt-tc-big-en-zle", "708be1d372fe4c358a352f404e6dc9ca0126ba48"),
    "zle-en": ("Helsinki-NLP/opus-mt-tc-big-zle-en", "09a40f722d6d8b76aaad6fe51a06c914622a13d1"),
    "de-en": ("Helsinki-NLP/opus-mt-de-en", "1a922f3b32a8e809e17a47d4b32142d8105924e5"),
    "en-de": ("Helsinki-NLP/opus-mt-en-de", "6183067f769a302e3861815543b9f312c71b0ca4"),
}
