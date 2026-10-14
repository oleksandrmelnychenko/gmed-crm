//! Lead cabinet interest requests. No package assignment, activation or billing.
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{audit, auth::middleware::AuthUser, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/me/lead-requests/{lead_id}/plan-requests",
        get(list).post(create),
    )
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn failure(error: sqlx::Error) -> axum::response::Response {
    tracing::error!(%error, "lead portal plan request");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to save or load the request",
    )
}

// If price history exists it defines current availability; an expired version
// must not fall back to an old, open-ended catalog row. No prices are offered here.
const PACKAGES_SQL: &str = r#"SELECT sp.id, sp.package_key, sp.name, sp.description
    FROM service_packages sp
    WHERE sp.is_active AND (
        EXISTS (SELECT 1 FROM service_package_price_versions v WHERE v.package_id = sp.id
            AND v.valid_from <= CURRENT_DATE AND (v.valid_to IS NULL OR v.valid_to >= CURRENT_DATE))
        OR (NOT EXISTS (SELECT 1 FROM service_package_price_versions v WHERE v.package_id = sp.id)
            AND sp.valid_from <= CURRENT_DATE AND (sp.valid_to IS NULL OR sp.valid_to >= CURRENT_DATE))
    ) ORDER BY sp.package_key, sp.id"#;

async fn packages(conn: &mut PgConnection) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(PACKAGES_SQL).fetch_all(conn).await?;
    let mut packages = Vec::new();
    for row in rows {
        let key: String = row.try_get("package_key")?;
        let kind = super::service_packages::subscription_kind(&key);
        if kind != "other" {
            packages.push(json!({
                "id": row.try_get::<Uuid, _>("id")?, "package_key": key,
                "name": row.try_get::<String, _>("name")?,
                "description": row.try_get::<Option<String>, _>("description")?, "kind": kind,
            }));
        }
    }
    Ok(packages)
}

const REQUESTS_SQL: &str = r#"SELECT r.id, r.package_id, r.package_name, r.subscription_kind,
    r.module_id, r.requested_at, CASE WHEN r.status = 'closed'
        OR t.status IN ('completed', 'cancelled') OR t.deleted_at IS NOT NULL
        THEN 'closed' ELSE 'pending' END AS status
    FROM lead_portal_plan_requests r JOIN tasks t ON t.id = r.task_id
    WHERE r.lead_id = $1 AND r.requested_by = $2 ORDER BY r.requested_at DESC, r.id"#;

async fn requests(
    conn: &mut PgConnection,
    lead: Uuid,
    user: Uuid,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query(REQUESTS_SQL)
        .bind(lead)
        .bind(user)
        .fetch_all(conn)
        .await?
        .into_iter()
        .map(|row| {
            Ok(json!({
                "id": row.try_get::<Uuid, _>("id")?,
                "package_id": row.try_get::<Uuid, _>("package_id")?,
                "package_name": row.try_get::<String, _>("package_name")?,
                "subscription_kind": row.try_get::<String, _>("subscription_kind")?,
                "module_id": row.try_get::<String, _>("module_id")?,
                "requested_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("requested_at")?,
                "status": row.try_get::<String, _>("status")?,
            }))
        })
        .collect()
}

/// Lead deletion anonymises the row in place, so the FK cascade alone is not
/// sufficient. Cancel outstanding work and remove the preference and links in
/// the same transaction as the lead purge. Completed task status/history stay.
pub(crate) async fn erase_for_lead_in_tx(
    conn: &mut PgConnection,
    lead: Uuid,
) -> Result<(), sqlx::Error> {
    let tasks: Vec<Uuid> = sqlx::query_scalar(
        "SELECT t.id FROM lead_portal_plan_requests r JOIN tasks t ON t.id=r.task_id
         JOIN leads l ON l.id=r.lead_id
         WHERE r.lead_id=$1 AND l.converted_patient_id IS NULL FOR UPDATE OF t",
    )
    .bind(lead)
    .fetch_all(&mut *conn)
    .await?;
    if tasks.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE tasks SET title='Anonymisierte Portalanfrage',description=NULL,
             status=CASE WHEN status IN ('completed','cancelled') THEN status ELSE 'cancelled' END
         WHERE id=ANY($1)",
    )
    .bind(&tasks)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM realtime_events WHERE entity_type='task' AND entity_id=ANY($1)")
        .bind(&tasks)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM user_notifications WHERE kind='lead_portal_plan_request' AND entity_type='lead' AND entity_id=$1")
        .bind(lead).execute(&mut *conn).await?;
    sqlx::query("DELETE FROM lead_portal_plan_requests WHERE lead_id=$1")
        .bind(lead)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = super::lead_portal_intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return failure(error),
    };
    match super::lead_portal_intake::lock_my_lead(&mut tx, lead, auth.user_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Request not found"),
        Err(error) => return failure(error),
    }
    let payload = async {
        Ok::<_, sqlx::Error>(json!({
            "packages": packages(&mut tx).await?, "requests": requests(&mut tx, lead, auth.user_id).await?,
        }))
    }.await;
    match payload {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => failure(error),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    package_id: Uuid,
    module_id: String,
}

fn valid_module(module: &str) -> bool {
    matches!(
        module,
        "dashboard"
            | "notifications"
            | "chat"
            | "appointments"
            | "recommendations"
            | "documents"
            | "services"
            | "subscriptions"
            | "invoices"
            | "feedback"
            | "privacy"
    )
}

async fn create(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead): Path<Uuid>,
    Json(body): Json<CreateRequest>,
) -> axum::response::Response {
    if let Err(response) = super::lead_portal_intake::require_patient(&auth) {
        return response;
    }
    if !valid_module(&body.module_id) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown portal module");
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return failure(error),
    };
    let access = match super::lead_portal_intake::lock_my_lead(&mut tx, lead, auth.user_id).await {
        Ok(Some((access, _))) => access,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Request not found"),
        Err(error) => return failure(error),
    };
    // Catalog edits lock this same row before changing versions. Keep the
    // selected name/availability stable until the interest receipt is stored.
    match sqlx::query_scalar::<_, Uuid>("SELECT id FROM service_packages WHERE id=$1 FOR SHARE")
        .bind(body.package_id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "The selected package is not currently available",
            );
        }
        Err(error) => return failure(error),
    }
    let available = match packages(&mut tx).await {
        Ok(items) => items,
        Err(error) => return failure(error),
    };
    let Some(package) = available
        .into_iter()
        .find(|item| item["id"] == body.package_id.to_string())
    else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The selected package is not currently available",
        );
    };
    // The lead lock serializes concurrent clicks, including the close-and-retry
    // transition. The partial unique index also protects the pending invariant.
    let pending = match requests(&mut tx, lead, auth.user_id).await {
        Ok(items) => items,
        Err(error) => return failure(error),
    };
    if let Some(request) = pending.into_iter().find(|item| {
        item["package_id"] == body.package_id.to_string()
            && item["module_id"] == body.module_id
            && item["status"] == "pending"
    }) {
        return Json(json!({ "request": request, "created": false })).into_response();
    }
    let stored = async {
        sqlx::query("UPDATE lead_portal_plan_requests r SET status='closed' FROM tasks t
            WHERE r.task_id=t.id AND r.lead_id=$1 AND r.requested_by=$2 AND r.status='pending'
              AND (t.status IN ('completed','cancelled') OR t.deleted_at IS NOT NULL)")
            .bind(lead).bind(auth.user_id).execute(&mut *tx).await?;
        // Same recipient policy as cabinet submissions: owner and patient
        // managers, CEO fallback. One task has one responsible assignee.
        let recipients: Vec<Uuid> = sqlx::query_scalar("WITH owner AS (
                SELECT u.id, 0 AS priority FROM leads l JOIN users u ON u.id=l.created_by
                WHERE l.id=$1 AND u.is_active AND u.role<>'patient'
            ), managers AS (SELECT id, 1 AS priority FROM users WHERE is_active AND role='patient_manager'),
            fallback AS (SELECT id, 2 AS priority FROM users WHERE is_active AND role='ceo'
                AND NOT EXISTS(SELECT 1 FROM owner) AND NOT EXISTS(SELECT 1 FROM managers))
            SELECT id FROM (SELECT * FROM owner UNION ALL SELECT * FROM managers UNION ALL SELECT * FROM fallback) r
            GROUP BY id ORDER BY min(priority), id")
            .bind(lead).fetch_all(&mut *tx).await?;
        let Some(assigned_to) = recipients.first().copied() else { return Ok(None); };
        let name = package["name"].as_str().unwrap_or_default();
        let kind = package["kind"].as_str().unwrap_or_default();
        let title = format!("Tarifanfrage: {name}");
        let description = format!("Anfrage aus dem Portal zum Paket „{name}“, Bereich: {}. Bitte die Person kontaktieren und die passende Leistung klären. Es wurde kein Paket aktiviert und keine Zahlung ausgelöst.\n\nAnfrage öffnen: /leads?lead={lead}&view=wizard", body.module_id);
        // A system-generated internal task is assigned by its responsible staff
        // member, not by a patient who must not gain access to internal tasks.
        let task: Uuid = sqlx::query_scalar("INSERT INTO tasks(title,description,assigned_to,assigned_by)
            VALUES($1,$2,$3,$3) RETURNING id")
            .bind(&title).bind(&description).bind(assigned_to).fetch_one(&mut *tx).await?;
        let id: Uuid = sqlx::query_scalar("INSERT INTO lead_portal_plan_requests
            (lead_id,requested_by,package_id,package_name,subscription_kind,module_id,task_id)
            VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id")
            .bind(lead).bind(auth.user_id).bind(body.package_id).bind(name).bind(kind)
            .bind(&body.module_id).bind(task).fetch_one(&mut *tx).await?;
        let mut notifications = Vec::new();
        for recipient in recipients {
            let notification: Uuid = sqlx::query_scalar("INSERT INTO user_notifications
                (user_id,kind,title,body,entity_type,entity_id,params)
                VALUES($1,'lead_portal_plan_request',$2,$3,'lead',$4,$5) RETURNING id")
                .bind(recipient).bind(&title).bind(&description).bind(lead)
                .bind(json!({"request_id":id,"task_id":task,"package_name":name,"module_id":body.module_id}))
                .fetch_one(&mut *tx).await?;
            notifications.push((recipient, notification));
        }
        audit::write_in_transaction(&mut tx, &audit::domain_event("lead_portal_plan_requested",
            Some(auth.user_id), "lead", Some(lead), json!({"request_id":id,"package_id":body.package_id,
                "subscription_kind":kind,"module_id":body.module_id,"task_id":task,"access_kind":access.as_str()}))).await?;
        let request = requests(&mut tx, lead, auth.user_id).await?.into_iter()
            .find(|request| request["id"] == id.to_string()).ok_or(sqlx::Error::RowNotFound)?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Some((request, task, assigned_to, notifications)))
    }.await;
    match stored {
        Ok(Some((request, task, assigned_to, notifications))) => {
            crate::realtime::publish_task_event(
                &state,
                Some(assigned_to),
                "task.created",
                task,
                json!({}),
            )
            .await;
            for (recipient, notification) in notifications {
                crate::realtime::publish_notification_event(
                    &state,
                    recipient,
                    "notification.created",
                    Some(notification),
                    json!({"entity_type":"lead","entity_id":lead}),
                )
                .await;
            }
            (
                StatusCode::CREATED,
                Json(json!({"request":request,"created":true})),
            )
                .into_response()
        }
        Ok(None) => err(
            StatusCode::SERVICE_UNAVAILABLE,
            "No staff member is currently available to handle the request",
        ),
        Err(error) => failure(error),
    }
}
