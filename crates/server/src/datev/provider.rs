use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{sync::OnceLock, time::Duration};

pub type Result<T> = std::result::Result<T, &'static str>;
pub const CALLBACK: &str = "/api/v1/datev/oauth/callback";
/// Example client ID from DATEV's public API reference; validates a request's shape before any company is known.
pub const REFERENCE_CLIENT_ID: &str = "29098-55003";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
    pub mode: String,
    pub redirect_uri: String,
    pub exchange_enabled: bool,
}

impl Credentials {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.mode.as_str(), "sandbox" | "production")
            || [self.client_id.as_str(), self.client_secret.as_str()]
                .iter()
                .any(|v| v.is_empty() || v.len() > 256 || v.chars().any(char::is_whitespace))
        {
            return Err("datev_configuration_invalid");
        }
        let url = Url::parse(&self.redirect_uri).map_err(|_| "datev_redirect_invalid")?;
        // Registration callback is restricted to GMed's own deployments, never supplied by a request header.
        let remote = url.scheme() == "https"
            && matches!(
                url.host_str(),
                Some("console.gmed-health.com" | "console-dev.gmed-health.com")
            )
            && url.port().is_none();
        let local = self.mode == "sandbox"
            && url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
        if !(remote || local)
            || url.path() != CALLBACK
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("datev_redirect_invalid");
        }
        Ok(())
    }
    pub fn issuer(&self) -> &'static str {
        if self.mode == "production" {
            "https://login.datev.de/openid"
        } else {
            "https://login.datev.de/openidsandbox"
        }
    }
    pub fn auth_base(&self) -> &'static str {
        if self.mode == "production" {
            "https://api.datev.de"
        } else {
            "https://sandbox-api.datev.de"
        }
    }
    pub fn scopes(&self) -> String {
        format!(
            "openid datev:accounting:clients{}",
            if self.exchange_enabled {
                " datev:accounting:exchange"
            } else {
                ""
            }
        )
    }
    // DATEV issues the two-year refresh token only for one company:
    // offline_access plus datev:iam:client:<consultant>-<client>.
    pub fn requested_scopes(&self, long_term: Option<(u32, u32)>) -> String {
        match long_term {
            Some((consultant, number)) => format!(
                "{} offline_access datev:iam:client:{consultant}-{number}",
                self.scopes()
            ),
            None => self.scopes(),
        }
    }
    pub fn authorize(
        &self,
        state: &str,
        nonce: &str,
        verifier: &str,
        long_term: Option<(u32, u32)>,
    ) -> Result<String> {
        self.validate()?;
        let mut url = Url::parse(&format!("{}/authorize", self.issuer()))
            .map_err(|_| "datev_configuration_invalid")?;
        url.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("scope", self.requested_scopes(long_term).as_str()),
            ("state", state),
            ("nonce", nonce),
            ("code_challenge", challenge(verifier).as_str()),
            ("code_challenge_method", "S256"),
        ]);
        Ok(url.to_string())
    }
    pub fn api_base(&self, exchange: bool) -> String {
        let platform = if self.mode == "production" {
            "platform"
        } else {
            "platform-sandbox"
        };
        if exchange {
            format!("https://accounting-data-exchange.api.datev.de/{platform}/v1")
        } else {
            format!("https://accounting-clients.api.datev.de/{platform}/v2")
        }
    }
}

pub fn random() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}
pub fn challenge(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}
pub fn client() -> Result<Client> {
    static CLIENT: OnceLock<Option<Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(Duration::from_secs(25))
                .connect_timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()
        })
        .clone()
        .ok_or("datev_unavailable")
}

// A 400 from the token endpoint is invalid_grant: the session is over.
// A 400 from a data API is a rejected request and says nothing about the session.
pub async fn body(mut response: reqwest::Response, limit: usize, token: bool) -> Result<Vec<u8>> {
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            400 if !token => "datev_request_rejected",
            400 | 401 => "datev_reconnect_required",
            403 => "datev_access_denied",
            404 => "datev_data_unavailable",
            429 => "datev_rate_limited",
            _ => "datev_unavailable",
        });
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("datev_response_too_large");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "datev_unavailable")? {
        if bytes.len() + chunk.len() > limit {
            return Err("datev_response_too_large");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[derive(Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

pub async fn exchange(c: &Credentials, fields: &[(&str, &str)]) -> Result<Tokens> {
    let encoded: String = reqwest::Url::parse_with_params("https://placeholder.invalid", fields)
        .map_err(|_| "datev_protocol_error")?
        .query()
        .unwrap_or("")
        .into();
    let response = client()?
        .post(format!("{}/token", c.auth_base()))
        .basic_auth(&c.client_id, Some(&c.client_secret))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(encoded)
        .send()
        .await
        // Never reached DATEV: a refresh token in this request was not consumed.
        .map_err(|e| {
            if e.is_connect() {
                "datev_unreachable"
            } else {
                "datev_unavailable"
            }
        })?;
    let tokens: Tokens = serde_json::from_slice(&body(response, 128 * 1024, true).await?)
        .map_err(|_| "datev_protocol_error")?;
    if !tokens.token_type.eq_ignore_ascii_case("bearer")
        || tokens.access_token.is_empty()
        || tokens.refresh_token.is_empty()
        || !(1..=86400).contains(&tokens.expires_in)
    {
        return Err("datev_protocol_error");
    }
    if let Some(scope) = &tokens.scope {
        let granted: Vec<_> = scope.split_whitespace().collect();
        if c.scopes().split_whitespace().any(|s| !granted.contains(&s)) {
            return Err("datev_scope_missing");
        }
    }
    Ok(tokens)
}

#[derive(Clone, Deserialize)]
struct Claims {
    nonce: String,
    sub: String,
    aud: Value,
    #[serde(default)]
    azp: Option<String>,
    #[serde(default)]
    at_hash: Option<String>,
}

pub async fn validate_identity(c: &Credentials, tokens: &Tokens, nonce: &str) -> Result<()> {
    let jwt = tokens.id_token.as_deref().ok_or("datev_identity_invalid")?;
    let response = client()?
        .get(format!("{}/certs", c.auth_base()))
        .send()
        .await
        .map_err(|_| "datev_unavailable")?;
    let keys: JwkSet = serde_json::from_slice(&body(response, 256 * 1024, false).await?)
        .map_err(|_| "datev_identity_invalid")?;
    validate_jwt(c, tokens, nonce, jwt, &keys)
}

fn validate_jwt(
    c: &Credentials,
    tokens: &Tokens,
    nonce: &str,
    jwt: &str,
    keys: &JwkSet,
) -> Result<()> {
    let header = decode_header(jwt).map_err(|_| "datev_identity_invalid")?;
    if header.alg != Algorithm::RS256 {
        return Err("datev_identity_invalid");
    }
    let key = keys
        .find(header.kid.as_deref().ok_or("datev_identity_invalid")?)
        .ok_or("datev_identity_invalid")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&c.client_id]);
    validation.set_issuer(&[c.issuer()]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    let claims = decode::<Claims>(
        jwt,
        &DecodingKey::from_jwk(key).map_err(|_| "datev_identity_invalid")?,
        &validation,
    )
    .map_err(|_| "datev_identity_invalid")?
    .claims;
    if claims.nonce != nonce
        || claims.sub.is_empty()
        || claims.azp.as_deref().is_some_and(|id| id != c.client_id)
        || (claims.aud.as_array().is_some_and(|aud| aud.len() > 1)
            && claims.azp.as_deref() != Some(c.client_id.as_str()))
    {
        return Err("datev_identity_invalid");
    }
    if let Some(hash) = claims.at_hash {
        let digest = Sha256::digest(tokens.access_token.as_bytes());
        if hash != URL_SAFE_NO_PAD.encode(&digest[..16]) {
            return Err("datev_identity_invalid");
        }
    }
    Ok(())
}

pub async fn revoke(c: &Credentials, tokens: &Tokens) -> Result<()> {
    let mut failed = false;
    for (token, hint) in [
        (&tokens.access_token, "access_token"),
        (&tokens.refresh_token, "refresh_token"),
    ] {
        let encoded = Url::parse_with_params(
            "https://placeholder.invalid",
            [("token", token.as_str()), ("token_type_hint", hint)],
        )
        .map_err(|_| "datev_protocol_error")?;
        let result = client()?
            .post(format!("{}/revoke", c.auth_base()))
            .basic_auth(&c.client_id, Some(&c.client_secret))
            .header("content-type", "application/x-www-form-urlencoded")
            .body(encoded.query().unwrap_or("").to_string())
            .send()
            .await;
        failed |= !matches!(result, Ok(r) if r.status().is_success());
    }
    if failed {
        Err("datev_revocation_unconfirmed")
    } else {
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
pub struct DatevClient {
    pub id: String,
    pub name: String,
    pub consultant_number: u32,
    pub client_number: u32,
    #[serde(default)]
    pub services: Vec<DatevService>,
}
#[derive(Serialize, Deserialize)]
pub struct DatevService {
    pub name: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

pub async fn get(c: &Credentials, access: &str, url: Url, limit: usize) -> Result<Vec<u8>> {
    let response = client()?
        .get(url)
        .bearer_auth(access)
        .header("X-DATEV-Client-Id", &c.client_id)
        .header("accept", "application/x-ndjson, application/json")
        .send()
        .await
        .map_err(|_| "datev_unavailable")?;
    body(response, limit, false).await
}

// The company is read by its path ID: a long-term token is bound to one
// company and DATEV rejects it on the unfiltered client list.
pub async fn company(
    c: &Credentials,
    access: &str,
    consultant: u32,
    number: u32,
) -> Result<Option<DatevClient>> {
    let id = format!("{consultant}-{number}");
    data_path("fiscal-years", &id, None)?;
    let url = Url::parse(&format!("{}/clients/{id}", c.api_base(false)))
        .map_err(|_| "datev_protocol_error")?;
    let bytes = match get(c, access, url, 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err("datev_data_unavailable") => return Ok(None),
        Err(error) => return Err(error),
    };
    let row: DatevClient = serde_json::from_slice(&bytes).map_err(|_| "datev_protocol_error")?;
    if row.consultant_number != consultant || row.client_number != number || row.id != id {
        return Err("datev_client_mismatch");
    }
    Ok(Some(row))
}

pub fn data_path(kind: &str, client_id: &str, year: Option<u32>) -> Result<String> {
    let parts: Vec<_> = client_id.split('-').collect();
    if parts.len() != 2
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
        || client_id.len() > 13
    {
        return Err("datev_client_mismatch");
    }
    if kind == "fiscal-years" {
        return Ok(format!("/clients/{client_id}/fiscal-years"));
    }
    if !matches!(kind, "terms-of-payment" | "sums-and-balances") {
        return Err("datev_operation_not_supported");
    }
    let year = year.ok_or("datev_fiscal_year_required")?;
    let date = chrono::NaiveDate::parse_from_str(&year.to_string(), "%Y%m%d")
        .map_err(|_| "datev_fiscal_year_invalid")?;
    if !(19920101..=20991231).contains(&year)
        || date.format("%Y%m%d").to_string() != year.to_string()
    {
        return Err("datev_fiscal_year_invalid");
    }
    Ok(format!("/clients/{client_id}/fiscal-years/{year}/{kind}"))
}

pub fn records(bytes: &[u8]) -> Result<Vec<Value>> {
    if bytes.is_empty() {
        return Ok(vec![]);
    }
    if let Ok(Value::Array(rows)) = serde_json::from_slice::<Value>(bytes) {
        return checked_records(rows);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "datev_protocol_error")?;
    let rows = text
        .lines()
        .filter(|s| !s.trim().is_empty())
        .map(serde_json::from_str)
        .collect::<std::result::Result<Vec<Value>, _>>()
        .map_err(|_| "datev_protocol_error")?;
    checked_records(rows)
}
fn checked_records(rows: Vec<Value>) -> Result<Vec<Value>> {
    if rows.len() > 10000 || rows.iter().any(|v| !v.is_object()) {
        Err("datev_protocol_error")
    } else {
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_identity_binds_issuer_audience_nonce_and_access_token() {
        // Public key and synthetic JWTs only; the ephemeral signing key was discarded.
        let fixture: Value = serde_json::from_str(include_str!("test-identity.json")).unwrap();
        let keys: JwkSet = serde_json::from_value(fixture["jwks"].clone()).unwrap();
        let tokens = Tokens {
            access_token: "test-access".into(),
            refresh_token: "test-refresh".into(),
            expires_in: 900,
            token_type: "Bearer".into(),
            id_token: None,
            scope: None,
        };
        for (name, jwt) in fixture["tokens"].as_object().unwrap() {
            let result = validate_jwt(
                &config(),
                &tokens,
                "test-nonce",
                jwt.as_str().unwrap(),
                &keys,
            );
            assert_eq!(
                result.is_ok(),
                matches!(name.as_str(), "valid" | "multi_valid"),
                "{name}"
            );
        }
    }
    fn config() -> Credentials {
        Credentials {
            client_id: "test-app".into(),
            client_secret: "secret".into(),
            mode: "sandbox".into(),
            redirect_uri: format!("http://localhost:5173{CALLBACK}"),
            exchange_enabled: true,
        }
    }
    #[test]
    fn authorization_uses_pkce_and_read_scopes() {
        let c = config();
        let long = c
            .authorize(&random(), &random(), "verifier", Some((29098, 55003)))
            .unwrap();
        assert!(long.contains("+offline_access+datev%3Aiam%3Aclient%3A29098-55003&"));
        let url =
            Url::parse(&c.authorize(&random(), &random(), "verifier", None).unwrap()).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["code_challenge"], challenge("verifier"));
        assert!(!url.as_str().contains("secret"));
        assert!(!pairs["scope"].contains("offline_access"));
        assert!(pairs["state"].len() >= 20 && pairs["nonce"].len() >= 20);
    }
    #[test]
    fn redirect_and_environment_boundaries() {
        let mut c = config();
        assert!(c.validate().is_ok());
        c.mode = "production".into();
        assert!(c.validate().is_err());
        c.redirect_uri = format!("https://console.gmed-health.com{CALLBACK}");
        assert!(c.validate().is_ok());
        c.redirect_uri = format!("https://console.gmed-health.com.evil.test{CALLBACK}");
        assert!(c.validate().is_err());
        assert_eq!(
            c.api_base(false),
            "https://accounting-clients.api.datev.de/platform/v2"
        );
    }
    #[test]
    fn only_documented_read_paths_are_allowed() {
        assert!(data_path("documents", "29098-55003", None).is_err());
        assert!(data_path("sums-and-balances", "29098-55003", Some(20260230)).is_err());
        assert!(data_path("fiscal-years", "../secret", None).is_err());
        assert_eq!(
            data_path("terms-of-payment", "29098-55003", Some(20260101)).unwrap(),
            "/clients/29098-55003/fiscal-years/20260101/terms-of-payment"
        );
    }
    #[test]
    fn ndjson_and_json_are_bounded_and_validated() {
        assert_eq!(records(b"{\"id\":1}\n{\"id\":2}\n").unwrap().len(), 2);
        assert_eq!(records(b"[{\"id\":1}]").unwrap().len(), 1);
        assert!(records(b"<html>error</html>").is_err());
        assert!(records(b"[null]").is_err());
        assert!(records(b"{\"id\":1}\ninvalid").is_err());
    }
}
