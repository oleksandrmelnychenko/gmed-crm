use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::Response,
    routing::{get, post},
};
use gmed_domain::role::Role;
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::{db_error, error, provider::Provider};
use crate::{audit, auth::middleware::AuthUser, state::AppState};

pub type Cache = Mutex<Option<(Uuid, Arc<Provider>)>>;
// Serialize configuration changes with outbox creation, across server processes.
pub(super) const CONFIG_LOCK: i64 = 5_481_913_420;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/document-signatures/connection", get(status).post(save))
        .route("/document-signatures/connection/check", post(check))
        .route(
            "/document-signatures/connection/disconnect",
            post(disconnect),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
}

pub async fn current_provider(state: &AppState) -> Result<Option<Arc<Provider>>, &'static str> {
    let row = sqlx::query("SELECT * FROM signature_provider_connection WHERE singleton=true")
        .fetch_optional(&state.db)
        .await
        .map_err(|_| "signature_connection_database_error")?;
    let Some(row) = row else {
        return Ok(state.document_signatures.clone());
    };
    if !row.get::<bool, _>("enabled") {
        return Ok(None);
    }
    let revision: Uuid = row.get("revision");
    let mut cached = state
        .document_signature_cache
        .lock()
        .map_err(|_| "signature_connection_unavailable")?;
    if let Some((cached_revision, provider)) = cached.as_ref()
        && *cached_revision == revision
    {
        return Ok(Some(provider.clone()));
    }
    let plaintext = state
        .message_keys
        .decrypt_to_string(
            &row.get::<String, _>("key_id"),
            &row.get::<Vec<u8>, _>("ciphertext"),
            &row.get::<Vec<u8>, _>("nonce"),
        )
        .map_err(|_| "signature_connection_decryption_failed")?;
    let credentials: StoredCredentials =
        serde_json::from_str(&plaintext).map_err(|_| "signature_connection_invalid")?;
    if credentials.service != "document-signatures-DE-v1" {
        return Err("signature_connection_invalid");
    }
    let provider = Arc::new(Provider::new(
        credentials.username,
        credentials.api_key.expose_secret().to_string(),
        &credentials.mode,
    )?);
    if provider.account != row.get::<String, _>("provider_account") {
        return Err("signature_connection_invalid");
    }
    *cached = Some((revision, provider.clone()));
    Ok(Some(provider))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCredentials {
    service: String,
    username: String,
    api_key: SecretString,
    mode: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    username: String,
    api_key: SecretString,
    mode: String,
}

fn require_admin(auth: &AuthUser) -> Result<(), Response> {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])
}

async fn info(state: &AppState) -> Result<Value, Response> {
    let provider = current_provider(state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?;
    let database_configured: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM signature_provider_connection)")
            .fetch_one(&state.db)
            .await
            .map_err(db_error)?;
    Ok(
        json!({"configured":provider.is_some(),"region":"DE","mode":provider.as_ref().map(|p| if p.test_mode {"demo"}else{"live"}).unwrap_or("demo"),
        "username":provider.as_ref().map(|p| p.username()),"source":if database_configured {"database"}else{"environment"}}),
    )
}
async fn status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    Ok(Json(info(&state).await?))
}

async fn save(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(mut body): Json<Credentials>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    body.username = body.username.trim().to_string();
    if body.username.len() > 200 || body.api_key.expose_secret().len() > 8192 {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_credentials_invalid",
        ));
    }
    let provider = Provider::new(
        body.username.clone(),
        body.api_key.expose_secret().to_string(),
        &body.mode,
    )
    .map_err(|_| {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_credentials_invalid",
        )
    })?;
    provider
        .check_connection()
        .await
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "signature_login_failed"))?;
    persist_connection(&state, &auth, provider, body).await?;
    Ok(Json(info(&state).await?))
}

async fn persist_connection(
    state: &AppState,
    auth: &AuthUser,
    provider: Provider,
    body: Credentials,
) -> Result<(), Response> {
    let plaintext = json!({"service":"document-signatures-DE-v1","username":body.username,"api_key":body.api_key.expose_secret(),"mode":body.mode});
    let (ciphertext, nonce, key_id) = state
        .message_keys
        .encrypt_str(&plaintext.to_string())
        .map_err(|_| {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "signature_encryption_failed",
            )
        })?;
    let revision = Uuid::new_v4();
    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CONFIG_LOCK)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    let conflicting: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM document_signature_requests WHERE status IN ('submitting','submission_unknown','pending') AND provider_account<>$1)")
        .bind(&provider.account).fetch_one(&mut *tx).await.map_err(db_error)?;
    if conflicting {
        return Err(error(
            StatusCode::CONFLICT,
            "signature_account_has_pending_requests",
        ));
    }
    sqlx::query("INSERT INTO signature_provider_connection(singleton,revision,enabled,provider_account,ciphertext,nonce,key_id,updated_by) VALUES(true,$1,true,$2,$3,$4,$5,$6) ON CONFLICT(singleton) DO UPDATE SET revision=EXCLUDED.revision,enabled=true,provider_account=EXCLUDED.provider_account,ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,key_id=EXCLUDED.key_id,updated_by=EXCLUDED.updated_by,updated_at=now()")
        .bind(revision).bind(&provider.account).bind(ciphertext).bind(nonce).bind(key_id).bind(auth.user_id).execute(&mut *tx).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    state.audit_sender.try_send(audit::domain_event(
        "signature_connection_saved",
        Some(auth.user_id),
        "signature_connection",
        None,
        json!({"region":"DE","test_mode":provider.test_mode}),
    ));
    if let Ok(mut cached) = state.document_signature_cache.lock() {
        *cached = Some((revision, Arc::new(provider)));
    }
    Ok(())
}

async fn check(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    let provider = current_provider(&state)
        .await
        .map_err(|e| error(StatusCode::SERVICE_UNAVAILABLE, e))?
        .ok_or_else(|| error(StatusCode::CONFLICT, "signature_not_configured"))?;
    provider
        .check_connection()
        .await
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "signature_login_failed"))?;
    Ok(Json(json!({"ok":true,"region":"DE"})))
}

async fn disconnect(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    let mut tx = state.db.begin().await.map_err(db_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CONFIG_LOCK)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM document_signature_requests WHERE status IN ('submitting','submission_unknown','pending'))")
        .fetch_one(&mut *tx).await.map_err(db_error)?;
    if pending {
        return Err(error(
            StatusCode::CONFLICT,
            "signature_account_has_pending_requests",
        ));
    }
    // A disabled row overrides env credentials, avoiding accidental reconnection on restart.
    sqlx::query("INSERT INTO signature_provider_connection(singleton,revision,enabled,updated_by) VALUES(true,$1,false,$2) ON CONFLICT(singleton) DO UPDATE SET revision=EXCLUDED.revision,enabled=false,provider_account=NULL,ciphertext=NULL,nonce=NULL,key_id=NULL,updated_by=EXCLUDED.updated_by,updated_at=now()")
        .bind(Uuid::new_v4()).bind(auth.user_id).execute(&mut *tx).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    if let Ok(mut cached) = state.document_signature_cache.lock() {
        *cached = None;
    }
    state.audit_sender.try_send(audit::domain_event(
        "signature_connection_disconnected",
        Some(auth.user_id),
        "signature_connection",
        None,
        json!({"region":"DE"}),
    ));
    Ok(Json(json!({"ok":true})))
}

#[cfg(test)]
pub(super) async fn test_save(
    state: &AppState,
    auth: &AuthUser,
    provider: Provider,
) -> Result<(), Response> {
    let credentials = Credentials {
        username: provider.username().to_string(),
        api_key: SecretString::from("test-only"),
        mode: if provider.test_mode { "demo" } else { "live" }.into(),
    };
    persist_connection(state, auth, provider, credentials).await
}
