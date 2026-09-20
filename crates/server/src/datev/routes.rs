use super::provider::{self, Credentials, Tokens};
use crate::{audit, auth::middleware::AuthUser, state::AppState};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use gmed_domain::access::capabilities::Capability;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

type Result<T> = std::result::Result<T, Response>;
const COOKIE: &str = "gmed_datev_oauth";

#[derive(Clone)]
struct FailureCode(&'static str);

fn outcome<T>(result: &Result<T>) -> &'static str {
    match result {
        Ok(_) => "success",
        Err(response) => response
            .extensions()
            .get::<FailureCode>()
            .map_or("failed", |v| v.0),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/datev/connection", get(status).put(configure))
        .route("/admin/datev/authorize", post(authorize))
        .route("/admin/datev/disconnect", post(disconnect))
        .route("/admin/datev/check", post(check))
        .route("/admin/datev/read", post(read))
        .route("/admin/datev/events", get(events))
        .layer(DefaultBodyLimit::max(8 * 1024))
}
pub fn public_router() -> Router<AppState> {
    Router::new().route("/datev/oauth/callback", get(callback))
}

fn err(code: &'static str) -> Response {
    let status = match code {
        "datev_not_configured"
        | "datev_reconnect_required"
        | "datev_connection_changed"
        | "datev_disconnect_first"
        | "datev_check_required"
        | "datev_company_bound"
        | "datev_profile_required" => StatusCode::CONFLICT,
        "datev_access_denied" | "datev_client_mismatch" => StatusCode::FORBIDDEN,
        "datev_configuration_invalid"
        | "datev_confirmation_required"
        | "datev_redirect_invalid"
        | "datev_operation_not_supported"
        | "datev_fiscal_year_required"
        | "datev_fiscal_year_invalid" => StatusCode::UNPROCESSABLE_ENTITY,
        "datev_rate_limited" => StatusCode::TOO_MANY_REQUESTS,
        _ => StatusCode::BAD_GATEWAY,
    };
    let mut response = (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({"error": code})),
    )
        .into_response();
    response.extensions_mut().insert(FailureCode(code));
    response
}
fn db(_: sqlx::Error) -> Response {
    err("datev_storage_unavailable")
}
fn admin(auth: &AuthUser) -> Result<()> {
    auth.require_capability(Capability::DatevAdmin)
}
fn output(value: Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}

fn seal<T: Serialize>(
    state: &AppState,
    purpose: &str,
    value: &T,
) -> Result<(Vec<u8>, Vec<u8>, String)> {
    state
        .message_keys
        .encrypt_str(&json!({"purpose":purpose,"value":value}).to_string())
        .map_err(|_| err("datev_encryption_failed"))
}
fn unseal<T: DeserializeOwned>(
    state: &AppState,
    row: &PgRow,
    prefix: &str,
    purpose: &str,
) -> Result<T> {
    let value = state
        .message_keys
        .decrypt_to_string(
            &row.get::<String, _>(format!("{prefix}key_id").as_str()),
            &row.get::<Vec<u8>, _>(format!("{prefix}ciphertext").as_str()),
            &row.get::<Vec<u8>, _>(format!("{prefix}nonce").as_str()),
        )
        .map_err(|_| err("datev_decryption_failed"))?;
    let envelope: Value =
        serde_json::from_str(&value).map_err(|_| err("datev_decryption_failed"))?;
    if envelope["purpose"] != purpose {
        return Err(err("datev_decryption_failed"));
    }
    serde_json::from_value(envelope["value"].clone()).map_err(|_| err("datev_decryption_failed"))
}
async fn connection(state: &AppState) -> Result<PgRow> {
    sqlx::query("SELECT * FROM datev_read_connection WHERE singleton")
        .fetch_optional(&state.db)
        .await
        .map_err(db)?
        .ok_or_else(|| err("datev_not_configured"))
}
async fn event(state: &AppState, actor: Uuid, operation: &str, outcome: &str, count: usize) {
    let saved = sqlx::query("INSERT INTO datev_read_events (id, actor_id, operation, outcome, record_count) VALUES ($1,$2,$3,$4,$5)")
        .bind(Uuid::new_v4()).bind(actor).bind(operation).bind(outcome).bind(count as i32).execute(&state.db).await;
    if saved.is_err() {
        tracing::warn!("DATEV operation history could not be saved");
    }
    // The screen shows the latest 50 rows; the permanent record is the audit event below.
    let _ =
        sqlx::query("DELETE FROM datev_read_events WHERE created_at < now() - interval '400 days'")
            .execute(&state.db)
            .await;
    state.audit_sender.try_send(audit::domain_event(
        "datev_read_operation",
        Some(actor),
        "datev_connection",
        None,
        json!({"operation":operation,"outcome":outcome,"record_count":count}),
    ));
}
// DATEV ends a standard session 11 hours after sign-in, however often it is refreshed.
fn session_end(row: &PgRow) -> Option<DateTime<Utc>> {
    if row.get::<bool, _>("long_term")
        || row.get::<Option<Vec<u8>>, _>("token_ciphertext").is_none()
    {
        return None;
    }
    row.get::<Option<DateTime<Utc>>, _>("connected_at")
        .map(|t| t + chrono::Duration::hours(11))
}
fn summary(row: &PgRow) -> Value {
    json!({"configured":true,"revision":row.get::<Uuid,_>("revision").to_string(),"generation":row.get::<Uuid,_>("generation").to_string(),"mode":row.get::<String,_>("mode"),
        "redirect_uri":row.get::<String,_>("redirect_uri"),"exchange_enabled":row.get::<bool,_>("exchange_enabled"),
        "status":row.get::<String,_>("status"),"has_tokens":row.get::<Option<Vec<u8>>,_>("token_ciphertext").is_some(),
        "expires_at":row.get::<Option<DateTime<Utc>>,_>("expires_at").map(|t|t.to_rfc3339()),
        "checked_at":row.get::<Option<DateTime<Utc>>,_>("checked_at").map(|t|t.to_rfc3339()),
        "checked_consultant":row.get::<Option<i32>,_>("checked_consultant"),
        "checked_client":row.get::<Option<i32>,_>("checked_client"),
        "long_term":row.get::<bool,_>("long_term"),
        "bound_consultant":row.get::<Option<i32>,_>("bound_consultant"),
        "bound_client":row.get::<Option<i32>,_>("bound_client"),
        "session_expires_at":session_end(row).map(|t|t.to_rfc3339()),
        "accounting_writes_enabled":false,"invoice_originals_supported":false})
}
async fn status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Response> {
    admin(&auth)?;
    let row = sqlx::query("SELECT * FROM datev_read_connection WHERE singleton")
        .fetch_optional(&state.db)
        .await
        .map_err(db)?;
    Ok(output(row.as_ref().map(summary).unwrap_or_else(||json!({"configured":false,"status":"not_configured","has_tokens":false,"accounting_writes_enabled":false,"invoice_originals_supported":false}))))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    revision: Option<Uuid>,
    generation: Option<Uuid>,
    credentials: Credentials,
}
async fn configure(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(request): Json<Save>,
) -> Result<Response> {
    admin(&auth)?;
    if request.revision.is_some() != request.generation.is_some() {
        return Err(err("datev_confirmation_required"));
    }
    request.credentials.validate().map_err(err)?;
    let (ct, nonce, key) = seal(&state, "datev-credentials-v1", &request.credentials)?;
    let revision = Uuid::new_v4();
    let c = request.credentials;
    let row = if let Some(expected) = request.revision {
        sqlx::query("UPDATE datev_read_connection SET revision=$1, generation=$1, mode=$2, redirect_uri=$3, exchange_enabled=$4, ciphertext=$5, nonce=$6, key_id=$7, status='disconnected', checked_at=NULL, checked_consultant=NULL, checked_client=NULL, long_term=false, bound_consultant=NULL, bound_client=NULL, connected_at=NULL, expires_at=NULL, updated_at=now() WHERE singleton AND revision=$8 AND generation=$9 AND token_ciphertext IS NULL AND status <> 'revocation_pending' RETURNING *")
            .bind(revision).bind(&c.mode).bind(&c.redirect_uri).bind(c.exchange_enabled).bind(ct).bind(nonce).bind(key).bind(expected).bind(request.generation).fetch_optional(&state.db).await.map_err(db)?
    } else {
        sqlx::query("INSERT INTO datev_read_connection (revision,generation,mode,redirect_uri,exchange_enabled,ciphertext,nonce,key_id) VALUES ($1,$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *")
            .bind(revision).bind(&c.mode).bind(&c.redirect_uri).bind(c.exchange_enabled).bind(ct).bind(nonce).bind(key).fetch_optional(&state.db).await.map_err(db)?
    }.ok_or_else(|| err("datev_connection_changed"))?;
    event(&state, auth.user_id, "configure", "saved", 0).await;
    Ok(output(summary(&row)))
}

#[derive(Serialize, Deserialize)]
struct Pending {
    verifier: String,
    nonce: String,
    // Company a long-term authorization was requested for.
    #[serde(default)]
    bound: Option<(u32, u32)>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectionTarget {
    revision: Uuid,
    generation: Uuid,
    mode: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectionAction {
    expected: ConnectionTarget,
    // authorize: request DATEV's two-year token for the checked company.
    #[serde(default)]
    long_term: bool,
    // disconnect: after an unconfirmed revocation, discard the tokens locally.
    #[serde(default)]
    force: bool,
}
fn match_connection(row: &PgRow, expected: &ConnectionTarget) -> Result<()> {
    if row.get::<Uuid, _>("revision") != expected.revision
        || row.get::<Uuid, _>("generation") != expected.generation
        || row.get::<String, _>("mode") != expected.mode
    {
        return Err(err("datev_connection_changed"));
    }
    Ok(())
}
async fn authorize(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    request: std::result::Result<Json<ConnectionAction>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    admin(&auth)?;
    let Json(request) = request.map_err(|_| err("datev_confirmation_required"))?;
    if request.force {
        return Err(err("datev_confirmation_required"));
    }
    let result = authorize_inner(&state, auth.user_id, &request.expected, request.long_term).await;
    event(
        &state,
        auth.user_id,
        "authorize",
        if result.is_ok() {
            "started"
        } else {
            outcome(&result)
        },
        0,
    )
    .await;
    result
}
async fn authorize_inner(
    state: &AppState,
    actor: Uuid,
    expected: &ConnectionTarget,
    long_term: bool,
) -> Result<Response> {
    // Keep configuration changes outside the short transaction that creates
    // the pending authorization. No external request is made while locked.
    let mut tx = state.db.begin().await.map_err(db)?;
    let row = sqlx::query("SELECT * FROM datev_read_connection WHERE singleton FOR UPDATE")
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or_else(|| err("datev_not_configured"))?;
    match_connection(&row, expected)?;
    if row.get::<Option<Vec<u8>>, _>("token_ciphertext").is_some()
        || row.get::<String, _>("status") == "revocation_pending"
    {
        return Err(err("datev_disconnect_first"));
    }
    let c: Credentials = unseal(state, &row, "", "datev-credentials-v1")?;
    // DATEV requires access to the company to be verified before a long-term
    // token is requested; the token is then bound to exactly that company.
    let bound = if long_term {
        let profile: Option<Value> =
            sqlx::query_scalar("SELECT profile FROM datev_integration_setup WHERE singleton")
                .fetch_optional(&mut *tx)
                .await
                .map_err(db)?;
        let company = numbers(&profile.ok_or_else(|| err("datev_profile_required"))?)?;
        let checked = (
            row.get::<Option<i32>, _>("checked_consultant"),
            row.get::<Option<i32>, _>("checked_client"),
        );
        if checked != (Some(company.0 as i32), Some(company.1 as i32)) {
            return Err(err("datev_check_required"));
        }
        Some(company)
    } else {
        None
    };
    let state_value = provider::random();
    let browser = provider::random();
    let pending = Pending {
        verifier: provider::random(),
        nonce: provider::random(),
        bound,
    };
    let url = c
        .authorize(&state_value, &pending.nonce, &pending.verifier, bound)
        .map_err(err)?;
    let (ct, nonce, key) = seal(state, "datev-pending-v1", &pending)?;
    sqlx::query("DELETE FROM datev_oauth_pending WHERE expires_at < now() OR actor_id=$1")
        .bind(actor)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("INSERT INTO datev_oauth_pending (state_hash,browser_hash,actor_id,revision,generation,ciphertext,nonce,key_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')")
        .bind(provider::challenge(&state_value)).bind(provider::challenge(&browser)).bind(actor).bind(row.get::<Uuid,_>("revision")).bind(row.get::<Uuid,_>("generation"))
        .bind(ct).bind(nonce).bind(key).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let secure = if c.redirect_uri.starts_with("https:") {
        "; Secure"
    } else {
        ""
    };
    let cookie = format!(
        "{COOKIE}={browser}; Path={}; HttpOnly; SameSite=Lax; Max-Age=600{secure}",
        provider::CALLBACK
    );
    let mut response = output(json!({"authorization_url":url}));
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(|_| err("datev_configuration_invalid"))?,
    );
    Ok(response)
}

#[derive(Deserialize)]
struct Callback {
    state: Option<String>,
    code: Option<String>,
    error: Option<String>,
}
async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<Callback>,
) -> Response {
    let result = finish_callback(&state, &headers, query).await;
    let outcome = if result.is_ok() {
        "connected"
    } else {
        "failed"
    };
    let mut response =
        Redirect::to(&format!("/admin/datev?datev_result={outcome}")).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_static("gmed_datev_oauth=; Path=/api/v1/datev/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0"));
    response
}
async fn finish_callback(state: &AppState, headers: &HeaderMap, query: Callback) -> Result<()> {
    let value = query
        .state
        .as_ref()
        .filter(|s| (20..=128).contains(&s.len()))
        .ok_or_else(|| err("datev_state_invalid"))?;
    let cookie = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .find_map(|s| s.trim().strip_prefix("gmed_datev_oauth="))
        })
        .filter(|s| s.len() == 43)
        .ok_or_else(|| err("datev_state_invalid"))?;
    // Consume before any network call; retries cannot redeem an authorization code twice.
    let pending = sqlx::query("DELETE FROM datev_oauth_pending WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *")
        .bind(provider::challenge(value)).bind(provider::challenge(cookie)).fetch_optional(&state.db).await.map_err(db)?.ok_or_else(||err("datev_state_invalid"))?;
    let actor: Uuid = pending.get("actor_id");
    let result = finish_exchange(state, &pending, actor, query).await;
    event(
        state,
        actor,
        "authorize",
        if result.is_ok() {
            "connected"
        } else {
            outcome(&result)
        },
        0,
    )
    .await;
    result
}
async fn finish_exchange(
    state: &AppState,
    pending: &PgRow,
    actor: Uuid,
    query: Callback,
) -> Result<()> {
    let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND is_active AND NOT password_reset_required AND role::text IN ('ceo','it_admin'))").bind(actor).fetch_one(&state.db).await.map_err(db)?;
    if !allowed || query.error.is_some() {
        return Err(err("datev_access_denied"));
    }
    let code = query
        .code
        .filter(|s| !s.is_empty() && s.len() <= 8192)
        .ok_or_else(|| err("datev_code_invalid"))?;
    let row = connection(state).await?;
    if row.get::<Uuid, _>("revision") != pending.get::<Uuid, _>("revision")
        || row.get::<Uuid, _>("generation") != pending.get::<Uuid, _>("generation")
    {
        return Err(err("datev_connection_changed"));
    }
    let c: Credentials = unseal(state, &row, "", "datev-credentials-v1")?;
    let p: Pending = unseal(state, pending, "", "datev-pending-v1")?;
    let mut tokens = provider::exchange(
        &c,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &c.redirect_uri),
            ("code_verifier", &p.verifier),
        ],
    )
    .await
    .map_err(err)?;
    if let Err(error) = provider::validate_identity(&c, &tokens, &p.nonce).await {
        let _ = provider::revoke(&c, &tokens).await;
        return Err(err(error));
    }
    tokens.id_token = None;
    // Without a granted offline_access this is an ordinary 11-hour session.
    let bound = p.bound.filter(|_| {
        tokens
            .scope
            .as_deref()
            .is_none_or(|scope| scope.split_whitespace().any(|s| s == "offline_access"))
    });
    if let Err(error) = store_tokens(
        state,
        &row,
        row.get("generation"),
        &tokens,
        Some((actor, bound)),
    )
    .await
    {
        let _ = provider::revoke(&c, &tokens).await;
        return Err(error);
    }
    Ok(())
}
async fn store_tokens(
    state: &AppState,
    row: &PgRow,
    expected: Uuid,
    tokens: &Tokens,
    // A new sign-in names its actor and company binding; a refresh keeps both.
    sign_in: Option<(Uuid, Option<(u32, u32)>)>,
) -> Result<Uuid> {
    let (ct, nonce, key) = seal(state, "datev-tokens-v1", tokens)?;
    let generation = Uuid::new_v4();
    let bound = sign_in.and_then(|(_, bound)| bound);
    let count = sqlx::query("UPDATE datev_read_connection SET token_ciphertext=$1, token_nonce=$2, token_key_id=$3, expires_at=now()+make_interval(secs => $4), status='connected', generation=$5, connected_by=COALESCE($8,connected_by), connected_at=CASE WHEN $9 THEN now() ELSE connected_at END, long_term=CASE WHEN $9 THEN $10 ELSE long_term END, bound_consultant=CASE WHEN $9 THEN $11 ELSE bound_consultant END, bound_client=CASE WHEN $9 THEN $12 ELSE bound_client END, updated_at=now() WHERE singleton AND revision=$6 AND generation=$7")
        .bind(ct).bind(nonce).bind(key).bind(tokens.expires_in as f64).bind(generation).bind(row.get::<Uuid,_>("revision")).bind(expected).bind(sign_in.map(|(actor, _)| actor))
        .bind(sign_in.is_some()).bind(bound.is_some()).bind(bound.map(|b| b.0 as i32)).bind(bound.map(|b| b.1 as i32))
        .execute(&state.db).await.map_err(db)?.rows_affected();
    if count != 1 {
        return Err(err("datev_connection_changed"));
    }
    Ok(generation)
}
async fn access(state: &AppState, row: &PgRow) -> Result<(Credentials, String, Uuid)> {
    if row.get::<String, _>("status") != "connected"
        || row.get::<Option<Vec<u8>>, _>("token_ciphertext").is_none()
    {
        return Err(err("datev_reconnect_required"));
    }
    let c: Credentials = unseal(state, row, "", "datev-credentials-v1")?;
    let tokens: Tokens = unseal(state, row, "token_", "datev-tokens-v1")?;
    let generation: Uuid = row.get("generation");
    if row
        .get::<Option<DateTime<Utc>>, _>("expires_at")
        .is_some_and(|t| t > Utc::now() + chrono::Duration::seconds(60))
    {
        return Ok((c, tokens.access_token, generation));
    }
    // Persist consumption before refresh. A crash or ambiguous timeout must never replay DATEV's single-use refresh token.
    let claimed = Uuid::new_v4();
    let count = sqlx::query("UPDATE datev_read_connection SET token_ciphertext=NULL, token_nonce=NULL, token_key_id=NULL, status='reconnect_required', generation=$1 WHERE singleton AND generation=$2")
        .bind(claimed).bind(generation).execute(&state.db).await.map_err(db)?.rows_affected();
    if count != 1 {
        return Err(err("datev_connection_changed"));
    }
    let mut renewed = match provider::exchange(
        &c,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", &tokens.refresh_token),
        ],
    )
    .await
    {
        Ok(renewed) => renewed,
        Err("datev_unreachable") => {
            // No connection was made, so DATEV never saw the refresh token: put it back.
            let _ = sqlx::query("UPDATE datev_read_connection SET token_ciphertext=$1, token_nonce=$2, token_key_id=$3, status='connected', generation=$4 WHERE singleton AND generation=$5")
                .bind(row.get::<Vec<u8>, _>("token_ciphertext")).bind(row.get::<Vec<u8>, _>("token_nonce")).bind(row.get::<String, _>("token_key_id"))
                .bind(Uuid::new_v4()).bind(claimed).execute(&state.db).await;
            return Err(err("datev_unavailable"));
        }
        Err(error) => return Err(err(error)),
    };
    renewed.id_token = None;
    let next = match store_tokens(state, row, claimed, &renewed, None).await {
        Ok(next) => next,
        Err(error) => {
            let _ = provider::revoke(&c, &renewed).await;
            return Err(error);
        }
    };
    Ok((c, renewed.access_token, next))
}

async fn disconnect(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    request: std::result::Result<Json<ConnectionAction>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    admin(&auth)?;
    let Json(request) = request.map_err(|_| err("datev_confirmation_required"))?;
    if request.long_term {
        return Err(err("datev_confirmation_required"));
    }
    let result = disconnect_inner(&state, &request.expected, request.force).await;
    let saved = match &result {
        Ok((_, true)) => "disconnected",
        Ok((_, false)) => "disconnected_unconfirmed",
        Err(_) => outcome(&result),
    };
    event(&state, auth.user_id, "disconnect", saved, 0).await;
    result.map(|(response, _)| response)
}
// Returns whether DATEV confirmed the revocation.
async fn disconnect_inner(
    state: &AppState,
    expected: &ConnectionTarget,
    force: bool,
) -> Result<(Response, bool)> {
    let row = connection(state).await?;
    match_connection(&row, expected)?;
    // Forcing is the way out only after a normal disconnect already failed.
    let force = force && row.get::<String, _>("status") == "revocation_pending";
    let generation = Uuid::new_v4();
    let count = sqlx::query("UPDATE datev_read_connection SET generation=$1,status='revocation_pending',checked_at=NULL WHERE singleton AND generation=$2")
        .bind(generation).bind(row.get::<Uuid,_>("generation")).execute(&state.db).await.map_err(db)?.rows_affected();
    if count != 1 {
        return Err(err("datev_connection_changed"));
    }
    let mut confirmed = true;
    if row.get::<Option<Vec<u8>>, _>("token_ciphertext").is_some() {
        let revoked = async {
            let c: Credentials = unseal(state, &row, "", "datev-credentials-v1")?;
            let tokens: Tokens = unseal(state, &row, "token_", "datev-tokens-v1")?;
            provider::revoke(&c, &tokens).await.map_err(err)
        }
        .await;
        match revoked {
            Ok(()) => {}
            // Unreadable tokens or a changed app secret would otherwise block
            // the connection for good. The user revokes access at DATEV instead.
            Err(_) if force => confirmed = false,
            Err(error) => return Err(error),
        }
    }
    let row = sqlx::query("UPDATE datev_read_connection SET status='disconnected', token_ciphertext=NULL, token_nonce=NULL, token_key_id=NULL, expires_at=NULL, connected_by=NULL, connected_at=NULL, long_term=false, bound_consultant=NULL, bound_client=NULL WHERE singleton AND generation=$1 RETURNING *")
        .bind(generation).fetch_optional(&state.db).await.map_err(db)?
        .ok_or_else(|| err("datev_connection_changed"))?;
    let mut value = summary(&row);
    value["revocation_confirmed"] = json!(confirmed);
    Ok((output(value), confirmed))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfirmedTarget {
    revision: Uuid,
    generation: Uuid,
    mode: String,
    profile_revision: Uuid,
    consultant_number: u32,
    client_number: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Check {
    expected: ConfirmedTarget,
}

fn numbers(p: &Value) -> Result<(u32, u32)> {
    let consultant = p["consultant_number"]
        .as_str()
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n > 0 && *n <= 9999999)
        .ok_or_else(|| err("datev_profile_required"))?;
    let number = p["client_number"]
        .as_str()
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n > 0 && *n <= 99999)
        .ok_or_else(|| err("datev_profile_required"))?;
    Ok((consultant, number))
}
// Read both revisions in one snapshot. Always use these credentials and this
// company for the operation; never reload a different target after confirmation.
async fn confirmed_connection(
    state: &AppState,
    expected: &ConfirmedTarget,
    generation: Uuid,
) -> Result<PgRow> {
    let row = sqlx::query("SELECT c.*, s.revision AS profile_revision, s.profile FROM datev_read_connection c LEFT JOIN datev_integration_setup s ON s.singleton WHERE c.singleton")
        .fetch_optional(&state.db).await.map_err(db)?
        .ok_or_else(|| err("datev_not_configured"))?;
    if row.get::<Uuid, _>("revision") != expected.revision
        || row.get::<Uuid, _>("generation") != generation
        || row.get::<String, _>("mode") != expected.mode
        || row.get::<Option<Uuid>, _>("profile_revision") != Some(expected.profile_revision)
    {
        return Err(err("datev_connection_changed"));
    }
    let profile = row
        .get::<Option<Value>, _>("profile")
        .ok_or_else(|| err("datev_profile_required"))?;
    let company = numbers(&profile)?;
    if company != (expected.consultant_number, expected.client_number) {
        return Err(err("datev_connection_changed"));
    }
    // A long-term token only ever works for the company it was issued for.
    let bound = (
        row.get::<Option<i32>, _>("bound_consultant"),
        row.get::<Option<i32>, _>("bound_client"),
    );
    if row.get::<bool, _>("long_term") && bound != (Some(company.0 as i32), Some(company.1 as i32))
    {
        return Err(err("datev_company_bound"));
    }
    Ok(row)
}
async fn ensure_current(
    state: &AppState,
    expected: &ConfirmedTarget,
    generation: Uuid,
) -> Result<()> {
    let row = confirmed_connection(state, expected, generation).await?;
    if row.get::<String, _>("status") != "connected" {
        return Err(err("datev_connection_changed"));
    }
    Ok(())
}
async fn check(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    request: std::result::Result<Json<Check>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    admin(&auth)?;
    let Json(request) = request.map_err(|_| err("datev_confirmation_required"))?;
    let result = check_inner(&state, &request.expected).await;
    event(&state, auth.user_id, "check", outcome(&result), 0).await;
    result
}
async fn check_inner(state: &AppState, expected: &ConfirmedTarget) -> Result<Response> {
    let row = confirmed_connection(state, expected, expected.generation).await?;
    let selected = (expected.consultant_number, expected.client_number);
    let (c, token, generation) = access(state, &row).await?;
    ensure_current(state, expected, generation).await?;
    let company = provider::company(&c, &token, selected.0, selected.1)
        .await
        .map_err(err)?;
    ensure_current(state, expected, generation).await?;
    let rows = [company.ok_or_else(|| err("datev_access_denied"))?];
    sqlx::query(
        "UPDATE datev_read_connection SET checked_at=now(), checked_consultant=$2, checked_client=$3 WHERE singleton AND generation=$1",
    )
    .bind(generation)
    .bind(selected.0 as i32)
    .bind(selected.1 as i32)
    .execute(&state.db)
    .await
    .map_err(db)?;
    Ok(output(
        json!({"mode":c.mode,"checked_at":Utc::now().to_rfc3339(),"clients":rows,"invoice_originals_supported":false,"accounting_writes_enabled":false}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Read {
    kind: String,
    fiscal_year: Option<u32>,
    expected: ConfirmedTarget,
}
async fn read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    request: std::result::Result<Json<Read>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    // Technical administration does not grant access to financial records.
    auth.require_capability(Capability::DatevRead)?;
    let Json(request) = request.map_err(|_| err("datev_confirmation_required"))?;
    provider::data_path(
        &request.kind,
        provider::REFERENCE_CLIENT_ID,
        request.fiscal_year,
    )
    .map_err(err)?;
    let result = read_inner(&state, &request).await;
    let count = result
        .as_ref()
        .ok()
        .and_then(|v| v["records"].as_array())
        .map_or(0, Vec::len);
    event(&state, auth.user_id, &request.kind, outcome(&result), count).await;
    result.map(output)
}
async fn read_inner(state: &AppState, request: &Read) -> Result<Value> {
    let expected = &request.expected;
    let row = confirmed_connection(state, expected, expected.generation).await?;
    let selected = (expected.consultant_number, expected.client_number);
    let (c, token, generation) = access(state, &row).await?;
    if !c.exchange_enabled {
        return Err(err("datev_scope_missing"));
    }
    ensure_current(state, expected, generation).await?;
    let company = provider::company(&c, &token, selected.0, selected.1)
        .await
        .map_err(err)?
        .ok_or_else(|| err("datev_access_denied"))?;
    ensure_current(state, expected, generation).await?;
    let path = provider::data_path(&request.kind, &company.id, request.fiscal_year).map_err(err)?;
    let url = reqwest::Url::parse(&format!("{}{path}", c.api_base(true)))
        .map_err(|_| err("datev_protocol_error"))?;
    let bytes = provider::get(&c, &token, url, 8 * 1024 * 1024)
        .await
        .map_err(err)?;
    let records = provider::records(&bytes).map_err(err)?;
    ensure_current(state, expected, generation).await?;
    Ok(
        json!({"source":"DATEV","mode":c.mode,"kind":request.kind,"fiscal_year":request.fiscal_year,
        "company":company.name,"consultant_number":selected.0,"client_number":selected.1,"retrieved_at":Utc::now().to_rfc3339(),
        "records":records,"accounting_writes_performed":false,"invoice_originals_included":false}),
    )
}
async fn events(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Response> {
    admin(&auth)?;
    let rows = sqlx::query("SELECT operation,outcome,record_count,created_at FROM datev_read_events ORDER BY created_at DESC LIMIT 50").fetch_all(&state.db).await.map_err(db)?;
    Ok(output(json!(rows.iter().map(|r|json!({"operation":r.get::<String,_>("operation"),"outcome":r.get::<String,_>("outcome"),"record_count":r.get::<i32,_>("record_count"),"created_at":r.get::<DateTime<Utc>,_>("created_at").to_rfc3339()})).collect::<Vec<_>>())))
}
