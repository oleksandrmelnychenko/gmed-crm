"""Open uploaded document files sealed by the GMED backend.

Since 2026-09-19 the backend stores patient uploads encrypted at rest with the
message key registry (`crates/server/src/crypto.rs`): the file starts with
``GMEDENC1``, one byte with the key-id length, the key id, a 12-byte nonce and
the AES-256-GCM ciphertext. Files written before that stay plain and are
returned unchanged. The parser shares ``MESSAGE_ENCRYPTION_KEYS``
(``id:base64key,...``) with the backend; it never writes files.
"""
from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BLOB_MAGIC = b"GMEDENC1"
NONCE_LEN = 12
KEY_LEN = 32


class SealedBlobError(ValueError):
    """The file is sealed but cannot be opened; the message names no secrets."""


def parse_key_registry(raw: str | None) -> dict[str, bytes]:
    """Parses ``id:base64,id:base64`` into a key map; malformed entries fail loudly."""
    keys: dict[str, bytes] = {}
    for entry in (raw or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        key_id, separator, encoded = entry.partition(":")
        key_id = key_id.strip()
        if not separator or not key_id:
            raise SealedBlobError("MESSAGE_ENCRYPTION_KEYS entry is not in id:base64 format")
        try:
            key = base64.b64decode(encoded.strip(), validate=True)
        except (ValueError, TypeError) as exc:
            raise SealedBlobError(f"key {key_id} is not valid base64") from exc
        if len(key) != KEY_LEN:
            raise SealedBlobError(f"key {key_id} must decode to {KEY_LEN} bytes")
        keys[key_id] = key
    return keys


def _registry() -> dict[str, bytes]:
    return parse_key_registry(os.environ.get("MESSAGE_ENCRYPTION_KEYS"))


def is_sealed(data: bytes) -> bool:
    return data.startswith(BLOB_MAGIC)


def open_blob(data: bytes, keys: dict[str, bytes] | None = None) -> bytes:
    """Returns the plaintext of a sealed file, or the bytes unchanged when plain."""
    if not is_sealed(data):
        return data
    body = data[len(BLOB_MAGIC):]
    if not body:
        raise SealedBlobError("sealed document header is truncated")
    id_len = body[0]
    key_id_bytes = body[1 : 1 + id_len]
    if len(key_id_bytes) != id_len:
        raise SealedBlobError("sealed document header is truncated")
    try:
        key_id = key_id_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SealedBlobError("sealed document key id is invalid") from exc
    rest = body[1 + id_len :]
    if len(rest) < NONCE_LEN:
        raise SealedBlobError("sealed document nonce is missing")
    nonce, ciphertext = rest[:NONCE_LEN], rest[NONCE_LEN:]
    registry = keys if keys is not None else _registry()
    key = registry.get(key_id)
    if key is None:
        raise SealedBlobError(
            "sealed document uses a key the parser does not have; "
            "set MESSAGE_ENCRYPTION_KEYS to the backend's registry"
        )
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, None)
    except InvalidTag as exc:
        raise SealedBlobError("sealed document failed authentication") from exc
