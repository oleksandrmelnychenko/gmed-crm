use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::{
        HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::IntoResponse,
    routing::get,
};
use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stats/overview", get(overview))
        .route("/stats/ceo/dashboard", get(ceo_dashboard))
        .route("/stats/reports/workspace", get(reports_workspace))
        .route("/stats/reports/export", get(reports_export))
        .route("/stats/forecasting", get(forecasting_workspace))
        .route("/stats/risk-analysis", get(risk_analysis))
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

#[derive(Deserialize)]
struct ReportsExportQuery {
    section: Option<String>,
    provider_id: Option<uuid::Uuid>,
}

#[derive(Serialize)]
struct RiskAnalysisPayload {
    allowed_sections: Vec<&'static str>,
    patient_manager: Option<PatientManagerRiskPayload>,
    billing: Option<BillingRiskPayload>,
}

#[derive(Serialize)]
struct PatientManagerRiskPayload {
    summary: PatientManagerRiskSummary,
    alerts: Vec<PatientManagerRiskAlert>,
}

#[derive(Serialize)]
struct PatientManagerRiskSummary {
    total_alerts: i64,
    urgent_alerts: i64,
    high_alerts: i64,
    medium_alerts: i64,
    complex_case_alerts: i64,
    overdue_appointments: i64,
    overdue_tasks: i64,
    overdue_checklists: i64,
}

#[derive(Serialize)]
struct PatientManagerRiskAlert {
    patient_id: String,
    patient_label: String,
    severity: &'static str,
    title: String,
    reasons: Vec<String>,
    open_case_count: i64,
    open_appointment_count: i64,
    overdue_appointment_count: i64,
    open_task_count: i64,
    overdue_task_count: i64,
    overdue_checklist_count: i64,
    high_risk_label: bool,
    fall_risk_label: bool,
}

#[derive(Serialize)]
struct BillingRiskPayload {
    summary: BillingRiskSummary,
    alerts: Vec<BillingRiskAlert>,
}

#[derive(Serialize)]
struct BillingRiskSummary {
    total_alerts: i64,
    urgent_alerts: i64,
    high_alerts: i64,
    medium_alerts: i64,
    overdue_invoice_count: i64,
    blocked_orders: i64,
    outstanding_balance_total: String,
    exposure_gap_total: String,
}

#[derive(Serialize)]
struct BillingRiskAlert {
    order_id: String,
    order_number: String,
    patient_id: String,
    patient_label: String,
    severity: &'static str,
    title: String,
    reasons: Vec<String>,
    phase: String,
    billing_release_status: String,
    package_coverage_status: String,
    overdue_invoice_count: i64,
    unpaid_advance_invoice_count: i64,
    outstanding_balance: String,
    service_gross: String,
    invoiced_total: String,
    exposure_gap: String,
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn quote_status_weight(status: &str) -> Decimal {
    match status {
        "accepted" => Decimal::ONE,
        "sent" => Decimal::new(60, 2),
        "draft" => Decimal::new(25, 2),
        _ => Decimal::ZERO,
    }
}

fn optional_decimal_to_f64(value: Option<Decimal>) -> Option<f64> {
    value.and_then(|current| current.round_dp(2).to_f64())
}

fn percentage(value: i64, total: i64) -> Option<f64> {
    if total <= 0 {
        None
    } else {
        Some(((value as f64 / total as f64) * 100.0 * 10.0).round() / 10.0)
    }
}

async fn overview(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::Sales,
    ]) {
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

async fn ceo_dashboard(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::CeoAssistant]) {
        return resp;
    }

    let summary = match load_ceo_summary(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load ceo dashboard summary");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load CEO dashboard summary",
            );
        }
    };
    let countries = match load_ceo_countries(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load ceo dashboard countries");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load CEO dashboard countries",
            );
        }
    };
    let service_mix = match load_ceo_service_mix(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load ceo dashboard service mix");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load CEO dashboard service mix",
            );
        }
    };
    let patient_manager_kpis = match load_patient_manager_kpis(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load patient manager kpis");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient manager KPIs",
            );
        }
    };
    let interpreter_kpis = match load_interpreter_kpis(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load interpreter kpis");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter KPIs",
            );
        }
    };
    let concierge_kpis = match load_concierge_kpis(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load concierge kpis");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load concierge KPIs",
            );
        }
    };
    let provider_kpis = match load_provider_kpis(&state).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load provider kpis");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load clinic KPIs",
            );
        }
    };

    Json(json!({
        "summary": summary,
        "countries": countries,
        "service_mix": service_mix,
        "patient_manager_kpis": patient_manager_kpis,
        "interpreter_kpis": interpreter_kpis,
        "concierge_kpis": concierge_kpis,
        "provider_kpis": provider_kpis,
    }))
    .into_response()
}

async fn reports_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::Sales,
    ]) {
        return resp;
    }

    let role = auth.role;
    let include_clinics = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    );
    let include_countries = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Sales
    );
    let include_service_types = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing | Role::Sales
    );
    let include_doctors = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    );
    let include_non_medical_providers = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing | Role::Sales
    );
    let can_see_financial = role.can_see_financial_data();

    let summary = match load_reports_summary(&state, can_see_financial).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load reports summary");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load reports workspace",
            );
        }
    };

    let clinics = if include_clinics {
        match load_report_clinics(&state, can_see_financial).await {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, "load report clinics");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load reports workspace",
                );
            }
        }
    } else {
        Vec::new()
    };
    let countries = if include_countries {
        match load_report_countries(&state, can_see_financial).await {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, "load report countries");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load reports workspace",
                );
            }
        }
    } else {
        Vec::new()
    };
    let service_types = if include_service_types {
        match load_report_service_types(&state, can_see_financial).await {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, "load report service types");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load reports workspace",
                );
            }
        }
    } else {
        Vec::new()
    };
    let doctors = if include_doctors {
        match load_report_doctors(&state, can_see_financial, None).await {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, "load report doctors");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load reports workspace",
                );
            }
        }
    } else {
        Vec::new()
    };
    let non_medical_providers = if include_non_medical_providers {
        match load_report_non_medical_providers(&state, can_see_financial).await {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, "load report non medical providers");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load reports workspace",
                );
            }
        }
    } else {
        Vec::new()
    };

    let mut allowed_sections = Vec::new();
    if include_clinics {
        allowed_sections.push("clinics");
    }
    if include_countries {
        allowed_sections.push("countries");
    }
    if include_service_types {
        allowed_sections.push("service_types");
    }
    if include_doctors {
        allowed_sections.push("doctors");
    }
    if include_non_medical_providers {
        allowed_sections.push("non_medical_providers");
    }

    Json(json!({
        "summary": summary,
        "allowed_sections": allowed_sections,
        "clinics": clinics,
        "countries": countries,
        "service_types": service_types,
        "doctors": doctors,
        "non_medical_providers": non_medical_providers,
        "financial_metrics_visible": can_see_financial,
    }))
    .into_response()
}

async fn reports_export(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ReportsExportQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::Sales,
    ]) {
        return resp;
    }

    let section = query
        .section
        .as_deref()
        .unwrap_or("clinics")
        .trim()
        .to_lowercase();
    let role = auth.role;
    let can_see_financial = role.can_see_financial_data();

    let (filename, csv_result) = match section.as_str() {
        "clinics"
            if matches!(
                role,
                Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
            ) =>
        {
            (
                "clinic-report.csv",
                load_report_clinics(&state, can_see_financial)
                    .await
                    .map(export_clinics_csv),
            )
        }
        "countries"
            if matches!(
                role,
                Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Sales
            ) =>
        {
            (
                "country-report.csv",
                load_report_countries(&state, can_see_financial)
                    .await
                    .map(export_countries_csv),
            )
        }
        "service_types"
            if matches!(
                role,
                Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing | Role::Sales
            ) =>
        {
            (
                "service-type-report.csv",
                load_report_service_types(&state, can_see_financial)
                    .await
                    .map(export_service_types_csv),
            )
        }
        "doctors"
            if matches!(
                role,
                Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
            ) =>
        {
            (
                "doctor-report.csv",
                load_report_doctors(&state, can_see_financial, query.provider_id)
                    .await
                    .map(export_doctors_csv),
            )
        }
        "non_medical_providers"
            if matches!(
                role,
                Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing | Role::Sales
            ) =>
        {
            (
                "non-medical-provider-report.csv",
                load_report_non_medical_providers(&state, can_see_financial)
                    .await
                    .map(export_non_medical_providers_csv),
            )
        }
        "clinics" | "countries" | "service_types" | "doctors" | "non_medical_providers" => {
            return err(StatusCode::FORBIDDEN, "Insufficient permissions");
        }
        _ => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid report export section",
            );
        }
    };

    match csv_result {
        Ok(csv) => {
            let content_disposition =
                HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
            (
                [
                    (
                        CONTENT_TYPE,
                        HeaderValue::from_static("text/csv; charset=utf-8"),
                    ),
                    (CONTENT_DISPOSITION, content_disposition),
                ],
                csv,
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, section = %section, "export reports workspace");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to export reports workspace",
            )
        }
    }
}

async fn forecasting_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::Sales,
    ]) {
        return resp;
    }

    let role = auth.role;
    let include_quote_pipeline = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing | Role::Sales
    );
    let include_collections = matches!(role, Role::Ceo | Role::CeoAssistant | Role::Billing);
    let include_followup = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    );
    let include_clinic_capacity = matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing | Role::Sales
    );
    let can_see_financial = role.can_see_financial_data();

    let quote_pipeline = if include_quote_pipeline {
        match load_forecast_quote_pipeline(&state, can_see_financial).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, "load forecast quote pipeline");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load forecasting workspace",
                );
            }
        }
    } else {
        None
    };

    let collections = if include_collections {
        match load_forecast_collections(&state, can_see_financial).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, "load forecast collections");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load forecasting workspace",
                );
            }
        }
    } else {
        None
    };

    let followup = if include_followup {
        match load_forecast_followup(&state).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, "load forecast followup");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load forecasting workspace",
                );
            }
        }
    } else {
        None
    };

    let clinic_capacity = if include_clinic_capacity {
        match load_forecast_clinic_capacity(&state).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, "load forecast clinic capacity");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load forecasting workspace",
                );
            }
        }
    } else {
        None
    };

    let mut allowed_sections = Vec::new();
    if include_quote_pipeline {
        allowed_sections.push("quote_pipeline");
    }
    if include_collections {
        allowed_sections.push("collections");
    }
    if include_followup {
        allowed_sections.push("followup");
    }
    if include_clinic_capacity {
        allowed_sections.push("clinic_capacity");
    }

    Json(json!({
        "summary": {
            "open_quotes": quote_pipeline.as_ref().and_then(|value| value["open_quotes"].as_i64()).unwrap_or(0),
            "expiring_quotes_next_14d": quote_pipeline.as_ref().and_then(|value| value["expiring_next_14d"].as_i64()).unwrap_or(0),
            "pipeline_gross_total": quote_pipeline.as_ref().and_then(|value| value["gross_total"].as_str()),
            "weighted_pipeline_gross": quote_pipeline.as_ref().and_then(|value| value["weighted_gross"].as_str()),
            "due_next_14d_total": collections.as_ref().and_then(|value| value["due_next_14d_total"].as_str()),
            "overdue_open_total": collections.as_ref().and_then(|value| value["overdue_open_total"].as_str()),
            "followup_milestones_next_30d": followup.as_ref().and_then(|value| value["milestones_due_next_30d"].as_i64()).unwrap_or(0),
            "appointments_next_30d": clinic_capacity.as_ref().and_then(|value| value["appointments_next_30d_total"].as_i64()).unwrap_or(0),
        },
        "allowed_sections": allowed_sections,
        "quote_pipeline": quote_pipeline,
        "collections": collections,
        "followup": followup,
        "clinic_capacity": clinic_capacity,
    }))
    .into_response()
}

async fn risk_analysis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ]) {
        return resp;
    }

    let include_pm = matches!(
        auth.role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager
    );
    let include_billing = matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing);

    let patient_manager = if include_pm {
        let manager_scope = if auth.role == Role::PatientManager {
            Some(auth.user_id)
        } else {
            None
        };
        match load_patient_manager_risks(&state, manager_scope).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, user_id = %auth.user_id, "load patient-manager risk analysis");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load risk analysis",
                );
            }
        }
    } else {
        None
    };

    let billing = if include_billing {
        match load_billing_risks(&state).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, user_id = %auth.user_id, "load billing risk analysis");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load risk analysis",
                );
            }
        }
    } else {
        None
    };

    let mut allowed_sections = Vec::new();
    if include_pm {
        allowed_sections.push("patient_manager");
    }
    if include_billing {
        allowed_sections.push("billing");
    }

    Json(RiskAnalysisPayload {
        allowed_sections,
        patient_manager,
        billing,
    })
    .into_response()
}

async fn leads_stats(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<PeriodQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Sales,
    ]) {
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
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Sales,
    ]) {
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
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Sales,
    ]) {
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
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ]) {
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
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
    ]) {
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

async fn load_ceo_summary(state: &AppState) -> Result<Value, sqlx::Error> {
    let finance = sqlx::query(
        r#"SELECT
                COALESCE(SUM(CASE
                    WHEN status <> 'cancelled'
                     AND issued_at >= date_trunc('month', now())
                    THEN total_gross ELSE 0 END), 0) AS invoiced_this_month,
                COALESCE(SUM(CASE
                    WHEN paid_at IS NOT NULL
                     AND paid_at >= date_trunc('month', now())
                    THEN paid_amount ELSE 0 END), 0) AS collected_this_month,
                COALESCE(SUM(CASE
                    WHEN status <> 'cancelled'
                     AND issued_at >= date_trunc('quarter', now())
                    THEN total_gross ELSE 0 END), 0) AS invoiced_this_quarter,
                COALESCE(SUM(CASE
                    WHEN status NOT IN ('paid', 'cancelled')
                    THEN GREATEST(total_gross - paid_amount, 0)
                    ELSE 0 END), 0) AS outstanding_receivables
           FROM invoices"#,
    )
    .fetch_one(&state.db)
    .await?;

    let average_revenue_row = sqlx::query(
        r#"SELECT COALESCE(
                SUM(total_gross) / NULLIF(COUNT(DISTINCT patient_id), 0),
                0
            ) AS average_revenue_per_patient
           FROM invoices
           WHERE status <> 'cancelled'"#,
    )
    .fetch_one(&state.db)
    .await?;

    let on_time_row = sqlx::query(
        r#"SELECT COALESCE(
                ROUND((
                    100.0
                    * COUNT(*) FILTER (
                        WHERE status = 'paid'
                          AND due_date IS NOT NULL
                          AND paid_at::date <= due_date
                    )
                    / NULLIF(COUNT(*) FILTER (
                        WHERE status = 'paid' AND due_date IS NOT NULL
                    ), 0)
                )::numeric, 1),
                0
            ) AS on_time_payment_rate_pct
           FROM invoices"#,
    )
    .fetch_one(&state.db)
    .await?;

    let patients = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (
                    WHERE created_at >= date_trunc('month', now())
                )::bigint AS new_patients_this_month,
                COUNT(*) FILTER (WHERE is_active = true)::bigint AS active_patients_total,
                (
                    SELECT COUNT(DISTINCT patient_id)::bigint
                    FROM orders
                    WHERE status = 'active'
                ) AS active_patients_under_care
           FROM patients"#,
    )
    .fetch_one(&state.db)
    .await?;

    let retention = sqlx::query(
        r#"WITH per_patient AS (
                SELECT patient_id, COUNT(*)::bigint AS order_count
                FROM orders
                GROUP BY patient_id
            )
            SELECT
                COUNT(*) FILTER (WHERE order_count >= 2)::bigint AS returning_patients,
                COUNT(*)::bigint AS patients_with_orders,
                COALESCE(
                    ROUND((
                        100.0 * COUNT(*) FILTER (WHERE order_count >= 2)
                        / NULLIF(COUNT(*), 0)
                    )::numeric, 1),
                    0
                ) AS retention_rate_pct
            FROM per_patient"#,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(json!({
        "invoiced_this_month": decimal_to_string(
            finance
                .try_get::<Decimal, _>("invoiced_this_month")
                .unwrap_or(Decimal::ZERO)
        ),
        "collected_this_month": decimal_to_string(
            finance
                .try_get::<Decimal, _>("collected_this_month")
                .unwrap_or(Decimal::ZERO)
        ),
        "invoiced_this_quarter": decimal_to_string(
            finance
                .try_get::<Decimal, _>("invoiced_this_quarter")
                .unwrap_or(Decimal::ZERO)
        ),
        "outstanding_receivables": decimal_to_string(
            finance
                .try_get::<Decimal, _>("outstanding_receivables")
                .unwrap_or(Decimal::ZERO)
        ),
        "average_revenue_per_patient": decimal_to_string(
            average_revenue_row
                .try_get::<Decimal, _>("average_revenue_per_patient")
                .unwrap_or(Decimal::ZERO)
        ),
        "on_time_payment_rate_pct": optional_decimal_to_f64(
            on_time_row
                .try_get::<Option<Decimal>, _>("on_time_payment_rate_pct")
                .unwrap_or_default()
        ).unwrap_or(0.0),
        "new_patients_this_month": patients
            .try_get::<i64, _>("new_patients_this_month")
            .unwrap_or(0),
        "active_patients_total": patients
            .try_get::<i64, _>("active_patients_total")
            .unwrap_or(0),
        "active_patients_under_care": patients
            .try_get::<i64, _>("active_patients_under_care")
            .unwrap_or(0),
        "returning_patients": retention
            .try_get::<i64, _>("returning_patients")
            .unwrap_or(0),
        "patients_with_orders": retention
            .try_get::<i64, _>("patients_with_orders")
            .unwrap_or(0),
        "retention_rate_pct": optional_decimal_to_f64(
            retention
                .try_get::<Option<Decimal>, _>("retention_rate_pct")
                .unwrap_or_default()
        ).unwrap_or(0.0),
        "retention_definition": "patients with two or more orders divided by patients with at least one order",
    }))
}

async fn load_ceo_countries(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                COALESCE(
                    NULLIF(TRIM(residence_country), ''),
                    NULLIF(TRIM(address_country), ''),
                    NULLIF(TRIM(nationality), ''),
                    'Unknown'
                ) AS country,
                COUNT(*)::bigint AS patient_count
           FROM patients
           WHERE is_active = true
           GROUP BY 1
           ORDER BY 2 DESC, 1
           LIMIT 10"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "country": row.try_get::<String, _>("country").unwrap_or_else(|_| "Unknown".to_string()),
                "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or(0),
            })
        })
        .collect())
}

async fn load_ceo_service_mix(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                CASE
                    WHEN ol.is_cost_passthrough THEN 'cost_passthrough'
                    WHEN COALESCE(p.provider_type, 'medical') = 'non_medical' THEN 'non_medical'
                    ELSE 'medical'
                END AS service_type,
                COUNT(*)::bigint AS item_count,
                COALESCE(
                    SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                    0
                ) AS gross_total
           FROM order_leistungen ol
           LEFT JOIN providers p ON p.id = ol.provider_id
           WHERE ol.status IN ('delivered', 'approved', 'invoiced')
           GROUP BY 1
           ORDER BY 2 DESC, 1"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "service_type": row.try_get::<String, _>("service_type").unwrap_or_default(),
                "item_count": row.try_get::<i64, _>("item_count").unwrap_or(0),
                "gross_total": decimal_to_string(
                    row.try_get::<Decimal, _>("gross_total").unwrap_or(Decimal::ZERO)
                ),
            })
        })
        .collect())
}

async fn load_patient_manager_kpis(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                u.id,
                u.name,
                (
                    SELECT COUNT(DISTINCT pa.patient_id)::bigint
                    FROM patient_assignments pa
                    JOIN patients p ON p.id = pa.patient_id
                    WHERE pa.user_id = u.id
                      AND pa.revoked_at IS NULL
                      AND p.is_active = true
                ) AS active_patients,
                (
                    SELECT COUNT(DISTINCT o.id)::bigint
                    FROM orders o
                    JOIN patient_assignments pa ON pa.patient_id = o.patient_id
                    WHERE pa.user_id = u.id
                      AND pa.revoked_at IS NULL
                      AND o.status = 'active'
                ) AS active_orders,
                (
                    SELECT COUNT(*)::bigint
                    FROM tasks t
                    WHERE t.assigned_to = u.id
                      AND t.status NOT IN ('completed', 'cancelled')
                ) AS open_tasks,
                (
                    SELECT COUNT(*)::bigint
                    FROM tasks t
                    WHERE t.assigned_to = u.id
                      AND t.status NOT IN ('completed', 'cancelled')
                      AND t.due_date < now()
                ) AS overdue_tasks,
                (
                    SELECT COUNT(*)::bigint
                    FROM workflow_checklist_items w
                    WHERE w.owner_user_id = u.id
                ) AS checklist_total,
                (
                    SELECT COUNT(*)::bigint
                    FROM workflow_checklist_items w
                    WHERE w.owner_user_id = u.id
                      AND w.is_completed = true
                ) AS checklist_completed,
                (
                    SELECT ROUND(AVG(f.patient_manager_score)::numeric, 2)
                    FROM patient_feedback_forms f
                    WHERE f.patient_manager_id = u.id
                      AND f.patient_manager_score IS NOT NULL
                ) AS avg_feedback_score
           FROM users u
           WHERE u.role = 'patient_manager'
             AND u.is_active = true
           ORDER BY active_patients DESC, open_tasks DESC, u.name"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let checklist_total = row.try_get::<i64, _>("checklist_total").unwrap_or(0);
            let checklist_completed = row.try_get::<i64, _>("checklist_completed").unwrap_or(0);
            let checklist_completion_rate_pct = if checklist_total == 0 {
                0.0
            } else {
                ((checklist_completed as f64 / checklist_total as f64) * 100.0 * 10.0).round()
                    / 10.0
            };

            json!({
                "user_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "active_patients": row.try_get::<i64, _>("active_patients").unwrap_or(0),
                "active_orders": row.try_get::<i64, _>("active_orders").unwrap_or(0),
                "open_tasks": row.try_get::<i64, _>("open_tasks").unwrap_or(0),
                "overdue_tasks": row.try_get::<i64, _>("overdue_tasks").unwrap_or(0),
                "checklist_total": checklist_total,
                "checklist_completed": checklist_completed,
                "checklist_completion_rate_pct": checklist_completion_rate_pct,
                "avg_feedback_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_feedback_score").unwrap_or_default()
                ),
            })
        })
        .collect())
}

async fn load_interpreter_kpis(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                u.id,
                u.name,
                (
                    SELECT COALESCE(SUM(ir.hours), 0)
                    FROM interpreter_reports ir
                    WHERE ir.interpreter_id = u.id
                      AND ir.approval_status = 'approved'
                      AND ir.created_at >= now() - interval '30 days'
                ) AS approved_hours_30d,
                (
                    SELECT COALESCE((
                        SUM(EXTRACT(EPOCH FROM (a.time_end - a.time_start)) / 3600.0)
                    )::numeric, 0)
                    FROM appointments a
                    WHERE a.interpreter_id = u.id
                      AND a.status = 'completed'
                      AND a.date >= CURRENT_DATE - 30
                      AND a.time_start IS NOT NULL
                      AND a.time_end IS NOT NULL
                ) AS booked_hours_30d,
                (
                    SELECT COALESCE((
                        SUM(EXTRACT(EPOCH FROM (a.time_end - a.time_start)) / 3600.0)
                    )::numeric, 0)
                    FROM appointments a
                    WHERE a.interpreter_id = u.id
                      AND a.status IN ('planned', 'confirmed', 'in_progress')
                      AND a.date >= CURRENT_DATE
                      AND a.date <= CURRENT_DATE + 30
                      AND a.time_start IS NOT NULL
                      AND a.time_end IS NOT NULL
                ) AS upcoming_hours_30d,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.interpreter_id = u.id
                      AND a.status = 'completed'
                      AND a.date >= CURRENT_DATE - 30
                ) AS completed_appointments_30d,
                (
                    SELECT ROUND(AVG(f.interpreter_score)::numeric, 2)
                    FROM patient_feedback_forms f
                    WHERE f.interpreter_id = u.id
                      AND f.interpreter_score IS NOT NULL
                ) AS avg_feedback_score
           FROM users u
           WHERE u.role IN ('teamlead_interpreter', 'interpreter')
             AND u.is_active = true
           ORDER BY booked_hours_30d DESC, completed_appointments_30d DESC, u.name"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let booked = row
                .try_get::<Decimal, _>("booked_hours_30d")
                .unwrap_or(Decimal::ZERO);
            let approved = row
                .try_get::<Decimal, _>("approved_hours_30d")
                .unwrap_or(Decimal::ZERO);
            let utilization_rate_pct = if booked > Decimal::ZERO {
                ((approved / booked) * Decimal::from(100))
                    .round_dp(1)
                    .to_f64()
                    .unwrap_or(0.0)
            } else {
                0.0
            };

            json!({
                "user_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "approved_hours_30d": decimal_to_string(approved),
                "booked_hours_30d": decimal_to_string(booked),
                "upcoming_hours_30d": decimal_to_string(
                    row.try_get::<Decimal, _>("upcoming_hours_30d").unwrap_or(Decimal::ZERO)
                ),
                "completed_appointments_30d": row.try_get::<i64, _>("completed_appointments_30d").unwrap_or(0),
                "utilization_rate_pct": utilization_rate_pct,
                "avg_feedback_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_feedback_score").unwrap_or_default()
                ),
            })
        })
        .collect())
}

async fn load_concierge_kpis(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                u.id,
                u.name,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.assigned_concierge_id = u.id
                      AND cs.status NOT IN ('completed', 'cancelled')
                ) AS active_services,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.assigned_concierge_id = u.id
                      AND cs.status = 'completed'
                      AND cs.completed_at >= now() - interval '30 days'
                ) AS completed_services_30d,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.assigned_concierge_id = u.id
                      AND cs.billing_status = 'ready'
                ) AS ready_for_billing,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.assigned_concierge_id = u.id
                      AND cs.request_source = 'patient_portal'
                      AND cs.created_at >= now() - interval '30 days'
                ) AS portal_requests_30d,
                (
                    SELECT ROUND(AVG(f.concierge_score)::numeric, 2)
                    FROM patient_feedback_forms f
                    WHERE f.concierge_id = u.id
                      AND f.concierge_score IS NOT NULL
                ) AS avg_feedback_score
           FROM users u
           WHERE u.role = 'concierge'
             AND u.is_active = true
           ORDER BY active_services DESC, completed_services_30d DESC, u.name"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "user_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "active_services": row.try_get::<i64, _>("active_services").unwrap_or(0),
                "completed_services_30d": row.try_get::<i64, _>("completed_services_30d").unwrap_or(0),
                "ready_for_billing": row.try_get::<i64, _>("ready_for_billing").unwrap_or(0),
                "portal_requests_30d": row.try_get::<i64, _>("portal_requests_30d").unwrap_or(0),
                "avg_feedback_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_feedback_score").unwrap_or_default()
                ),
            })
        })
        .collect())
}

async fn load_provider_kpis(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                p.id,
                p.name,
                (
                    SELECT COUNT(DISTINCT a.patient_id)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS active_patients_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS appointments_90d,
                (
                    SELECT COALESCE(
                        SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                        0
                    )
                    FROM order_leistungen ol
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS gross_service_volume,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS feedback_count,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_feedback_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_treatment_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.doctor_score, f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_doctor_score,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    JOIN order_followup_flows off ON off.order_id = ol.order_id
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS followup_orders_total,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    JOIN order_followup_flows off ON off.order_id = ol.order_id
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                      AND off.doctor_followup_status IN ('completed', 'not_required')
                      AND off.followup_1w_status IN ('completed', 'not_required')
                      AND off.followup_1m_status IN ('completed', 'not_required')
                      AND off.followup_6m_status IN ('completed', 'not_required')
                      AND off.package_end_status IN ('completed', 'not_required')
                      AND off.results_handoff_status = 'completed'
                ) AS followup_completed_orders
           FROM providers p
           WHERE p.is_active = true
             AND p.provider_type = 'medical'
           ORDER BY gross_service_volume DESC, appointments_90d DESC, p.name
           LIMIT 10"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "provider_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "active_patients_90d": row.try_get::<i64, _>("active_patients_90d").unwrap_or(0),
                "appointments_90d": row.try_get::<i64, _>("appointments_90d").unwrap_or(0),
                "gross_service_volume": decimal_to_string(
                    row.try_get::<Decimal, _>("gross_service_volume").unwrap_or(Decimal::ZERO)
                ),
                "avg_feedback_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_feedback_score").unwrap_or_default()
                ),
            })
        })
        .collect())
}

async fn load_reports_summary(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Value, sqlx::Error> {
    let summary = sqlx::query(
        r#"SELECT
                (
                    SELECT COUNT(*)::bigint
                    FROM patients
                    WHERE is_active = true
                ) AS active_patients,
                (
                    SELECT COUNT(*)::bigint
                    FROM orders
                    WHERE status = 'active'
                ) AS active_orders,
                (
                    SELECT COUNT(*)::bigint
                    FROM providers
                    WHERE is_active = true
                      AND provider_type = 'medical'
                ) AS active_clinics,
                (
                    SELECT COUNT(*)::bigint
                    FROM order_leistungen
                    WHERE status IN ('delivered', 'approved', 'invoiced')
                ) AS delivered_service_items,
                (
                    SELECT COALESCE(
                        SUM(quantity * unit_price * (1 + (vat_rate / 100))),
                        0
                    )
                    FROM order_leistungen
                    WHERE status IN ('delivered', 'approved', 'invoiced')
                ) AS delivered_service_volume"#,
    )
    .fetch_one(&state.db)
    .await?;

    let delivered_service_volume = if can_see_financial {
        Some(decimal_to_string(
            summary
                .try_get::<Decimal, _>("delivered_service_volume")
                .unwrap_or(Decimal::ZERO),
        ))
    } else {
        None
    };

    Ok(json!({
        "active_patients": summary.try_get::<i64, _>("active_patients").unwrap_or(0),
        "active_orders": summary.try_get::<i64, _>("active_orders").unwrap_or(0),
        "active_clinics": summary.try_get::<i64, _>("active_clinics").unwrap_or(0),
        "delivered_service_items": summary.try_get::<i64, _>("delivered_service_items").unwrap_or(0),
        "delivered_service_volume": delivered_service_volume,
    }))
}

async fn load_report_clinics(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                p.id,
                p.name,
                p.address_city,
                p.address_country,
                p.provider_type,
                (
                    SELECT COUNT(DISTINCT a.patient_id)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS active_patients_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS appointments_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM order_leistungen ol
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS delivered_items,
                (
                    SELECT COUNT(*)::bigint
                    FROM provider_doctors pd
                    WHERE pd.provider_id = p.id
                ) AS doctor_count,
                (
                    SELECT COALESCE(
                        SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                        0
                    )
                    FROM order_leistungen ol
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS gross_service_volume,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS feedback_count,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_feedback_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_treatment_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.doctor_score, f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_doctor_score,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    JOIN order_followup_flows off ON off.order_id = ol.order_id
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS followup_orders_total,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    JOIN order_followup_flows off ON off.order_id = ol.order_id
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                      AND off.doctor_followup_status IN ('completed', 'not_required')
                      AND off.followup_1w_status IN ('completed', 'not_required')
                      AND off.followup_1m_status IN ('completed', 'not_required')
                      AND off.followup_6m_status IN ('completed', 'not_required')
                      AND off.package_end_status IN ('completed', 'not_required')
                      AND off.results_handoff_status = 'completed'
                ) AS followup_completed_orders,
                (
                    SELECT ROUND(
                        AVG(
                            EXTRACT(
                                EPOCH FROM (COALESCE(ac.responded_at, ac.closed_at) - ac.created_at)
                            ) / 3600.0
                        )::numeric,
                        2
                    )
                    FROM appointment_communications ac
                    WHERE ac.provider_id = p.id
                      AND ac.target_type = 'clinic'
                      AND ac.direction = 'outbound'
                      AND ac.status IN ('answered', 'closed')
                      AND COALESCE(ac.responded_at, ac.closed_at) IS NOT NULL
                ) AS avg_response_hours,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointment_communications ac
                    WHERE ac.provider_id = p.id
                      AND ac.target_type = 'clinic'
                      AND ac.direction = 'outbound'
                      AND ac.status IN ('answered', 'closed')
                      AND COALESCE(ac.responded_at, ac.closed_at) IS NOT NULL
                ) AS response_sample_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointment_communications ac
                    WHERE ac.provider_id = p.id
                      AND ac.target_type = 'clinic'
                      AND ac.direction = 'outbound'
                      AND ac.status IN ('planned', 'sent')
                ) AS open_communication_count,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.organization_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_organization_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.service_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_service_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.infrastructure_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_infrastructure_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.price_value_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_price_value_score,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                      AND f.treatment_success = 'yes'
                ) AS treatment_success_yes_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                      AND f.treatment_success = 'partial'
                ) AS treatment_success_partial_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                      AND f.treatment_success IS NOT NULL
                ) AS treatment_success_sample_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                      AND f.complication_reported = true
                ) AS complication_count,
                (
                    SELECT ROUND(AVG(item.turnaround_hours)::numeric, 2)
                    FROM (
                        SELECT EXTRACT(
                                   EPOCH FROM (
                                       MIN(d.created_at) - (
                                           (a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00'))
                                           AT TIME ZONE 'UTC'
                                       )
                                   )
                               ) / 3600.0 AS turnaround_hours
                        FROM documents d
                        JOIN appointments a ON a.id = d.appointment_id
                        WHERE a.provider_id = p.id
                          AND d.art = 'arztbrief'
                          AND d.status IN ('active', 'archived')
                          AND d.created_at >= (
                                (a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00'))
                                AT TIME ZONE 'UTC'
                          )
                        GROUP BY a.id, a.date, a.time_start, a.time_end
                    ) item
                ) AS avg_findings_turnaround_hours,
                (
                    SELECT COUNT(*)::bigint
                    FROM (
                        SELECT a.id
                        FROM documents d
                        JOIN appointments a ON a.id = d.appointment_id
                        WHERE a.provider_id = p.id
                          AND d.art = 'arztbrief'
                          AND d.status IN ('active', 'archived')
                          AND d.created_at >= (
                                (a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00'))
                                AT TIME ZONE 'UTC'
                          )
                        GROUP BY a.id
                    ) item
                ) AS findings_sample_count
           FROM providers p
           WHERE p.is_active = true
             AND p.provider_type = 'medical'
           ORDER BY appointments_90d DESC, active_patients_90d DESC, p.name
           LIMIT 25"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let gross_service_volume = if can_see_financial {
                Some(decimal_to_string(
                    row.try_get::<Decimal, _>("gross_service_volume")
                        .unwrap_or(Decimal::ZERO),
                ))
            } else {
                None
            };
            let followup_orders_total = row
                .try_get::<i64, _>("followup_orders_total")
                .unwrap_or_default();
            let followup_completed_orders = row
                .try_get::<i64, _>("followup_completed_orders")
                .unwrap_or_default();
            let treatment_success_yes_count = row
                .try_get::<i64, _>("treatment_success_yes_count")
                .unwrap_or_default();
            let treatment_success_partial_count = row
                .try_get::<i64, _>("treatment_success_partial_count")
                .unwrap_or_default();
            let treatment_success_sample_count = row
                .try_get::<i64, _>("treatment_success_sample_count")
                .unwrap_or_default();
            let complication_count = row
                .try_get::<i64, _>("complication_count")
                .unwrap_or_default();
            let feedback_count = row.try_get::<i64, _>("feedback_count").unwrap_or(0);

            json!({
                "provider_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
                "address_country": row.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
                "provider_type": row.try_get::<String, _>("provider_type").unwrap_or_default(),
                "active_patients_90d": row.try_get::<i64, _>("active_patients_90d").unwrap_or(0),
                "appointments_90d": row.try_get::<i64, _>("appointments_90d").unwrap_or(0),
                "delivered_items": row.try_get::<i64, _>("delivered_items").unwrap_or(0),
                "doctor_count": row.try_get::<i64, _>("doctor_count").unwrap_or(0),
                "feedback_count": feedback_count,
                "gross_service_volume": gross_service_volume,
                "avg_feedback_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_feedback_score").unwrap_or_default()
                ),
                "avg_treatment_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_treatment_score").unwrap_or_default()
                ),
                "avg_doctor_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_doctor_score").unwrap_or_default()
                ),
                "avg_organization_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_organization_score").unwrap_or_default()
                ),
                "avg_service_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_service_score").unwrap_or_default()
                ),
                "avg_infrastructure_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_infrastructure_score").unwrap_or_default()
                ),
                "avg_price_value_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_price_value_score").unwrap_or_default()
                ),
                "avg_response_hours": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_response_hours").unwrap_or_default()
                ),
                "avg_findings_turnaround_hours": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_findings_turnaround_hours").unwrap_or_default()
                ),
                "response_sample_count": row.try_get::<i64, _>("response_sample_count").unwrap_or(0),
                "open_communication_count": row.try_get::<i64, _>("open_communication_count").unwrap_or(0),
                "findings_sample_count": row.try_get::<i64, _>("findings_sample_count").unwrap_or(0),
                "treatment_success_yes_rate": percentage(
                    treatment_success_yes_count,
                    treatment_success_sample_count,
                ),
                "treatment_success_partial_rate": percentage(
                    treatment_success_partial_count,
                    treatment_success_sample_count,
                ),
                "complication_rate": percentage(complication_count, feedback_count),
                "followup_orders_total": followup_orders_total,
                "followup_completed_orders": followup_completed_orders,
                "followup_completion_rate": percentage(
                    followup_completed_orders,
                    followup_orders_total,
                ),
            })
        })
        .collect())
}

async fn load_report_countries(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH patient_country AS (
                SELECT
                    id,
                    COALESCE(
                        NULLIF(TRIM(residence_country), ''),
                        NULLIF(TRIM(address_country), ''),
                        NULLIF(TRIM(nationality), ''),
                        'Unknown'
                    ) AS country
                FROM patients
                WHERE is_active = true
            )
            SELECT
                pc.country,
                COUNT(*)::bigint AS patient_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM orders o
                    JOIN patient_country pc_inner ON pc_inner.id = o.patient_id
                    WHERE pc_inner.country = pc.country
                      AND o.status = 'active'
                ) AS active_orders,
                (
                    SELECT COALESCE(SUM(i.total_gross), 0)
                    FROM invoices i
                    JOIN patient_country pc_inner ON pc_inner.id = i.patient_id
                    WHERE pc_inner.country = pc.country
                      AND i.status <> 'cancelled'
                ) AS gross_invoiced
            FROM patient_country pc
            GROUP BY pc.country
            ORDER BY patient_count DESC, pc.country
            LIMIT 20"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let gross_invoiced = if can_see_financial {
                Some(decimal_to_string(
                    row.try_get::<Decimal, _>("gross_invoiced")
                        .unwrap_or(Decimal::ZERO),
                ))
            } else {
                None
            };

            json!({
                "country": row.try_get::<String, _>("country").unwrap_or_else(|_| "Unknown".to_string()),
                "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or(0),
                "active_orders": row.try_get::<i64, _>("active_orders").unwrap_or(0),
                "gross_invoiced": gross_invoiced,
            })
        })
        .collect())
}

async fn load_report_service_types(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                CASE
                    WHEN ol.is_cost_passthrough THEN 'cost_passthrough'
                    WHEN COALESCE(p.provider_type, 'medical') = 'non_medical' THEN 'non_medical'
                    ELSE 'medical'
                END AS service_type,
                COUNT(*)::bigint AS item_count,
                COUNT(DISTINCT o.patient_id)::bigint AS patient_count,
                COUNT(DISTINCT ol.order_id)::bigint AS order_count,
                COALESCE(
                    SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                    0
                ) AS gross_total
           FROM order_leistungen ol
           LEFT JOIN providers p ON p.id = ol.provider_id
           LEFT JOIN orders o ON o.id = ol.order_id
           WHERE ol.status IN ('delivered', 'approved', 'invoiced')
           GROUP BY 1
           ORDER BY item_count DESC, service_type"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let gross_total = if can_see_financial {
                Some(decimal_to_string(
                    row.try_get::<Decimal, _>("gross_total")
                        .unwrap_or(Decimal::ZERO),
                ))
            } else {
                None
            };

            json!({
                "service_type": row.try_get::<String, _>("service_type").unwrap_or_default(),
                "item_count": row.try_get::<i64, _>("item_count").unwrap_or(0),
                "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or(0),
                "order_count": row.try_get::<i64, _>("order_count").unwrap_or(0),
                "gross_total": gross_total,
            })
        })
        .collect())
}

async fn load_report_doctors(
    state: &AppState,
    can_see_financial: bool,
    provider_filter: Option<uuid::Uuid>,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                pd.id,
                pd.provider_id,
                pd.name,
                pd.title,
                pd.fachbereich,
                p.name AS provider_name,
                p.address_city,
                p.address_country,
                (
                    SELECT COUNT(DISTINCT a.patient_id)::bigint
                    FROM appointments a
                    WHERE a.doctor_id = pd.id
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS active_patients_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.doctor_id = pd.id
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS appointments_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM order_leistungen ol
                    WHERE ol.doctor_id = pd.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS delivered_items,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    WHERE ol.doctor_id = pd.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS active_orders,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS feedback_count,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS avg_treatment_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.doctor_score, f.treatment_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS avg_doctor_score,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    JOIN order_followup_flows off ON off.order_id = ol.order_id
                    WHERE ol.doctor_id = pd.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS followup_orders_total,
                (
                    SELECT COUNT(DISTINCT ol.order_id)::bigint
                    FROM order_leistungen ol
                    JOIN order_followup_flows off ON off.order_id = ol.order_id
                    WHERE ol.doctor_id = pd.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                      AND off.doctor_followup_status IN ('completed', 'not_required')
                      AND off.followup_1w_status IN ('completed', 'not_required')
                      AND off.followup_1m_status IN ('completed', 'not_required')
                      AND off.followup_6m_status IN ('completed', 'not_required')
                      AND off.package_end_status IN ('completed', 'not_required')
                      AND off.results_handoff_status = 'completed'
                ) AS followup_completed_orders,
                (
                    SELECT ROUND(
                        AVG(
                            EXTRACT(
                                EPOCH FROM (COALESCE(ac.responded_at, ac.closed_at) - ac.created_at)
                            ) / 3600.0
                        )::numeric,
                        2
                    )
                    FROM appointment_communications ac
                    WHERE ac.doctor_id = pd.id
                      AND ac.target_type = 'doctor'
                      AND ac.direction = 'outbound'
                      AND ac.status IN ('answered', 'closed')
                      AND COALESCE(ac.responded_at, ac.closed_at) IS NOT NULL
                ) AS avg_response_hours,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointment_communications ac
                    WHERE ac.doctor_id = pd.id
                      AND ac.target_type = 'doctor'
                      AND ac.direction = 'outbound'
                      AND ac.status IN ('answered', 'closed')
                      AND COALESCE(ac.responded_at, ac.closed_at) IS NOT NULL
                ) AS response_sample_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointment_communications ac
                    WHERE ac.doctor_id = pd.id
                      AND ac.target_type = 'doctor'
                      AND ac.direction = 'outbound'
                      AND ac.status IN ('planned', 'sent')
                ) AS open_communication_count,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.organization_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS avg_organization_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.service_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS avg_service_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.infrastructure_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS avg_infrastructure_score,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.price_value_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                ) AS avg_price_value_score,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                      AND f.treatment_success = 'yes'
                ) AS treatment_success_yes_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                      AND f.treatment_success = 'partial'
                ) AS treatment_success_partial_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                      AND f.treatment_success IS NOT NULL
                ) AS treatment_success_sample_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.doctor_id = pd.id
                      AND f.complication_reported = true
                ) AS complication_count,
                (
                    SELECT ROUND(AVG(item.turnaround_hours)::numeric, 2)
                    FROM (
                        SELECT EXTRACT(
                                   EPOCH FROM (
                                       MIN(d.created_at) - (
                                           (a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00'))
                                           AT TIME ZONE 'UTC'
                                       )
                                   )
                               ) / 3600.0 AS turnaround_hours
                        FROM documents d
                        JOIN appointments a ON a.id = d.appointment_id
                        WHERE a.doctor_id = pd.id
                          AND d.art = 'arztbrief'
                          AND d.status IN ('active', 'archived')
                          AND d.created_at >= (
                                (a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00'))
                                AT TIME ZONE 'UTC'
                          )
                        GROUP BY a.id, a.date, a.time_start, a.time_end
                    ) item
                ) AS avg_findings_turnaround_hours,
                (
                    SELECT COUNT(*)::bigint
                    FROM (
                        SELECT a.id
                        FROM documents d
                        JOIN appointments a ON a.id = d.appointment_id
                        WHERE a.doctor_id = pd.id
                          AND d.art = 'arztbrief'
                          AND d.status IN ('active', 'archived')
                          AND d.created_at >= (
                                (a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00'))
                                AT TIME ZONE 'UTC'
                          )
                        GROUP BY a.id
                    ) item
                ) AS findings_sample_count,
                (
                    SELECT COALESCE(
                        SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                        0
                    )
                    FROM order_leistungen ol
                    WHERE ol.doctor_id = pd.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS gross_service_volume
           FROM provider_doctors pd
           JOIN providers p ON p.id = pd.provider_id
           WHERE p.is_active = true
             AND p.provider_type = 'medical'
             AND ($1::uuid IS NULL OR pd.provider_id = $1)
           ORDER BY appointments_90d DESC, delivered_items DESC, pd.name
           LIMIT 50"#,
    )
    .bind(provider_filter)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let gross_service_volume = if can_see_financial {
                Some(decimal_to_string(
                    row.try_get::<Decimal, _>("gross_service_volume")
                        .unwrap_or(Decimal::ZERO),
                ))
            } else {
                None
            };
            let followup_orders_total = row
                .try_get::<i64, _>("followup_orders_total")
                .unwrap_or_default();
            let followup_completed_orders = row
                .try_get::<i64, _>("followup_completed_orders")
                .unwrap_or_default();
            let treatment_success_yes_count = row
                .try_get::<i64, _>("treatment_success_yes_count")
                .unwrap_or_default();
            let treatment_success_partial_count = row
                .try_get::<i64, _>("treatment_success_partial_count")
                .unwrap_or_default();
            let treatment_success_sample_count = row
                .try_get::<i64, _>("treatment_success_sample_count")
                .unwrap_or_default();
            let complication_count = row
                .try_get::<i64, _>("complication_count")
                .unwrap_or_default();
            let feedback_count = row.try_get::<i64, _>("feedback_count").unwrap_or(0);

            json!({
                "doctor_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "provider_id": row.try_get::<uuid::Uuid, _>("provider_id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
                "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
                "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
                "address_country": row.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
                "active_patients_90d": row.try_get::<i64, _>("active_patients_90d").unwrap_or(0),
                "appointments_90d": row.try_get::<i64, _>("appointments_90d").unwrap_or(0),
                "delivered_items": row.try_get::<i64, _>("delivered_items").unwrap_or(0),
                "active_orders": row.try_get::<i64, _>("active_orders").unwrap_or(0),
                "feedback_count": feedback_count,
                "avg_treatment_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_treatment_score").unwrap_or_default()
                ),
                "avg_doctor_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_doctor_score").unwrap_or_default()
                ),
                "avg_organization_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_organization_score").unwrap_or_default()
                ),
                "avg_service_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_service_score").unwrap_or_default()
                ),
                "avg_infrastructure_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_infrastructure_score").unwrap_or_default()
                ),
                "avg_price_value_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_price_value_score").unwrap_or_default()
                ),
                "avg_response_hours": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_response_hours").unwrap_or_default()
                ),
                "avg_findings_turnaround_hours": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_findings_turnaround_hours").unwrap_or_default()
                ),
                "response_sample_count": row.try_get::<i64, _>("response_sample_count").unwrap_or(0),
                "open_communication_count": row.try_get::<i64, _>("open_communication_count").unwrap_or(0),
                "findings_sample_count": row.try_get::<i64, _>("findings_sample_count").unwrap_or(0),
                "treatment_success_yes_rate": percentage(
                    treatment_success_yes_count,
                    treatment_success_sample_count,
                ),
                "treatment_success_partial_rate": percentage(
                    treatment_success_partial_count,
                    treatment_success_sample_count,
                ),
                "complication_rate": percentage(complication_count, feedback_count),
                "followup_orders_total": followup_orders_total,
                "followup_completed_orders": followup_completed_orders,
                "followup_completion_rate": percentage(
                    followup_completed_orders,
                    followup_orders_total,
                ),
                "gross_service_volume": gross_service_volume,
            })
        })
        .collect())
}

async fn load_report_non_medical_providers(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                p.id,
                p.name,
                p.address_city,
                p.address_country,
                (
                    SELECT COUNT(*)::bigint
                    FROM service_catalog s
                    WHERE s.provider_id = p.id
                ) AS service_count,
                (
                    SELECT COUNT(DISTINCT patient_id)::bigint
                    FROM (
                        SELECT a.patient_id
                        FROM appointments a
                        WHERE a.provider_id = p.id
                          AND a.status <> 'cancelled'
                          AND a.date >= CURRENT_DATE - 90
                        UNION
                        SELECT cs.patient_id
                        FROM concierge_services cs
                        WHERE cs.provider_id = p.id
                          AND cs.created_at >= now() - INTERVAL '90 days'
                        UNION
                        SELECT o.patient_id
                        FROM order_leistungen ol
                        JOIN orders o ON o.id = ol.order_id
                        WHERE ol.provider_id = p.id
                          AND ol.status IN ('delivered', 'approved', 'invoiced')
                          AND ol.created_at >= now() - INTERVAL '90 days'
                    ) linked_patients
                ) AS active_patients_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.appointment_type = 'non_medical'
                      AND a.status <> 'cancelled'
                      AND a.date >= CURRENT_DATE - 90
                ) AS appointments_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                      AND cs.created_at >= now() - INTERVAL '90 days'
                ) AS concierge_requests_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                      AND cs.status IN ('planned', 'booked', 'confirmed', 'in_service')
                ) AS open_concierge_requests,
                (
                    SELECT COUNT(*)::bigint
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                      AND cs.status = 'completed'
                      AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= now() - INTERVAL '90 days'
                ) AS completed_concierge_requests_90d,
                (
                    SELECT COUNT(*)::bigint
                    FROM order_leistungen ol
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS delivered_items,
                (
                    SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(cs.vendor_name), ''), cs.title))::bigint
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                ) AS vendor_count,
                (
                    SELECT COALESCE(json_agg(item.label ORDER BY item.label), '[]'::json)
                    FROM (
                        SELECT DISTINCT label
                        FROM (
                            SELECT s.service_name AS label
                            FROM service_catalog s
                            WHERE s.provider_id = p.id
                            UNION
                            SELECT INITCAP(REPLACE(cs.service_kind, '_', ' ')) AS label
                            FROM concierge_services cs
                            WHERE cs.provider_id = p.id
                        ) labels
                        WHERE label IS NOT NULL AND TRIM(label) <> ''
                        ORDER BY label
                        LIMIT 5
                    ) item
                ) AS service_focus,
                (
                    SELECT ROUND(
                        AVG(COALESCE(f.concierge_score, f.overall_score))::numeric,
                        2
                    )
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS avg_concierge_score,
                (
                    SELECT COUNT(*)::bigint
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                ) AS feedback_count,
                (
                    SELECT COALESCE(
                        SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                        0
                    )
                    FROM order_leistungen ol
                    WHERE ol.provider_id = p.id
                      AND ol.status IN ('delivered', 'approved', 'invoiced')
                ) AS gross_service_volume
           FROM providers p
           WHERE p.is_active = true
             AND p.provider_type = 'non_medical'
           ORDER BY concierge_requests_90d DESC, appointments_90d DESC, p.name
           LIMIT 25"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let gross_service_volume = if can_see_financial {
                Some(decimal_to_string(
                    row.try_get::<Decimal, _>("gross_service_volume")
                        .unwrap_or(Decimal::ZERO),
                ))
            } else {
                None
            };

            json!({
                "provider_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
                "address_country": row.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
                "service_count": row.try_get::<i64, _>("service_count").unwrap_or(0),
                "active_patients_90d": row.try_get::<i64, _>("active_patients_90d").unwrap_or(0),
                "appointments_90d": row.try_get::<i64, _>("appointments_90d").unwrap_or(0),
                "concierge_requests_90d": row.try_get::<i64, _>("concierge_requests_90d").unwrap_or(0),
                "open_concierge_requests": row.try_get::<i64, _>("open_concierge_requests").unwrap_or(0),
                "completed_concierge_requests_90d": row.try_get::<i64, _>("completed_concierge_requests_90d").unwrap_or(0),
                "delivered_items": row.try_get::<i64, _>("delivered_items").unwrap_or(0),
                "vendor_count": row.try_get::<i64, _>("vendor_count").unwrap_or(0),
                "service_focus": row.try_get::<Value, _>("service_focus").unwrap_or_else(|_| json!([])),
                "avg_concierge_score": optional_decimal_to_f64(
                    row.try_get::<Option<Decimal>, _>("avg_concierge_score").unwrap_or_default()
                ),
                "feedback_count": row.try_get::<i64, _>("feedback_count").unwrap_or(0),
                "gross_service_volume": gross_service_volume,
            })
        })
        .collect())
}

async fn load_forecast_quote_pipeline(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Value, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                q.status,
                COUNT(*)::bigint AS quote_count,
                COUNT(*) FILTER (
                    WHERE q.valid_until IS NOT NULL
                      AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
                )::bigint AS expiring_next_14d,
                COALESCE(SUM(q.total_gross), 0) AS gross_total
           FROM quotes q
           WHERE q.status IN ('draft', 'sent', 'accepted')
           GROUP BY q.status
           ORDER BY
                CASE q.status
                    WHEN 'accepted' THEN 1
                    WHEN 'sent' THEN 2
                    ELSE 3
                END"#,
    )
    .fetch_all(&state.db)
    .await?;

    let mut open_quotes = 0;
    let mut expiring_next_14d = 0;
    let mut gross_total_all = Decimal::ZERO;
    let mut weighted_total = Decimal::ZERO;
    let mut by_status = Vec::with_capacity(rows.len());

    for row in rows {
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let quote_count = row.try_get::<i64, _>("quote_count").unwrap_or(0);
        let expiring = row.try_get::<i64, _>("expiring_next_14d").unwrap_or(0);
        let gross_total = row
            .try_get::<Decimal, _>("gross_total")
            .unwrap_or(Decimal::ZERO);
        let weighted_gross = (gross_total * quote_status_weight(&status)).round_dp(2);

        open_quotes += quote_count;
        expiring_next_14d += expiring;
        gross_total_all += gross_total;
        weighted_total += weighted_gross;

        by_status.push(json!({
            "status": status,
            "quote_count": quote_count,
            "expiring_next_14d": expiring,
            "gross_total": can_see_financial.then(|| decimal_to_string(gross_total)),
            "weighted_gross": can_see_financial.then(|| decimal_to_string(weighted_gross)),
        }));
    }

    Ok(json!({
        "open_quotes": open_quotes,
        "expiring_next_14d": expiring_next_14d,
        "gross_total": can_see_financial.then(|| decimal_to_string(gross_total_all)),
        "weighted_gross": can_see_financial.then(|| decimal_to_string(weighted_total)),
        "by_status": by_status,
    }))
}

async fn load_forecast_collections(
    state: &AppState,
    can_see_financial: bool,
) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(
        r#"WITH invoice_scope AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE status NOT IN ('paid', 'cancelled')
                          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
                    )::bigint AS due_next_14d_count,
                    COALESCE(
                        SUM(GREATEST(total_gross - COALESCE(paid_amount, 0), 0)) FILTER (
                            WHERE status NOT IN ('paid', 'cancelled')
                              AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
                        ),
                        0
                    ) AS due_next_14d_total,
                    COUNT(*) FILTER (
                        WHERE status = 'overdue'
                          AND total_gross > COALESCE(paid_amount, 0)
                    )::bigint AS overdue_invoice_count,
                    COALESCE(
                        SUM(GREATEST(total_gross - COALESCE(paid_amount, 0), 0)) FILTER (
                            WHERE status = 'overdue'
                        ),
                        0
                    ) AS overdue_open_total,
                    COALESCE(
                        SUM(GREATEST(total_gross - COALESCE(paid_amount, 0), 0)) FILTER (
                            WHERE status NOT IN ('paid', 'cancelled')
                        ),
                        0
                    ) AS outstanding_open_total
                FROM invoices
            ),
            debt_scope AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE status IN ('review_required', 'payment_plan', 'awaiting_payment', 'escalated')
                    )::bigint AS workflow_open_count,
                    COUNT(*) FILTER (WHERE status = 'payment_plan')::bigint AS payment_plan_count,
                    COUNT(*) FILTER (WHERE status = 'escalated')::bigint AS escalated_count,
                    COUNT(*) FILTER (
                        WHERE status IN ('review_required', 'payment_plan', 'awaiting_payment', 'escalated')
                          AND next_review_at IS NOT NULL
                          AND next_review_at <= now() + interval '7 day'
                    )::bigint AS reviews_due_7d
                FROM order_debt_management
            )
            SELECT
                invoice_scope.due_next_14d_count,
                invoice_scope.due_next_14d_total,
                invoice_scope.overdue_invoice_count,
                invoice_scope.overdue_open_total,
                invoice_scope.outstanding_open_total,
                debt_scope.workflow_open_count,
                debt_scope.payment_plan_count,
                debt_scope.escalated_count,
                debt_scope.reviews_due_7d
            FROM invoice_scope, debt_scope"#,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(json!({
        "due_next_14d_count": row.try_get::<i64, _>("due_next_14d_count").unwrap_or(0),
        "due_next_14d_total": can_see_financial.then(|| {
            decimal_to_string(
                row.try_get::<Decimal, _>("due_next_14d_total").unwrap_or(Decimal::ZERO),
            )
        }),
        "overdue_invoice_count": row.try_get::<i64, _>("overdue_invoice_count").unwrap_or(0),
        "overdue_open_total": can_see_financial.then(|| {
            decimal_to_string(
                row.try_get::<Decimal, _>("overdue_open_total").unwrap_or(Decimal::ZERO),
            )
        }),
        "outstanding_open_total": can_see_financial.then(|| {
            decimal_to_string(
                row.try_get::<Decimal, _>("outstanding_open_total").unwrap_or(Decimal::ZERO),
            )
        }),
        "workflow_open_count": row.try_get::<i64, _>("workflow_open_count").unwrap_or(0),
        "payment_plan_count": row.try_get::<i64, _>("payment_plan_count").unwrap_or(0),
        "escalated_count": row.try_get::<i64, _>("escalated_count").unwrap_or(0),
        "reviews_due_7d": row.try_get::<i64, _>("reviews_due_7d").unwrap_or(0),
    }))
}

async fn load_forecast_followup(state: &AppState) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(
        r#"WITH closure_anchor AS (
                SELECT
                    entity_id AS order_id,
                    MAX(created_at) FILTER (WHERE to_stage = 'closure') AS closure_anchor_at
                FROM workflow_lifecycle_events
                WHERE entity_type = 'order'
                GROUP BY entity_id
            ),
            scoped AS (
                SELECT
                    o.id,
                    off.doctor_followup_status,
                    off.followup_1w_status,
                    off.followup_1m_status,
                    off.followup_6m_status,
                    off.package_end_date,
                    off.package_end_status,
                    off.results_handoff_status,
                    ca.closure_anchor_at
                FROM orders o
                JOIN order_followup_flows off ON off.order_id = o.id
                LEFT JOIN closure_anchor ca ON ca.order_id = o.id
                WHERE o.status = 'active'
            )
            SELECT
                COUNT(*) FILTER (
                    WHERE doctor_followup_status NOT IN ('completed', 'not_required')
                       OR followup_1w_status NOT IN ('completed', 'not_required')
                       OR followup_1m_status NOT IN ('completed', 'not_required')
                       OR followup_6m_status NOT IN ('completed', 'not_required')
                       OR package_end_status NOT IN ('completed', 'not_required')
                       OR results_handoff_status = 'pending'
                )::bigint AS active_orders,
                COUNT(*) FILTER (
                    WHERE doctor_followup_status NOT IN ('completed', 'not_required')
                )::bigint AS doctor_followup_open,
                COUNT(*) FILTER (
                    WHERE followup_1w_status NOT IN ('completed', 'not_required')
                      AND closure_anchor_at + interval '7 day' BETWEEN now() AND now() + interval '30 day'
                )::bigint AS followup_1w_due_next_30d,
                COUNT(*) FILTER (
                    WHERE followup_1m_status NOT IN ('completed', 'not_required')
                      AND closure_anchor_at + interval '30 day' BETWEEN now() AND now() + interval '30 day'
                )::bigint AS followup_1m_due_next_30d,
                COUNT(*) FILTER (
                    WHERE followup_6m_status NOT IN ('completed', 'not_required')
                      AND closure_anchor_at + interval '182 day' BETWEEN now() AND now() + interval '30 day'
                )::bigint AS followup_6m_due_next_30d,
                COUNT(*) FILTER (
                    WHERE package_end_status NOT IN ('completed', 'not_required')
                      AND package_end_date IS NOT NULL
                      AND package_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                )::bigint AS package_end_due_next_30d,
                COUNT(*) FILTER (
                    WHERE results_handoff_status = 'pending'
                )::bigint AS results_handoff_pending
            FROM scoped"#,
    )
    .fetch_one(&state.db)
    .await?;

    let followup_1w_due_next_30d = row
        .try_get::<i64, _>("followup_1w_due_next_30d")
        .unwrap_or(0);
    let followup_1m_due_next_30d = row
        .try_get::<i64, _>("followup_1m_due_next_30d")
        .unwrap_or(0);
    let followup_6m_due_next_30d = row
        .try_get::<i64, _>("followup_6m_due_next_30d")
        .unwrap_or(0);
    let package_end_due_next_30d = row
        .try_get::<i64, _>("package_end_due_next_30d")
        .unwrap_or(0);

    Ok(json!({
        "active_orders": row.try_get::<i64, _>("active_orders").unwrap_or(0),
        "doctor_followup_open": row.try_get::<i64, _>("doctor_followup_open").unwrap_or(0),
        "followup_1w_due_next_30d": followup_1w_due_next_30d,
        "followup_1m_due_next_30d": followup_1m_due_next_30d,
        "followup_6m_due_next_30d": followup_6m_due_next_30d,
        "package_end_due_next_30d": package_end_due_next_30d,
        "results_handoff_pending": row.try_get::<i64, _>("results_handoff_pending").unwrap_or(0),
        "milestones_due_next_30d":
            followup_1w_due_next_30d
            + followup_1m_due_next_30d
            + followup_6m_due_next_30d
            + package_end_due_next_30d,
    }))
}

async fn load_forecast_clinic_capacity(state: &AppState) -> Result<Value, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                p.id,
                p.name,
                p.address_city,
                (
                    SELECT COUNT(*)::bigint
                    FROM provider_doctors pd
                    WHERE pd.provider_id = p.id
                ) AS doctor_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status IN ('planned', 'confirmed', 'in_progress')
                      AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                ) AS appointments_next_30d,
                (
                    SELECT COUNT(*)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status IN ('planned', 'confirmed', 'in_progress')
                      AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                      AND a.checklist_phase = 'followup'
                ) AS followup_appointments_next_30d,
                (
                    SELECT COUNT(DISTINCT a.patient_id)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status IN ('planned', 'confirmed', 'in_progress')
                      AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                ) AS patients_next_30d,
                (
                    SELECT COUNT(DISTINCT a.order_id)::bigint
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status IN ('planned', 'confirmed', 'in_progress')
                      AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                ) AS active_orders_next_30d
           FROM providers p
           WHERE p.is_active = true
             AND p.provider_type = 'medical'
             AND EXISTS (
                    SELECT 1
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.status IN ('planned', 'confirmed', 'in_progress')
                      AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                )
           ORDER BY appointments_next_30d DESC, patients_next_30d DESC, p.name
           LIMIT 15"#,
    )
    .fetch_all(&state.db)
    .await?;

    let mut appointments_next_30d_total = 0;
    let mut followup_appointments_next_30d_total = 0;
    let mut clinics = Vec::with_capacity(rows.len());

    for row in rows {
        let appointments_next_30d = row.try_get::<i64, _>("appointments_next_30d").unwrap_or(0);
        let followup_appointments_next_30d = row
            .try_get::<i64, _>("followup_appointments_next_30d")
            .unwrap_or(0);
        appointments_next_30d_total += appointments_next_30d;
        followup_appointments_next_30d_total += followup_appointments_next_30d;

        clinics.push(json!({
            "provider_id": row.try_get::<uuid::Uuid, _>("id").unwrap_or_else(|_| uuid::Uuid::nil()),
            "name": row.try_get::<String, _>("name").unwrap_or_default(),
            "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
            "doctor_count": row.try_get::<i64, _>("doctor_count").unwrap_or(0),
            "appointments_next_30d": appointments_next_30d,
            "followup_appointments_next_30d": followup_appointments_next_30d,
            "patients_next_30d": row.try_get::<i64, _>("patients_next_30d").unwrap_or(0),
            "active_orders_next_30d": row.try_get::<i64, _>("active_orders_next_30d").unwrap_or(0),
        }));
    }

    Ok(json!({
        "appointments_next_30d_total": appointments_next_30d_total,
        "followup_appointments_next_30d_total": followup_appointments_next_30d_total,
        "active_clinics": clinics.len(),
        "clinics": clinics,
    }))
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn csv_row(values: &[String]) -> String {
    values
        .iter()
        .map(|value| csv_escape(value))
        .collect::<Vec<_>>()
        .join(",")
}

fn export_clinics_csv(rows: Vec<Value>) -> String {
    let mut lines = vec![csv_row(&[
        "clinic".to_string(),
        "city".to_string(),
        "country".to_string(),
        "doctor_count".to_string(),
        "patients_90d".to_string(),
        "appointments_90d".to_string(),
        "delivered_items".to_string(),
        "feedback".to_string(),
        "treatment_score".to_string(),
        "doctor_score".to_string(),
        "organization_score".to_string(),
        "service_score".to_string(),
        "infrastructure_score".to_string(),
        "price_value_score".to_string(),
        "treatment_success_yes_rate".to_string(),
        "treatment_success_partial_rate".to_string(),
        "complication_rate".to_string(),
        "avg_response_hours".to_string(),
        "avg_findings_turnaround_hours".to_string(),
        "findings_sample_count".to_string(),
        "response_sample_count".to_string(),
        "open_communication_count".to_string(),
        "followup_completed_orders".to_string(),
        "followup_orders_total".to_string(),
        "followup_completion_rate".to_string(),
        "gross_service_volume".to_string(),
    ])];

    for row in rows {
        lines.push(csv_row(&[
            row["name"].as_str().unwrap_or_default().to_string(),
            row["address_city"].as_str().unwrap_or_default().to_string(),
            row["address_country"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            row["doctor_count"].as_i64().unwrap_or_default().to_string(),
            row["active_patients_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["appointments_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["delivered_items"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["avg_feedback_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_treatment_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_doctor_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_organization_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_service_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_infrastructure_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_price_value_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["treatment_success_yes_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["treatment_success_partial_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["complication_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_response_hours"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_findings_turnaround_hours"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["findings_sample_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["response_sample_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["open_communication_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["followup_completed_orders"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["followup_orders_total"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["followup_completion_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["gross_service_volume"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ]));
    }

    lines.join("\n")
}

fn export_countries_csv(rows: Vec<Value>) -> String {
    let mut lines = vec![csv_row(&[
        "country".to_string(),
        "active_patients".to_string(),
        "active_orders".to_string(),
        "gross_invoiced".to_string(),
    ])];

    for row in rows {
        lines.push(csv_row(&[
            row["country"].as_str().unwrap_or_default().to_string(),
            row["patient_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["active_orders"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["gross_invoiced"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ]));
    }

    lines.join("\n")
}

fn export_service_types_csv(rows: Vec<Value>) -> String {
    let mut lines = vec![csv_row(&[
        "service_type".to_string(),
        "items".to_string(),
        "patients".to_string(),
        "orders".to_string(),
        "gross_total".to_string(),
    ])];

    for row in rows {
        lines.push(csv_row(&[
            row["service_type"].as_str().unwrap_or_default().to_string(),
            row["item_count"].as_i64().unwrap_or_default().to_string(),
            row["patient_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["order_count"].as_i64().unwrap_or_default().to_string(),
            row["gross_total"].as_str().unwrap_or_default().to_string(),
        ]));
    }

    lines.join("\n")
}

fn export_doctors_csv(rows: Vec<Value>) -> String {
    let mut lines = vec![csv_row(&[
        "clinic".to_string(),
        "doctor".to_string(),
        "title".to_string(),
        "specialty".to_string(),
        "city".to_string(),
        "country".to_string(),
        "patients_90d".to_string(),
        "appointments_90d".to_string(),
        "active_orders".to_string(),
        "delivered_items".to_string(),
        "feedback_count".to_string(),
        "treatment_score".to_string(),
        "doctor_score".to_string(),
        "organization_score".to_string(),
        "service_score".to_string(),
        "infrastructure_score".to_string(),
        "price_value_score".to_string(),
        "treatment_success_yes_rate".to_string(),
        "treatment_success_partial_rate".to_string(),
        "complication_rate".to_string(),
        "avg_response_hours".to_string(),
        "avg_findings_turnaround_hours".to_string(),
        "findings_sample_count".to_string(),
        "response_sample_count".to_string(),
        "open_communication_count".to_string(),
        "followup_completed_orders".to_string(),
        "followup_orders_total".to_string(),
        "followup_completion_rate".to_string(),
        "gross_service_volume".to_string(),
    ])];

    for row in rows {
        lines.push(csv_row(&[
            row["provider_name"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            row["name"].as_str().unwrap_or_default().to_string(),
            row["title"].as_str().unwrap_or_default().to_string(),
            row["fachbereich"].as_str().unwrap_or_default().to_string(),
            row["address_city"].as_str().unwrap_or_default().to_string(),
            row["address_country"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            row["active_patients_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["appointments_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["active_orders"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["delivered_items"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["feedback_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["avg_treatment_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_doctor_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_organization_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_service_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_infrastructure_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_price_value_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["treatment_success_yes_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["treatment_success_partial_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["complication_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_response_hours"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["avg_findings_turnaround_hours"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["findings_sample_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["response_sample_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["open_communication_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["followup_completed_orders"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["followup_orders_total"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["followup_completion_rate"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["gross_service_volume"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ]));
    }

    lines.join("\n")
}

fn export_non_medical_providers_csv(rows: Vec<Value>) -> String {
    let mut lines = vec![csv_row(&[
        "provider".to_string(),
        "city".to_string(),
        "country".to_string(),
        "service_count".to_string(),
        "service_focus".to_string(),
        "patients_90d".to_string(),
        "appointments_90d".to_string(),
        "concierge_requests_90d".to_string(),
        "open_concierge_requests".to_string(),
        "completed_concierge_requests_90d".to_string(),
        "delivered_items".to_string(),
        "vendor_count".to_string(),
        "feedback_count".to_string(),
        "concierge_score".to_string(),
        "gross_service_volume".to_string(),
    ])];

    for row in rows {
        let service_focus = row["service_focus"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .unwrap_or_default();

        lines.push(csv_row(&[
            row["name"].as_str().unwrap_or_default().to_string(),
            row["address_city"].as_str().unwrap_or_default().to_string(),
            row["address_country"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            row["service_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            service_focus,
            row["active_patients_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["appointments_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["concierge_requests_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["open_concierge_requests"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["completed_concierge_requests_90d"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["delivered_items"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["vendor_count"].as_i64().unwrap_or_default().to_string(),
            row["feedback_count"]
                .as_i64()
                .unwrap_or_default()
                .to_string(),
            row["avg_concierge_score"]
                .as_f64()
                .map(|value| format!("{value:.1}"))
                .unwrap_or_default(),
            row["gross_service_volume"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ]));
    }

    lines.join("\n")
}

fn risk_severity_rank(value: &str) -> i32 {
    match value {
        "urgent" => 3,
        "high" => 2,
        "medium" => 1,
        _ => 0,
    }
}

async fn load_patient_manager_risks(
    state: &AppState,
    manager_scope: Option<uuid::Uuid>,
) -> Result<PatientManagerRiskPayload, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH scoped_patients AS (
                SELECT DISTINCT
                    p.id,
                    p.patient_id,
                    p.first_name,
                    p.last_name,
                    p.functional_labels
                FROM patients p
                JOIN patient_assignments pa
                  ON pa.patient_id = p.id
                 AND pa.revoked_at IS NULL
                WHERE p.is_active = true
                  AND ($1::uuid IS NULL OR pa.user_id = $1)
            ),
            case_stats AS (
                SELECT
                    c.patient_id,
                    COUNT(*) FILTER (WHERE c.status <> 'closed')::bigint AS open_case_count
                FROM cases c
                GROUP BY c.patient_id
            ),
            appointment_stats AS (
                SELECT
                    a.patient_id,
                    COUNT(*) FILTER (
                        WHERE a.status IN ('planned', 'confirmed', 'in_progress')
                    )::bigint AS open_appointment_count,
                    COUNT(*) FILTER (
                        WHERE a.status IN ('planned', 'confirmed', 'in_progress')
                          AND a.date < CURRENT_DATE
                    )::bigint AS overdue_appointment_count
                FROM appointments a
                GROUP BY a.patient_id
            ),
            task_stats AS (
                SELECT
                    t.patient_id,
                    COUNT(*) FILTER (
                        WHERE t.status NOT IN ('completed', 'cancelled')
                    )::bigint AS open_task_count,
                    COUNT(*) FILTER (
                        WHERE t.status NOT IN ('completed', 'cancelled')
                          AND t.due_date < now()
                    )::bigint AS overdue_task_count
                FROM tasks t
                WHERE t.patient_id IS NOT NULL
                GROUP BY t.patient_id
            ),
            checklist_stats AS (
                SELECT
                    w.patient_id,
                    COUNT(*) FILTER (WHERE NOT w.is_completed)::bigint AS open_checklist_count,
                    COUNT(*) FILTER (
                        WHERE NOT w.is_completed
                          AND w.due_date < now()
                    )::bigint AS overdue_checklist_count
                FROM workflow_checklist_items w
                WHERE w.patient_id IS NOT NULL
                GROUP BY w.patient_id
            )
            SELECT
                sp.id,
                sp.patient_id,
                sp.first_name,
                sp.last_name,
                sp.functional_labels,
                COALESCE(cs.open_case_count, 0) AS open_case_count,
                COALESCE(ap.open_appointment_count, 0) AS open_appointment_count,
                COALESCE(ap.overdue_appointment_count, 0) AS overdue_appointment_count,
                COALESCE(ts.open_task_count, 0) AS open_task_count,
                COALESCE(ts.overdue_task_count, 0) AS overdue_task_count,
                COALESCE(ch.open_checklist_count, 0) AS open_checklist_count,
                COALESCE(ch.overdue_checklist_count, 0) AS overdue_checklist_count
            FROM scoped_patients sp
            LEFT JOIN case_stats cs ON cs.patient_id = sp.id
            LEFT JOIN appointment_stats ap ON ap.patient_id = sp.id
            LEFT JOIN task_stats ts ON ts.patient_id = sp.id
            LEFT JOIN checklist_stats ch ON ch.patient_id = sp.id
            WHERE COALESCE(cs.open_case_count, 0) > 0
               OR COALESCE(ap.open_appointment_count, 0) > 0
               OR COALESCE(ts.open_task_count, 0) > 0
               OR COALESCE(ch.open_checklist_count, 0) > 0
               OR 'high_risk' = ANY(COALESCE(sp.functional_labels, ARRAY[]::text[]))
               OR 'fall_risk' = ANY(COALESCE(sp.functional_labels, ARRAY[]::text[]))
            ORDER BY
                COALESCE(ap.overdue_appointment_count, 0) DESC,
                COALESCE(ts.overdue_task_count, 0) DESC,
                COALESCE(ch.overdue_checklist_count, 0) DESC,
                COALESCE(cs.open_case_count, 0) DESC,
                sp.last_name,
                sp.first_name
            LIMIT 25"#,
    )
    .bind(manager_scope)
    .fetch_all(&state.db)
    .await?;

    let mut alerts = Vec::new();
    let mut urgent_alerts = 0;
    let mut high_alerts = 0;
    let mut medium_alerts = 0;
    let mut complex_case_alerts = 0;
    let mut overdue_appointments = 0;
    let mut overdue_tasks = 0;
    let mut overdue_checklists = 0;

    for row in rows {
        let patient_id = row
            .try_get::<uuid::Uuid, _>("id")
            .unwrap_or_else(|_| uuid::Uuid::nil());
        let patient_label = format!(
            "{} {}",
            row.try_get::<String, _>("first_name").unwrap_or_default(),
            row.try_get::<String, _>("last_name").unwrap_or_default()
        )
        .trim()
        .to_string();
        let functional_labels = row
            .try_get::<Vec<String>, _>("functional_labels")
            .unwrap_or_default();
        let high_risk_label = functional_labels.iter().any(|value| value == "high_risk");
        let fall_risk_label = functional_labels.iter().any(|value| value == "fall_risk");
        let open_case_count = row.try_get::<i64, _>("open_case_count").unwrap_or(0);
        let open_appointment_count = row.try_get::<i64, _>("open_appointment_count").unwrap_or(0);
        let overdue_appointment_count = row
            .try_get::<i64, _>("overdue_appointment_count")
            .unwrap_or(0);
        let open_task_count = row.try_get::<i64, _>("open_task_count").unwrap_or(0);
        let overdue_task_count = row.try_get::<i64, _>("overdue_task_count").unwrap_or(0);
        let overdue_checklist_count = row
            .try_get::<i64, _>("overdue_checklist_count")
            .unwrap_or(0);

        let complex_case = high_risk_label
            || fall_risk_label
            || open_case_count >= 2
            || (open_case_count >= 1 && open_appointment_count >= 2);

        let mut reasons = Vec::new();
        if high_risk_label {
            reasons.push("Patient carries the `high_risk` functional label".to_string());
        }
        if fall_risk_label {
            reasons.push("Patient carries the `fall_risk` functional label".to_string());
        }
        if open_case_count >= 2 {
            reasons.push("Multiple open clinical cases require close coordination".to_string());
        } else if open_case_count >= 1 && reasons.is_empty() {
            reasons.push("Open clinical case still needs active coordination".to_string());
        }
        if overdue_appointment_count > 0 {
            reasons.push(format!(
                "{overdue_appointment_count} open appointment(s) are already overdue"
            ));
        }
        if open_appointment_count >= 3 {
            reasons.push(format!(
                "{open_appointment_count} open appointments create coordination pressure"
            ));
        }
        if overdue_task_count > 0 {
            reasons.push(format!("{overdue_task_count} PM task(s) are overdue"));
        }
        if overdue_checklist_count > 0 {
            reasons.push(format!(
                "{overdue_checklist_count} workflow checklist item(s) are overdue"
            ));
        }

        if reasons.is_empty() {
            continue;
        }

        let severity = if overdue_appointment_count > 0
            || overdue_task_count > 0
            || overdue_checklist_count > 0
        {
            "urgent"
        } else if complex_case || open_appointment_count >= 3 {
            "high"
        } else {
            "medium"
        };

        match severity {
            "urgent" => urgent_alerts += 1,
            "high" => high_alerts += 1,
            _ => medium_alerts += 1,
        }
        if complex_case {
            complex_case_alerts += 1;
        }
        overdue_appointments += overdue_appointment_count;
        overdue_tasks += overdue_task_count;
        overdue_checklists += overdue_checklist_count;

        alerts.push(PatientManagerRiskAlert {
            patient_id: patient_id.to_string(),
            patient_label,
            severity,
            title: "Care coordination risk".to_string(),
            reasons,
            open_case_count,
            open_appointment_count,
            overdue_appointment_count,
            open_task_count,
            overdue_task_count,
            overdue_checklist_count,
            high_risk_label,
            fall_risk_label,
        });
    }

    alerts.sort_by(|left, right| {
        risk_severity_rank(right.severity)
            .cmp(&risk_severity_rank(left.severity))
            .then(
                right
                    .overdue_appointment_count
                    .cmp(&left.overdue_appointment_count),
            )
            .then(right.overdue_task_count.cmp(&left.overdue_task_count))
            .then(right.open_case_count.cmp(&left.open_case_count))
            .then(left.patient_label.cmp(&right.patient_label))
    });

    Ok(PatientManagerRiskPayload {
        summary: PatientManagerRiskSummary {
            total_alerts: alerts.len() as i64,
            urgent_alerts,
            high_alerts,
            medium_alerts,
            complex_case_alerts,
            overdue_appointments,
            overdue_tasks,
            overdue_checklists,
        },
        alerts,
    })
}

async fn load_billing_risks(state: &AppState) -> Result<BillingRiskPayload, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH service_stats AS (
                SELECT
                    ol.order_id,
                    COALESCE(
                        SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                        0
                    ) AS service_gross
                FROM order_leistungen ol
                WHERE ol.status IN ('delivered', 'approved', 'invoiced')
                GROUP BY ol.order_id
            ),
            invoice_stats AS (
                SELECT
                    i.order_id,
                    COUNT(*) FILTER (WHERE i.status = 'overdue')::bigint AS overdue_invoice_count,
                    COUNT(*) FILTER (
                        WHERE i.status NOT IN ('paid', 'cancelled')
                    )::bigint AS open_invoice_count,
                    COUNT(*) FILTER (
                        WHERE i.invoice_type = 'advance'
                          AND i.status NOT IN ('paid', 'cancelled')
                    )::bigint AS unpaid_advance_invoice_count,
                    COALESCE(
                        SUM(i.total_gross) FILTER (WHERE i.status <> 'cancelled'),
                        0
                    ) AS invoiced_total,
                    COALESCE(
                        SUM(GREATEST(i.total_gross - i.paid_amount, 0))
                            FILTER (WHERE i.status NOT IN ('paid', 'cancelled')),
                        0
                    ) AS outstanding_balance
                FROM invoices i
                GROUP BY i.order_id
            )
            SELECT
                o.id,
                o.order_number,
                o.patient_id,
                p.first_name,
                p.last_name,
                o.phase,
                o.billing_release_status,
                o.package_coverage_status,
                COALESCE(ss.service_gross, 0) AS service_gross,
                COALESCE(inv.invoiced_total, 0) AS invoiced_total,
                COALESCE(inv.outstanding_balance, 0) AS outstanding_balance,
                COALESCE(inv.overdue_invoice_count, 0) AS overdue_invoice_count,
                COALESCE(inv.unpaid_advance_invoice_count, 0) AS unpaid_advance_invoice_count
            FROM orders o
            JOIN patients p ON p.id = o.patient_id
            LEFT JOIN service_stats ss ON ss.order_id = o.id
            LEFT JOIN invoice_stats inv ON inv.order_id = o.id
            WHERE o.status = 'active'
              AND (
                    COALESCE(inv.overdue_invoice_count, 0) > 0
                 OR COALESCE(inv.outstanding_balance, 0) > 0
                 OR COALESCE(inv.unpaid_advance_invoice_count, 0) > 0
                 OR (
                        COALESCE(ss.service_gross, 0) > COALESCE(inv.invoiced_total, 0)
                    AND o.phase IN ('execution', 'closure', 'followup')
                 )
                 OR (
                        o.billing_release_status <> 'granted'
                    AND o.package_coverage_status <> 'covered'
                 )
              )
            ORDER BY
                COALESCE(inv.overdue_invoice_count, 0) DESC,
                COALESCE(inv.outstanding_balance, 0) DESC,
                COALESCE(ss.service_gross, 0) DESC,
                o.order_number"#,
    )
    .fetch_all(&state.db)
    .await?;

    let mut alerts = Vec::new();
    let mut urgent_alerts = 0;
    let mut high_alerts = 0;
    let mut medium_alerts = 0;
    let mut overdue_invoice_count = 0;
    let mut blocked_orders = 0;
    let mut outstanding_balance_total = Decimal::ZERO;
    let mut exposure_gap_total = Decimal::ZERO;

    for row in rows {
        let order_id = row
            .try_get::<uuid::Uuid, _>("id")
            .unwrap_or_else(|_| uuid::Uuid::nil());
        let patient_id = row
            .try_get::<uuid::Uuid, _>("patient_id")
            .unwrap_or_else(|_| uuid::Uuid::nil());
        let patient_label = format!(
            "{} {}",
            row.try_get::<String, _>("first_name").unwrap_or_default(),
            row.try_get::<String, _>("last_name").unwrap_or_default()
        )
        .trim()
        .to_string();
        let phase = row.try_get::<String, _>("phase").unwrap_or_default();
        let billing_release_status = row
            .try_get::<String, _>("billing_release_status")
            .unwrap_or_else(|_| "pending".to_string());
        let package_coverage_status = row
            .try_get::<String, _>("package_coverage_status")
            .unwrap_or_else(|_| "unknown".to_string());
        let service_gross = row
            .try_get::<Decimal, _>("service_gross")
            .unwrap_or(Decimal::ZERO);
        let invoiced_total = row
            .try_get::<Decimal, _>("invoiced_total")
            .unwrap_or(Decimal::ZERO);
        let outstanding_balance = row
            .try_get::<Decimal, _>("outstanding_balance")
            .unwrap_or(Decimal::ZERO);
        let exposure_gap = if service_gross > invoiced_total {
            service_gross - invoiced_total
        } else {
            Decimal::ZERO
        };
        let overdue_invoices = row.try_get::<i64, _>("overdue_invoice_count").unwrap_or(0);
        let unpaid_advance_invoice_count = row
            .try_get::<i64, _>("unpaid_advance_invoice_count")
            .unwrap_or(0);

        let mut reasons = Vec::new();
        if overdue_invoices > 0 {
            reasons.push(format!(
                "{overdue_invoices} overdue invoice(s) require immediate follow-up"
            ));
        }
        if unpaid_advance_invoice_count > 0 {
            reasons.push(format!(
                "{unpaid_advance_invoice_count} advance invoice(s) remain unpaid"
            ));
        }
        if outstanding_balance > Decimal::ZERO {
            reasons.push(format!(
                "Outstanding balance is {}",
                decimal_to_string(outstanding_balance)
            ));
        }
        if exposure_gap > Decimal::ZERO {
            reasons.push(format!(
                "Delivered scope exceeds invoiced volume by {}",
                decimal_to_string(exposure_gap)
            ));
        }
        let blocked_order =
            billing_release_status != "granted" && package_coverage_status != "covered";
        if blocked_order {
            reasons.push(format!(
                "Billing release is `{}` while package coverage is `{}`",
                billing_release_status, package_coverage_status
            ));
        }

        if reasons.is_empty() {
            continue;
        }

        let severity = if overdue_invoices > 0 || outstanding_balance >= Decimal::from(5000) {
            "urgent"
        } else if unpaid_advance_invoice_count > 0 || exposure_gap > Decimal::ZERO || blocked_order
        {
            "high"
        } else {
            "medium"
        };

        match severity {
            "urgent" => urgent_alerts += 1,
            "high" => high_alerts += 1,
            _ => medium_alerts += 1,
        }
        if blocked_order {
            blocked_orders += 1;
        }
        overdue_invoice_count += overdue_invoices;
        outstanding_balance_total += outstanding_balance;
        exposure_gap_total += exposure_gap;

        alerts.push(BillingRiskAlert {
            order_id: order_id.to_string(),
            order_number: row.try_get::<String, _>("order_number").unwrap_or_default(),
            patient_id: patient_id.to_string(),
            patient_label,
            severity,
            title: "Financial exposure risk".to_string(),
            reasons,
            phase,
            billing_release_status,
            package_coverage_status,
            overdue_invoice_count: overdue_invoices,
            unpaid_advance_invoice_count,
            outstanding_balance: decimal_to_string(outstanding_balance),
            service_gross: decimal_to_string(service_gross),
            invoiced_total: decimal_to_string(invoiced_total),
            exposure_gap: decimal_to_string(exposure_gap),
        });
    }

    alerts.sort_by(|left, right| {
        risk_severity_rank(right.severity)
            .cmp(&risk_severity_rank(left.severity))
            .then(right.overdue_invoice_count.cmp(&left.overdue_invoice_count))
            .then(
                right
                    .unpaid_advance_invoice_count
                    .cmp(&left.unpaid_advance_invoice_count),
            )
            .then(left.order_number.cmp(&right.order_number))
    });

    Ok(BillingRiskPayload {
        summary: BillingRiskSummary {
            total_alerts: alerts.len() as i64,
            urgent_alerts,
            high_alerts,
            medium_alerts,
            overdue_invoice_count,
            blocked_orders,
            outstanding_balance_total: decimal_to_string(outstanding_balance_total),
            exposure_gap_total: decimal_to_string(exposure_gap_total),
        },
        alerts,
    })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
