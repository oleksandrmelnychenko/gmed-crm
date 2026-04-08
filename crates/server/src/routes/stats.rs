use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stats/overview", get(overview))
        .route("/stats/leads", get(leads_stats))
        .route("/stats/leads/monthly", get(leads_monthly))
        .route("/stats/leads/by-status", get(leads_by_status))
        .route("/stats/orders/by-phase", get(orders_by_phase))
        .route("/stats/appointments/upcoming", get(upcoming_appointments))
}

#[derive(Deserialize)]
struct PeriodQuery {
    period: Option<String>,
}

async fn overview(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Sales]) {
        return e;
    }

    let patients =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!" FROM patients WHERE is_active = true"#)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    let leads = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!" FROM leads WHERE qualification_status NOT IN ('archived', 'converted')"#)
        .fetch_one(&state.db).await.unwrap_or(0);
    let orders =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!" FROM orders WHERE status = 'active'"#)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    let appointments = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM appointments WHERE status IN ('planned', 'confirmed')"#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    let cases =
        sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!" FROM cases WHERE status != 'closed'"#)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    let users = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "c!" FROM users WHERE is_active = true"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    Json(serde_json::json!({
        "patients": patients,
        "leads": leads,
        "orders": orders,
        "appointments": appointments,
        "cases": cases,
        "users": users,
    }))
    .into_response()
}

async fn leads_stats(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<PeriodQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    let period = q.period.as_deref().unwrap_or("this_month");

    let total_this = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM leads WHERE created_at >= date_trunc('month', now())"#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_last = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM leads WHERE created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now())"#
    ).fetch_one(&state.db).await.unwrap_or(0);

    let qualified_this = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM leads WHERE qualification_status = 'qualified' AND updated_at >= date_trunc('month', now())"#
    ).fetch_one(&state.db).await.unwrap_or(0);

    let converted_this = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM leads WHERE qualification_status = 'converted' AND updated_at >= date_trunc('month', now())"#
    ).fetch_one(&state.db).await.unwrap_or(0);

    let total_all = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM leads WHERE qualification_status NOT IN ('archived')"#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let growth_pct = if total_last > 0 {
        ((total_this - total_last) as f64 / total_last as f64 * 100.0).round() as i64
    } else {
        0
    };

    Json(serde_json::json!({
        "period": period,
        "total_this_month": total_this,
        "total_last_month": total_last,
        "growth_pct": growth_pct,
        "growth_abs": total_this - total_last,
        "qualified_this_month": qualified_this,
        "converted_this_month": converted_this,
        "total_all": total_all,
    }))
    .into_response()
}

async fn leads_monthly(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT
            to_char(date_trunc('month', created_at), 'YYYY-MM') AS "month!",
            COUNT(*)::int AS "count!: i32"
         FROM leads
         WHERE created_at >= now() - interval '12 months'
         GROUP BY 1
         ORDER BY 1"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut data: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
            for r in rows {
                data.push(serde_json::json!({"month": r.month, "count": r.count}));
            }
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "leads monthly");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn leads_by_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT qualification_status AS "status!", COUNT(*)::int AS "count!: i32"
         FROM leads
         GROUP BY qualification_status
         ORDER BY 2 DESC"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut data: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
            for r in rows {
                data.push(serde_json::json!({"status": r.status, "count": r.count}));
            }
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "leads by status");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn orders_by_phase(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT phase AS "phase!", COUNT(*)::int AS "count!: i32"
         FROM orders WHERE status = 'active'
         GROUP BY phase ORDER BY 2 DESC"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut data: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
            for r in rows {
                data.push(serde_json::json!({"phase": r.phase, "count": r.count}));
            }
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "orders by phase");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn upcoming_appointments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.appointment_type,
                  a.status, a.location,
                  p.first_name, p.last_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           WHERE a.date >= CURRENT_DATE AND a.status IN ('planned', 'confirmed')
           ORDER BY a.date, a.time_start LIMIT 10"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut data: Vec<serde_json::Value> = Vec::with_capacity(rows.len());
            for r in rows {
                data.push(serde_json::json!({
                    "id": r.id,
                    "title": r.title,
                    "date": r.date,
                    "time_start": r.time_start,
                    "type": r.appointment_type,
                    "status": r.status,
                    "location": r.location,
                    "patient_name": format!("{} {}", r.first_name, r.last_name),
                }));
            }
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "upcoming appointments");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
