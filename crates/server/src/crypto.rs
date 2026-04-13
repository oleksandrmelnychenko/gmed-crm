//! AES-256-GCM message encryption with named-key rotation support.
//!
//! Operational model:
//! - A `KeyRegistry` holds many keys, each with a short string id (`v1`, `v2`,
//!   `legacy`). One id is marked "active" and used for all new encryption.
//! - Every ciphertext is paired with its key id (stored on the same DB row).
//!   Decryption looks up the key by id, so old rows keep working after a key
//!   rotation.
//! - To rotate: load both old and new keys, flip active to the new id,
//!   restart, then run the rewrap sweep to migrate stored rows. After the
//!   sweep finishes the old key can be removed from the registry.
//!
//! True forward secrecy (per-message ephemeral keys) is not achievable with
//! server-side encryption — the server has to decrypt to serve reads. What
//! this module provides is the next-best thing: time-bounded keys plus a
//! crash-safe rotation path, so a compromise of the current key only exposes
//! traffic since the last rotation.
//!
//! Env format (all base64-encoded 32-byte keys):
//! ```text
//! MESSAGE_ENCRYPTION_KEYS=v2:BASE64KEY,v1:BASE64KEY
//! MESSAGE_ENCRYPTION_KEY_ACTIVE=v2          # optional, defaults to first
//! MESSAGE_ENCRYPTION_KEY=BASE64KEY          # legacy single-key fallback
//! ```

use std::collections::HashMap;

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, OsRng, rand_core::RngCore},
};

pub const NONCE_LEN: usize = 12;

/// Id used for rows that were encrypted before the registry existed.
pub const LEGACY_KEY_ID: &str = "legacy";

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed")]
    Decrypt,
    #[error("nonce must be {NONCE_LEN} bytes")]
    BadNonce,
    #[error("unknown encryption key id: {0}")]
    UnknownKeyId(String),
}

#[derive(Debug, thiserror::Error)]
pub enum KeyRegistryError {
    #[error("MESSAGE_ENCRYPTION_KEYS is empty")]
    Empty,
    #[error("entry {0} is not in `id:base64` format")]
    BadEntry(String),
    #[error("key {0} is not valid base64: {1}")]
    BadBase64(String, String),
    #[error("key {0} must decode to exactly 32 bytes, got {1}")]
    BadLength(String, usize),
    #[error("active key id `{0}` is not present in the registry")]
    UnknownActive(String),
    #[error("duplicate key id: {0}")]
    Duplicate(String),
}

#[derive(Clone)]
struct KeyEntry {
    cipher: Aes256Gcm,
}

pub struct KeyRegistry {
    entries: HashMap<String, KeyEntry>,
    active: String,
}

impl KeyRegistry {
    /// Builds a registry from `(id, raw_key_bytes)` pairs.
    pub fn from_pairs(
        pairs: Vec<(String, [u8; 32])>,
        active: String,
    ) -> Result<Self, KeyRegistryError> {
        if pairs.is_empty() {
            return Err(KeyRegistryError::Empty);
        }
        let mut entries = HashMap::new();
        for (id, key) in pairs {
            if entries.contains_key(&id) {
                return Err(KeyRegistryError::Duplicate(id));
            }
            entries.insert(
                id,
                KeyEntry {
                    cipher: Aes256Gcm::new((&key).into()),
                },
            );
        }
        if !entries.contains_key(&active) {
            return Err(KeyRegistryError::UnknownActive(active));
        }
        Ok(Self { entries, active })
    }

    /// Builds a registry by reading env vars. See module docs for format.
    pub fn from_env() -> Result<Self, KeyRegistryError> {
        use base64::{Engine as _, engine::general_purpose::STANDARD};

        let mut pairs: Vec<(String, [u8; 32])> = Vec::new();
        let mut first_id: Option<String> = None;

        if let Ok(multi) = std::env::var("MESSAGE_ENCRYPTION_KEYS") {
            for entry in multi.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                let (id, b64) = entry
                    .split_once(':')
                    .ok_or_else(|| KeyRegistryError::BadEntry(entry.to_string()))?;
                let id = id.trim().to_string();
                let bytes = STANDARD
                    .decode(b64.trim())
                    .map_err(|e| KeyRegistryError::BadBase64(id.clone(), e.to_string()))?;
                if bytes.len() != 32 {
                    return Err(KeyRegistryError::BadLength(id, bytes.len()));
                }
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                if first_id.is_none() {
                    first_id = Some(id.clone());
                }
                pairs.push((id, key));
            }
        }

        // Backward-compat: bare MESSAGE_ENCRYPTION_KEY counts as the legacy id.
        if let Ok(legacy) = std::env::var("MESSAGE_ENCRYPTION_KEY") {
            let bytes = STANDARD.decode(legacy.trim()).map_err(|e| {
                KeyRegistryError::BadBase64(LEGACY_KEY_ID.to_string(), e.to_string())
            })?;
            if bytes.len() != 32 {
                return Err(KeyRegistryError::BadLength(
                    LEGACY_KEY_ID.to_string(),
                    bytes.len(),
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            // Only insert legacy if it isn't already in MESSAGE_ENCRYPTION_KEYS.
            if !pairs.iter().any(|(id, _)| id == LEGACY_KEY_ID) {
                pairs.push((LEGACY_KEY_ID.to_string(), key));
                if first_id.is_none() {
                    first_id = Some(LEGACY_KEY_ID.to_string());
                }
            }
        }

        let active = std::env::var("MESSAGE_ENCRYPTION_KEY_ACTIVE")
            .ok()
            .or(first_id)
            .ok_or(KeyRegistryError::Empty)?;

        Self::from_pairs(pairs, active)
    }

    /// Returns the id new ciphertexts should be sealed with.
    pub fn active_id(&self) -> &str {
        &self.active
    }

    /// Returns true if the given key id is the active one.
    pub fn is_active(&self, id: &str) -> bool {
        id == self.active
    }

    /// All known ids, useful for status reporting.
    pub fn known_ids(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    fn get(&self, id: &str) -> Result<&Aes256Gcm, CryptoError> {
        self.entries
            .get(id)
            .map(|e| &e.cipher)
            .ok_or_else(|| CryptoError::UnknownKeyId(id.to_string()))
    }

    /// Encrypts plaintext with the active key. Returns `(ciphertext, nonce, key_id)`.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>, String), CryptoError> {
        let cipher = self.get(&self.active)?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| CryptoError::Encrypt)?;
        Ok((ct, nonce_bytes.to_vec(), self.active.clone()))
    }

    pub fn encrypt_str(&self, plaintext: &str) -> Result<(Vec<u8>, Vec<u8>, String), CryptoError> {
        self.encrypt(plaintext.as_bytes())
    }

    /// Decrypts using the key id stored alongside the ciphertext.
    pub fn decrypt(
        &self,
        key_id: &str,
        ciphertext: &[u8],
        nonce: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        if nonce.len() != NONCE_LEN {
            return Err(CryptoError::BadNonce);
        }
        let cipher = self.get(key_id)?;
        let nonce = Nonce::from_slice(nonce);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| CryptoError::Decrypt)
    }

    pub fn decrypt_to_string(
        &self,
        key_id: &str,
        ciphertext: &[u8],
        nonce: &[u8],
    ) -> Result<String, CryptoError> {
        let bytes = self.decrypt(key_id, ciphertext, nonce)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_with(active: &str, pairs: &[(&str, [u8; 32])]) -> KeyRegistry {
        KeyRegistry::from_pairs(
            pairs
                .iter()
                .map(|(id, key)| ((*id).to_string(), *key))
                .collect(),
            active.to_string(),
        )
        .unwrap()
    }

    #[test]
    fn roundtrip_active_key() {
        let reg = registry_with("v1", &[("v1", [7u8; 32])]);
        let (ct, nonce, key_id) = reg.encrypt_str("hello світ").unwrap();
        assert_eq!(key_id, "v1");
        let pt = reg.decrypt_to_string(&key_id, &ct, &nonce).unwrap();
        assert_eq!(pt, "hello світ");
    }

    #[test]
    fn rotation_preserves_old_reads() {
        // v1 is the original key; encrypt a row.
        let reg_v1 = registry_with("v1", &[("v1", [7u8; 32])]);
        let (ct, nonce, key_id) = reg_v1.encrypt_str("yesterday").unwrap();

        // Operator adds v2 and flips active. Old key still in registry.
        let reg_v2 = registry_with("v2", &[("v2", [9u8; 32]), ("v1", [7u8; 32])]);
        // New writes use v2.
        let (_, _, new_id) = reg_v2.encrypt_str("today").unwrap();
        assert_eq!(new_id, "v2");
        // But the old row still decrypts via its stored key id.
        let pt = reg_v2.decrypt_to_string(&key_id, &ct, &nonce).unwrap();
        assert_eq!(pt, "yesterday");
    }

    #[test]
    fn unknown_key_id_fails() {
        let reg = registry_with("v1", &[("v1", [7u8; 32])]);
        let (ct, nonce, _) = reg.encrypt_str("x").unwrap();
        let result = reg.decrypt("v999", &ct, &nonce);
        assert!(matches!(result, Err(CryptoError::UnknownKeyId(_))));
    }

    #[test]
    fn cross_key_decrypt_fails() {
        // A row encrypted with v1 cannot be decrypted by claiming key id v2.
        let reg = registry_with("v2", &[("v1", [7u8; 32]), ("v2", [9u8; 32])]);
        let (ct, nonce, _) = reg.encrypt_str("secret").unwrap();
        // ct was produced with active=v2; lying that it's v1 must fail.
        assert!(reg.decrypt("v1", &ct, &nonce).is_err());
    }

    #[test]
    fn tamper_fails() {
        let reg = registry_with("v1", &[("v1", [7u8; 32])]);
        let (mut ct, nonce, key_id) = reg.encrypt_str("authentic").unwrap();
        ct[0] ^= 0xFF;
        assert!(reg.decrypt(&key_id, &ct, &nonce).is_err());
    }

    #[test]
    fn wrong_nonce_fails() {
        let reg = registry_with("v1", &[("v1", [7u8; 32])]);
        let (ct, _, key_id) = reg.encrypt_str("x").unwrap();
        let bad = [0u8; NONCE_LEN];
        assert!(reg.decrypt(&key_id, &ct, &bad).is_err());
    }

    #[test]
    fn different_nonces_each_call() {
        let reg = registry_with("v1", &[("v1", [7u8; 32])]);
        let (_, n1, _) = reg.encrypt_str("same text").unwrap();
        let (_, n2, _) = reg.encrypt_str("same text").unwrap();
        assert_ne!(n1, n2);
    }

    #[test]
    fn empty_registry_rejected() {
        let result = KeyRegistry::from_pairs(Vec::new(), "v1".into());
        assert!(matches!(result, Err(KeyRegistryError::Empty)));
    }

    #[test]
    fn unknown_active_rejected() {
        let result = KeyRegistry::from_pairs(vec![("v1".into(), [0u8; 32])], "v999".into());
        assert!(matches!(result, Err(KeyRegistryError::UnknownActive(_))));
    }

    #[test]
    fn duplicate_id_rejected() {
        let result = KeyRegistry::from_pairs(
            vec![("v1".into(), [0u8; 32]), ("v1".into(), [1u8; 32])],
            "v1".into(),
        );
        assert!(matches!(result, Err(KeyRegistryError::Duplicate(_))));
    }
}
