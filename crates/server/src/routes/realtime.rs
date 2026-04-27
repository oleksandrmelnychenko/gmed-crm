use axum::{
    Json, Router,
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message as WsMessage, WebSocket},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use sqlx::Row;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::{AuthUser, auth_user_from_access_token};
use crate::realtime::RealtimeEvent;
use crate::state::AppState;
use gmed_domain::role::Role;

const REPLAY_BATCH_LIMIT: i64 = 250;
const REPLAY_TOTAL_LIMIT: usize = 1_000;

pub fn public_router() -> Router<AppState> {
    Router::new().route("/events/ws", get(events_ws))
}

#[derive(Deserialize)]
struct EventsSocketQuery {
    token: String,
    #[serde(default)]
    last_seq: Option<i64>,
}

async fn events_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<EventsSocketQuery>,
) -> axum::response::Response {
    let auth = match auth_user_from_access_token(&state, query.token.trim()).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let last_seq = query.last_seq.unwrap_or_default().max(0);

    ws.on_upgrade(move |socket| handle_events_ws(socket, state, auth, last_seq))
        .into_response()
}

async fn handle_events_ws(mut socket: WebSocket, state: AppState, auth: AuthUser, last_seq: i64) {
    let mut receiver = state.realtime_events.subscribe();
    let mut cursor_seq = last_seq;

    let connected = serde_json::json!({
        "type": "realtime.connected",
        "entity_type": "realtime",
        "entity_id": auth.user_id,
        "payload": {
            "replay_after_seq": cursor_seq,
        },
        "occurred_at": chrono::Utc::now().to_rfc3339(),
    });
    if socket
        .send(WsMessage::Text(connected.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    if !replay_events_after(&mut socket, &state, &auth, &mut cursor_seq).await {
        return;
    }

    loop {
        let event = match receiver.recv().await {
            Ok(event) => event,
            Err(broadcast::error::RecvError::Lagged(_)) => {
                if !replay_events_after(&mut socket, &state, &auth, &mut cursor_seq).await {
                    break;
                }
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        };

        if let Some(seq) = event.seq {
            if seq <= cursor_seq {
                continue;
            }
            cursor_seq = seq;
        }

        match can_receive_event(&state, &auth, &event).await {
            Ok(true) => {
                if !send_event(&mut socket, &event).await {
                    break;
                }
            }
            Ok(false) => {}
            Err(response) => {
                tracing::warn!(
                    status = ?response.status(),
                    user_id = %auth.user_id,
                    event_id = %event.id,
                    event_type = %event.event_type,
                    "failed to evaluate realtime event visibility"
                );
            }
        }
    }
}

async fn replay_events_after(
    socket: &mut WebSocket,
    state: &AppState,
    auth: &AuthUser,
    cursor_seq: &mut i64,
) -> bool {
    let mut scanned = 0usize;

    loop {
        if scanned >= REPLAY_TOTAL_LIMIT {
            return send_resync_required(socket, auth, Some(*cursor_seq)).await;
        }

        let remaining = REPLAY_TOTAL_LIMIT - scanned;
        let limit = REPLAY_BATCH_LIMIT.min(remaining as i64);
        let events =
            match crate::realtime::load_realtime_events_after(state, *cursor_seq, limit).await {
                Ok(events) => events,
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        user_id = %auth.user_id,
                        cursor_seq = *cursor_seq,
                        "failed to replay realtime events"
                    );
                    return send_resync_required(socket, auth, Some(*cursor_seq)).await;
                }
            };

        if events.is_empty() {
            return true;
        }

        let batch_len = events.len();
        scanned += batch_len;

        for event in events {
            if let Some(seq) = event.seq {
                *cursor_seq = (*cursor_seq).max(seq);
            }

            match can_receive_event(state, auth, &event).await {
                Ok(true) => {
                    if !send_event(socket, &event).await {
                        return false;
                    }
                }
                Ok(false) => {}
                Err(response) => {
                    tracing::warn!(
                        status = ?response.status(),
                        user_id = %auth.user_id,
                        event_id = %event.id,
                        event_type = %event.event_type,
                        "failed to evaluate replayed realtime event visibility"
                    );
                }
            }
        }

        if batch_len < limit as usize {
            return true;
        }
    }
}

async fn send_event(socket: &mut WebSocket, event: &RealtimeEvent) -> bool {
    let Ok(payload) = serde_json::to_string(event) else {
        return true;
    };
    socket.send(WsMessage::Text(payload.into())).await.is_ok()
}

async fn send_resync_required(
    socket: &mut WebSocket,
    auth: &AuthUser,
    cursor_seq: Option<i64>,
) -> bool {
    let resync = serde_json::json!({
        "type": "realtime.resync_required",
        "entity_type": "realtime",
        "entity_id": auth.user_id,
        "seq": cursor_seq,
        "payload": {
            "cursor_seq": cursor_seq,
        },
        "occurred_at": chrono::Utc::now().to_rfc3339(),
    });
    socket
        .send(WsMessage::Text(resync.to_string().into()))
        .await
        .is_ok()
}

#[allow(clippy::result_large_err)]
async fn can_receive_event(
    state: &AppState,
    auth: &AuthUser,
    event: &RealtimeEvent,
) -> Result<bool, axum::response::Response> {
    if event.target_user_ids.contains(&auth.user_id) {
        return Ok(true);
    }

    let Some(role_name) = access::role_db_name(auth.role) else {
        return Ok(false);
    };
    if event.role_names.iter().any(|role| role == role_name) {
        return Ok(true);
    }

    match event.entity_type.as_str() {
        "patient" => {
            let patient_id = event.patient_id.unwrap_or(event.entity_id);
            can_receive_patient_event(state, auth, patient_id).await
        }
        "appointment" => can_receive_appointment_event(state, auth, event.entity_id).await,
        "appointment_request" => {
            if let Some(patient_id) = event.patient_id {
                can_receive_patient_event(state, auth, patient_id).await
            } else {
                Ok(false)
            }
        }
        "concierge_service" => {
            if let Some(patient_id) = event.patient_id {
                can_receive_patient_event(state, auth, patient_id).await
            } else {
                can_receive_concierge_service_event(state, auth, event.entity_id).await
            }
        }
        "document"
        | "invoice"
        | "privacy_request"
        | "feedback"
        | "task"
        | "workflow_checklist_item"
        | "appointment_checklist"
        | "reminder" => {
            if let Some(patient_id) = event.patient_id {
                can_receive_patient_event(state, auth, patient_id).await
            } else {
                Ok(false)
            }
        }
        "order" => can_receive_order_event(state, auth, event).await,
        "framework_contract" | "quote" => can_receive_contract_event(state, auth, event).await,
        "case" => can_receive_case_event(state, auth, event).await,
        "provider" => Ok(matches!(
            auth.role,
            Role::Ceo | Role::PatientManager | Role::Concierge | Role::Billing | Role::Sales
        )),
        "lead" => Ok(matches!(
            auth.role,
            Role::Ceo | Role::PatientManager | Role::Sales
        )),
        "user"
        | "system_setting"
        | "security"
        | "access_policy"
        | "custom_field"
        | "notification_channel"
        | "session"
        | "pending_login" => Ok(matches!(auth.role, Role::Ceo | Role::ItAdmin)),
        "announcement" => Ok(true),
        "message_peer" => Ok(false),
        "notification" => Ok(false),
        _ => Ok(false),
    }
}

async fn can_receive_patient_event(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<bool, axum::response::Response> {
    match auth.role {
        Role::Ceo | Role::CeoAssistant | Role::Billing => Ok(true),
        Role::PatientManager | Role::TeamleadInterpreter | Role::Interpreter | Role::Concierge => {
            access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, patient_id = %patient_id, "check realtime patient access");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
                })
        }
        _ => Ok(false),
    }
}

async fn can_receive_appointment_event(
    state: &AppState,
    auth: &AuthUser,
    appointment_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(true);
    }
    if !matches!(
        auth.role,
        Role::PatientManager | Role::TeamleadInterpreter | Role::Interpreter | Role::Concierge
    ) {
        return Ok(false);
    }

    let row =
        sqlx::query("SELECT patient_id, interpreter_id, owner_user_id FROM appointments WHERE id = $1")
            .bind(appointment_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, appointment_id = %appointment_id, "check realtime appointment access");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
            })?;

    let Some(row) = row else {
        return Ok(false);
    };

    let interpreter_id: Option<Uuid> = row.try_get("interpreter_id").unwrap_or_default();
    if matches!(auth.role, Role::Interpreter | Role::TeamleadInterpreter)
        && interpreter_id == Some(auth.user_id)
    {
        return Ok(true);
    }

    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    if matches!(
        auth.role,
        Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge
    ) && owner_user_id == Some(auth.user_id)
    {
        return Ok(true);
    }

    let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate event access",
        )
    })?;

    if access::requires_patient_assignment(auth.role) {
        access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, appointment_id = %appointment_id, "check realtime appointment assignment");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
            })
    } else {
        Ok(false)
    }
}

async fn can_receive_concierge_service_event(
    state: &AppState,
    auth: &AuthUser,
    service_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::Billing) {
        return Ok(true);
    }

    let row = sqlx::query(
        "SELECT patient_id, assigned_concierge_id FROM concierge_services WHERE id = $1",
    )
    .bind(service_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, service_id = %service_id, "check realtime concierge service access");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
    })?;

    let Some(row) = row else {
        return Ok(false);
    };

    let assigned_concierge_id: Option<Uuid> =
        row.try_get("assigned_concierge_id").unwrap_or_default();
    if auth.role == Role::Concierge && assigned_concierge_id == Some(auth.user_id) {
        return Ok(true);
    }

    let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate event access",
        )
    })?;

    can_receive_patient_event(state, auth, patient_id).await
}

async fn can_receive_order_event(
    state: &AppState,
    auth: &AuthUser,
    event: &RealtimeEvent,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::Billing) {
        return Ok(true);
    }
    if !matches!(auth.role, Role::Patient) && !access::requires_patient_assignment(auth.role) {
        return Ok(false);
    }

    let Some(patient_id) = event.patient_id else {
        return Ok(false);
    };

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "check realtime order assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
        })
}

async fn can_receive_contract_event(
    state: &AppState,
    auth: &AuthUser,
    event: &RealtimeEvent,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing) {
        return Ok(true);
    }
    if auth.role != Role::PatientManager {
        return Ok(false);
    }

    let Some(patient_id) = event.patient_id else {
        return Ok(false);
    };

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "check realtime contract assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
        })
}

async fn can_receive_case_event(
    state: &AppState,
    auth: &AuthUser,
    event: &RealtimeEvent,
) -> Result<bool, axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(true);
    }
    if auth.role != Role::PatientManager {
        return Ok(false);
    }

    let row = sqlx::query("SELECT patient_id, manager_id FROM cases WHERE id = $1")
        .bind(event.entity_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, case_id = %event.entity_id, "check realtime case access");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate event access",
            )
        })?;

    let Some(row) = row else {
        return Ok(false);
    };

    let manager_id: Option<Uuid> = row.try_get("manager_id").unwrap_or_default();
    if manager_id == Some(auth.user_id) {
        return Ok(true);
    }

    let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate event access",
        )
    })?;

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, case_id = %event.entity_id, "check realtime case assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate event access")
        })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message})),
    )
        .into_response()
}
