import base64
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.blob_envelope import BLOB_MAGIC, SealedBlobError, open_blob, parse_key_registry


def seal(plaintext: bytes, key_id: str, key: bytes, nonce: bytes = b"\x01" * 12) -> bytes:
    """Mirrors `KeyRegistry::seal_blob` in crates/server/src/crypto.rs."""
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    key_bytes = key_id.encode()
    return BLOB_MAGIC + bytes([len(key_bytes)]) + key_bytes + nonce + ciphertext


KEY_V1 = bytes(range(32))
KEY_V2 = bytes(reversed(range(32)))
PDF = b"%PDF-1.7\n%synthetic\n"


def test_plain_files_pass_through_unchanged():
    assert open_blob(PDF, {"v1": KEY_V1}) == PDF


def test_sealed_file_is_opened_with_the_key_named_in_its_header():
    sealed = seal(PDF, "v2", KEY_V2)
    assert open_blob(sealed, {"v1": KEY_V1, "v2": KEY_V2}) == PDF


def test_missing_or_wrong_key_fails_without_leaking_secrets():
    sealed = seal(PDF, "v2", KEY_V2)
    with pytest.raises(SealedBlobError) as missing:
        open_blob(sealed, {"v1": KEY_V1})
    assert "v2" not in str(missing.value) or "key" in str(missing.value)
    with pytest.raises(SealedBlobError):
        open_blob(sealed, {"v2": KEY_V1})
    with pytest.raises(SealedBlobError):
        open_blob(BLOB_MAGIC + b"\x02v", {"v2": KEY_V2})


def test_registry_env_format_matches_the_backend(monkeypatch):
    raw = "v2:" + base64.b64encode(KEY_V2).decode() + ", v1:" + base64.b64encode(KEY_V1).decode()
    assert parse_key_registry(raw) == {"v1": KEY_V1, "v2": KEY_V2}
    with pytest.raises(SealedBlobError):
        parse_key_registry("v1")
    with pytest.raises(SealedBlobError):
        parse_key_registry("v1:" + base64.b64encode(b"short").decode())
    monkeypatch.setenv("MESSAGE_ENCRYPTION_KEYS", raw)
    assert open_blob(seal(PDF, "v1", KEY_V1)) == PDF
    monkeypatch.delenv("MESSAGE_ENCRYPTION_KEYS")
    os.environ.pop("MESSAGE_ENCRYPTION_KEYS", None)
    with pytest.raises(SealedBlobError):
        open_blob(seal(PDF, "v1", KEY_V1))
