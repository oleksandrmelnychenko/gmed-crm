use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};

/// Hash a password with Argon2id (OWASP 2025 recommended).
///
/// Params: Argon2id, m=19456 KiB (19 MiB), t=2 iterations, p=1 parallelism.
/// These match the OWASP minimum recommendation and balance security vs latency.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default(); // Argon2id with safe defaults
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

/// Verify a password against a stored Argon2id hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool, argon2::password_hash::Error> {
    let parsed_hash = PasswordHash::new(hash)?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify() {
        let password = "my-secure-password-123!";
        let hash = hash_password(password).unwrap();

        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("wrong-password", &hash).unwrap());
    }

    #[test]
    fn different_salts_produce_different_hashes() {
        let password = "same-password";
        let hash1 = hash_password(password).unwrap();
        let hash2 = hash_password(password).unwrap();
        assert_ne!(hash1, hash2); // different salts
    }
}
