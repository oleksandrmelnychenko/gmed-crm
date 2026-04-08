use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// JWT Claims for access tokens.
///
/// Short-lived (15 min). Contains everything needed for stateless authz.
/// No DB lookup needed for every request — only for sensitive mutations.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    /// Subject: user ID
    pub sub: Uuid,
    /// User role (for fast RBAC checks without DB hit)
    pub role: String,
    /// Token family ID (to correlate with refresh token family)
    pub fam: Uuid,
    /// Issued at (unix timestamp)
    pub iat: i64,
    /// Expiration (unix timestamp)
    pub exp: i64,
    /// JWT ID (unique per token, for audit trail)
    pub jti: Uuid,
}

pub const DEFAULT_ACCESS_TOKEN_MINUTES: i64 = 15;

pub fn issue_access_token(
    secret: &str,
    user_id: Uuid,
    role: &str,
    family_id: Uuid,
) -> Result<String, jsonwebtoken::errors::Error> {
    issue_access_token_with_duration(
        secret,
        user_id,
        role,
        family_id,
        DEFAULT_ACCESS_TOKEN_MINUTES,
    )
}

pub fn issue_access_token_with_duration(
    secret: &str,
    user_id: Uuid,
    role: &str,
    family_id: Uuid,
    duration_minutes: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        role: role.to_string(),
        fam: family_id,
        iat: now.timestamp(),
        exp: (now + Duration::minutes(duration_minutes)).timestamp(),
        jti: Uuid::new_v4(),
    };

    jsonwebtoken::encode(
        &Header::new(Algorithm::HS512),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_access_token(
    secret: &str,
    token: &str,
) -> Result<TokenData<Claims>, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS512);
    validation.set_required_spec_claims(&["sub", "exp", "iat", "role", "fam", "jti"]);

    jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_and_verify_roundtrip() {
        let secret = "test-secret-at-least-32-chars-long!!";
        let user_id = Uuid::new_v4();
        let family_id = Uuid::new_v4();

        let token = issue_access_token(secret, user_id, "ceo", family_id).unwrap();
        let decoded = verify_access_token(secret, &token).unwrap();

        assert_eq!(decoded.claims.sub, user_id);
        assert_eq!(decoded.claims.role, "ceo");
        assert_eq!(decoded.claims.fam, family_id);
    }

    #[test]
    fn wrong_secret_fails() {
        let token = issue_access_token(
            "secret-one-long-enough-32chars!!",
            Uuid::new_v4(),
            "ceo",
            Uuid::new_v4(),
        )
        .unwrap();
        let result = verify_access_token("secret-two-long-enough-32chars!!", &token);
        assert!(result.is_err());
    }
}
