//! Repeat-patient order preparation. Lead conversion and acquisition data do
//! not participate in this workflow.
use crate::{audit, auth::middleware::AuthUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::NaiveDate;
use gmed_domain::role::Role;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

type ApiResult = Result<Json<Value>, Response>;

#[path = "order_intake_catalog.rs"]
mod catalog;

pub(crate) fn catalog_description(template: &str, data: &Value) -> String {
    catalog::resolve_description(template, data)
}


pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/order-intakes",
            get(initial).post(create),
        )
        .route("/orders/{order_id}/intake", get(load).post(save))
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"message": message}))).into_response()
}
fn invalid(message: &str) -> Response {
    error(StatusCode::UNPROCESSABLE_ENTITY, message)
}
fn conflict(message: &str) -> Response {
    error(StatusCode::CONFLICT, message)
}
fn db_error(e: sqlx::Error) -> Response {
    tracing::error!(error = %e, "order intake database operation");
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to save order preparation",
    )
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
struct Facts {
    insurance_type: String,
    insurance_provider: String,
    insurance_number: String,
    phone_primary: String,
    email: String,
    address_street: String,
    address_city: String,
    address_zip: String,
    address_country: String,
    pep_contract_partner: Option<bool>,
    pep_beneficial_owner: Option<bool>,
    pep_office: String,
    pep_asset_origin: String,
    representative_name: String,
    representative_phone: String,
    representative_authority: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Line {
    id: Uuid,
    description: String,
    quantity: String,
    unit_price: String,
    vat_rate: String,
    agency_service_id: Option<Uuid>,
    agency_service_price_version_id: Option<Uuid>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
struct Draft {
    step: u8,
    facts: Facts,
    needs_description: String,
    date_from: Option<NaiveDate>,
    date_to: Option<NaiveDate>,
    case_id: Option<Uuid>,
    contract_id: Option<Uuid>,
    lines: Vec<Line>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    specialization_ids: Vec<Uuid>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    selected_work_type_ids: Vec<Uuid>,
    #[serde(skip_serializing_if = "String::is_empty")]
    cost_estimate_additional_language: String,
    #[serde(skip_serializing_if = "Value::is_null")]
    catalog_snapshot: Value,
    prepayment_required: bool,
    prepayment_amount: String,
    prepayment_due_at: Option<chrono::DateTime<chrono::Utc>>,
    aml_review: AmlReview,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
struct AmlReview {
    risk_reason: String,
    manager_approval_name: String,
    continuous_monitoring: String,
    reviewer_name: String,
    review_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    request_id: Uuid,
    baseline_facts: Option<Facts>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    revision: i64,
    action: Action,
    data: Draft,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Action {
    Save,
    ReloadFacts,
    ConfirmFacts,
    Prepare,
    ReviewDocuments,
    Confirm,
}

async fn access(state: &AppState, auth: &AuthUser, patient_id: Uuid) -> Result<(), Response> {
    // These roles use the unrestricted patient editor. Other roles must not
    // receive insurance or compliance data through this endpoint.
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    if !super::patients::has_patient_edit_access(state, auth, patient_id).await? {
        return Err(error(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }
    Ok(())
}

async fn order_patient(state: &AppState, auth: &AuthUser, id: Uuid) -> Result<Uuid, Response> {
    let patient = sqlx::query_scalar::<_, Uuid>(
        "SELECT o.patient_id FROM orders o JOIN order_intakes i ON i.order_id=o.id WHERE o.id=$1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "Order preparation not found"))?;
    access(state, auth, patient).await?;
    Ok(patient)
}

async fn facts(conn: &mut PgConnection, patient: Uuid) -> Result<Facts, Response> {
    let row = sqlx::query(
        "SELECT insurance_type, insurance_provider, insurance_number,
        phone_primary,email,address_street,address_city,address_zip,address_country,legal_status
        FROM patients WHERE id=$1 FOR UPDATE",
    )
    .bind(patient)
    .fetch_optional(conn)
    .await
    .map_err(db_error)?
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "Patient not found"))?;
    let text = |key| {
        row.try_get::<Option<String>, _>(key)
            .ok()
            .flatten()
            .unwrap_or_default()
    };
    let legal: Value = row
        .try_get::<Option<Value>, _>("legal_status")
        .map_err(db_error)?
        .unwrap_or_else(|| json!({}));
    let aml = &legal["aml_enhanced_due_diligence"];
    let representative = &legal["order_representative"];
    Ok(Facts {
        insurance_type: text("insurance_type"),
        insurance_provider: text("insurance_provider"),
        insurance_number: text("insurance_number"),
        phone_primary: text("phone_primary"),
        email: text("email"),
        address_street: text("address_street"),
        address_city: text("address_city"),
        address_zip: text("address_zip"),
        address_country: text("address_country"),
        pep_contract_partner: aml["pepContractPartner"].as_bool(),
        pep_beneficial_owner: aml["pepBeneficialOwner"].as_bool(),
        pep_office: aml["pepOfficeFunction"].as_str().unwrap_or_default().into(),
        pep_asset_origin: aml["pepAssetOrigin"].as_str().unwrap_or_default().into(),
        representative_name: representative["name"].as_str().unwrap_or_default().into(),
        representative_phone: representative["phone"].as_str().unwrap_or_default().into(),
        representative_authority: representative["authority"]
            .as_str()
            .unwrap_or_default()
            .into(),
    })
}

async fn create(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient): Path<Uuid>,
    Json(body): Json<Create>,
) -> ApiResult {
    access(&state, &auth, patient).await?;
    let mut tx = state.db.begin().await.map_err(db_error)?;
    // Serializes retries before generating a number or changing a patient.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(body.request_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    if let Some(existing) =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT patient_id FROM orders WHERE id=$1")
            .bind(body.request_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
    {
        if existing != Some(patient) {
            return Err(conflict("Request ID already used"));
        }
        tx.commit().await.map_err(db_error)?;
        return workspace(&state, body.request_id).await;
    }
    let initial = facts(&mut tx, patient).await?;
    if body
        .baseline_facts
        .as_ref()
        .is_some_and(|baseline| baseline != &initial)
    {
        return Err(conflict(
            "Patient details changed. Reload current details before confirming.",
        ));
    }
    let seq: i64 = sqlx::query_scalar("SELECT nextval('order_number_seq')")
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
    let number = super::orders::gen_order_number(seq);
    sqlx::query(
        "INSERT INTO orders(id,order_number,patient_id,created_by,intake_state)
        VALUES($1,$2,$3,$4,'draft')",
    )
    .bind(body.request_id)
    .bind(number)
    .bind(patient)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query("INSERT INTO order_intakes(order_id,data,baseline_facts) VALUES($1,$2,$3)")
        .bind(body.request_id)
        .bind(json!(Draft {
            facts: initial.clone(),
            ..Default::default()
        }))
        .bind(json!(initial))
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    state.audit_sender.try_send(audit::domain_event(
        "order_intake_created",
        Some(auth.user_id),
        "order",
        Some(body.request_id),
        json!({"patient_id":patient}),
    ));
    workspace(&state, body.request_id).await
}

async fn load(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> ApiResult {
    order_patient(&state, &auth, id).await?;
    workspace(&state, id).await
}

async fn initial(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient): Path<Uuid>,
) -> ApiResult {
    access(&state, &auth, patient).await?;
    let mut conn = state.db.acquire().await.map_err(db_error)?;
    Ok(Json(json!({"facts":facts(&mut conn,patient).await?})))
}

fn money(value: &str) -> Result<Decimal, Response> {
    value
        .trim()
        .parse::<Decimal>()
        .ok()
        .filter(|v| *v >= Decimal::ZERO && *v <= Decimal::from(100_000_000))
        .ok_or_else(|| invalid("Invalid amount"))
}

fn validate(d: &Draft, complete: bool) -> Result<(), Response> {
    if d.step > 5
        || d.lines.len() > 100
        || d.specialization_ids.len() > 100
        || d.selected_work_type_ids.len() > 100
        || serde_json::to_vec(d).unwrap_or_default().len() > 100_000
    {
        return Err(invalid("Order preparation is too large"));
    }
    if !matches!(d.cost_estimate_additional_language.as_str(), "" | "ru" | "en" | "es") {
        return Err(invalid("Invalid cost estimate language"));
    }
    if d.date_from.zip(d.date_to).is_some_and(|(a, b)| b < a) {
        return Err(invalid("Invalid order period"));
    }
    let f = &d.facts;
    if !matches!(
        f.insurance_type.as_str(),
        "" | "private" | "public" | "foreign" | "self_pay"
    ) {
        return Err(invalid("Invalid insurance type"));
    }
    if complete {
        if d.date_from.is_none() || d.date_to.is_none() || d.needs_description.trim().is_empty() {
            return Err(invalid("Order purpose and complete period are required"));
        }
        if d.lines.is_empty() {
            return Err(invalid("Add at least one service"));
        }
    }
    let mut ids = std::collections::HashSet::new();
    for line in &d.lines {
        if !ids.insert(line.id) {
            return Err(invalid("Duplicate service"));
        }
        if complete
            && (line.description.trim().is_empty()
                || line.quantity.is_empty()
                || line.unit_price.is_empty()
                || line.vat_rate.is_empty())
        {
            return Err(invalid("Complete the service details"));
        }
        if !line.quantity.is_empty() && money(&line.quantity)? <= Decimal::ZERO {
            return Err(invalid("Invalid quantity"));
        }
        if !line.vat_rate.is_empty() && money(&line.vat_rate)? > Decimal::from(100) {
            return Err(invalid("Invalid VAT"));
        }
        if !line.unit_price.is_empty() {
            money(&line.unit_price)?;
        }
    }
    if !d.prepayment_amount.is_empty() {
        money(&d.prepayment_amount)?;
    }
    if complete
        && d.prepayment_required
        && (d.prepayment_amount.is_empty() || money(&d.prepayment_amount)? <= Decimal::ZERO)
    {
        return Err(invalid("Enter the prepayment amount"));
    }
    Ok(())
}

fn validate_facts(f: &Facts) -> Result<(), Response> {
    if f.pep_contract_partner.is_none() || f.pep_beneficial_owner.is_none() {
        return Err(invalid("Confirm PEP status; unknown is not No"));
    }
    if f.insurance_type.is_empty()
        || (f.insurance_type != "self_pay"
            && (f.insurance_provider.trim().is_empty() || f.insurance_number.trim().is_empty()))
    {
        return Err(invalid("Confirm insurance details or self-payment"));
    }
    if (f.pep_contract_partner == Some(true) || f.pep_beneficial_owner == Some(true))
        && (f.pep_office.trim().is_empty() || f.pep_asset_origin.trim().is_empty())
    {
        return Err(invalid("PEP office and asset origin are required"));
    }
    if f.phone_primary.trim().is_empty() && f.email.trim().is_empty() {
        return Err(invalid("A contact is required"));
    }
    if !f.email.is_empty() && (!f.email.contains('@') || f.email.contains(char::is_whitespace)) {
        return Err(invalid("Invalid email"));
    }
    if !f.representative_name.is_empty() && f.representative_authority.trim().is_empty() {
        return Err(invalid("Specify representative authority"));
    }
    Ok(())
}

pub(crate) fn covers_period(
    status: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
) -> bool {
    status == "signed"
        && start.zip(end).is_some_and(|(a, b)| {
            a <= b && from.is_none_or(|v| v <= a) && to.is_none_or(|v| v >= b)
        })
}

async fn save(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(mut body): Json<Save>,
) -> ApiResult {
    let patient = order_patient(&state, &auth, id).await?;
    validate(
        &body.data,
        matches!(body.action, Action::Prepare | Action::Confirm),
    )?;
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let row = sqlx::query(
        "SELECT i.*,o.intake_state FROM order_intakes i JOIN orders o ON o.id=i.order_id
        WHERE i.order_id=$1 FOR UPDATE OF i,o",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    if row.try_get::<String, _>("intake_state").map_err(db_error)? != "draft" {
        if body.action == Action::Confirm {
            tx.commit().await.map_err(db_error)?;
            super::orders::ensure_created_order_state(&state, id, auth.user_id).await?;
            return workspace(&state, id).await;
        }
        return Err(conflict("Order preparation is already completed"));
    }
    if row.try_get::<i64, _>("revision").map_err(db_error)? != body.revision {
        return Err(conflict(
            "Order preparation changed. Reload and review your changes.",
        ));
    }
    let current = facts(&mut tx, patient).await?;
    if body.action == Action::ReloadFacts {
        body.data.facts = current.clone();
        sqlx::query("UPDATE order_intakes SET baseline_facts=$2 WHERE order_id=$1")
            .bind(id)
            .bind(json!(current))
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    let before: Value = row.try_get("baseline_facts").map_err(db_error)?;
    let confirmed: Option<Value> = row.try_get("confirmed_facts").map_err(db_error)?;
    let mut facts_confirmed =
        confirmed.as_ref() == Some(&json!(current)) && current == body.data.facts;
    if let Some(contract) = body.data.contract_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM framework_contracts WHERE id=$1 AND patient_id=$2)",
        )
        .bind(contract)
        .bind(patient)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        if !belongs {
            return Err(invalid("Framework contract does not belong to patient"));
        }
    }
    if let Some(case_id) = body.data.case_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM cases WHERE id=$1 AND patient_id=$2)",
        )
        .bind(case_id)
        .bind(patient)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        if !belongs {
            return Err(invalid("Case does not belong to patient"));
        }
    }
    if body.action == Action::ConfirmFacts {
        validate_facts(&body.data.facts)?;
        if before != json!(current) {
            return Err(conflict(
                "Patient details changed. Reload current details before confirming.",
            ));
        }
        let f = &body.data.facts;
        let aml = json!({"pepContractPartner":f.pep_contract_partner,"pepBeneficialOwner":f.pep_beneficial_owner,
            "pepOfficeFunction":f.pep_office,"pepAssetOrigin":f.pep_asset_origin});
        let representative = json!({"name":f.representative_name,"phone":f.representative_phone,"authority":f.representative_authority});
        sqlx::query("UPDATE patients SET insurance_type=NULLIF($2,''),insurance_provider=NULLIF($3,''),insurance_number=NULLIF($4,''),
            phone_primary=NULLIF($5,''),email=NULLIF($6,''),address_street=NULLIF($7,''),address_city=NULLIF($8,''),
            address_zip=NULLIF($9,''),address_country=NULLIF($10,''),
            legal_status=COALESCE(legal_status,'{}'::jsonb) || jsonb_build_object(
                'aml_enhanced_due_diligence',COALESCE(legal_status->'aml_enhanced_due_diligence','{}'::jsonb) || $11::jsonb,
                'order_representative',$12::jsonb)
            WHERE id=$1")
            .bind(patient).bind(&f.insurance_type).bind(&f.insurance_provider).bind(&f.insurance_number)
            .bind(&f.phone_primary).bind(&f.email).bind(&f.address_street).bind(&f.address_city)
            .bind(&f.address_zip).bind(&f.address_country).bind(aml).bind(representative)
            .execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query("INSERT INTO order_intake_fact_reviews(order_id,before_facts,after_facts,confirmed_by) VALUES($1,$2,$3,$4)")
            .bind(id).bind(json!(current)).bind(json!(f)).bind(auth.user_id).execute(&mut *tx).await.map_err(db_error)?;
        for (kind, value) in [("phone", &f.phone_primary), ("email", &f.email)] {
            if value.trim().is_empty() {
                sqlx::query("DELETE FROM patient_contacts WHERE patient_id=$1 AND contact_kind=$2 AND is_primary")
                    .bind(patient).bind(kind).execute(&mut *tx).await.map_err(db_error)?;
            } else {
                sqlx::query("INSERT INTO patient_contacts(patient_id,contact_kind,value,is_primary) VALUES($1,$2,$3,true)
                    ON CONFLICT(patient_id,contact_kind) WHERE is_primary DO UPDATE SET value=EXCLUDED.value")
                    .bind(patient).bind(kind).bind(value.trim()).execute(&mut *tx).await.map_err(db_error)?;
            }
        }
        sqlx::query("UPDATE order_intakes SET confirmed_facts=$2,baseline_facts=$2,facts_confirmed_by=$3,facts_confirmed_at=now() WHERE order_id=$1")
            .bind(id).bind(json!(f)).bind(auth.user_id).execute(&mut *tx).await.map_err(db_error)?;
        facts_confirmed = true;
    }
    if matches!(body.action, Action::Prepare | Action::Confirm) && !facts_confirmed {
        return Err(conflict(
            "Confirm current patient details before preparing documents",
        ));
    }
    body.data.catalog_snapshot = catalog::snapshot(
        &mut tx, &body.data, matches!(body.action, Action::Prepare | Action::Confirm),
    ).await?;
    sqlx::query(
        "UPDATE order_intakes SET data=$2,revision=revision+1,updated_at=now() WHERE order_id=$1",
    )
    .bind(id)
    .bind(json!(body.data))
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    sqlx::query("UPDATE orders SET needs_description=NULLIF($2,''),date_from=$3,date_to=$4,contract_id=$5,case_id=$6 WHERE id=$1")
        .bind(id).bind(&body.data.needs_description).bind(body.data.date_from).bind(body.data.date_to)
        .bind(body.data.contract_id).bind(body.data.case_id).execute(&mut *tx).await.map_err(db_error)?;
    if body.action == Action::Prepare {
        sync_services(&mut tx, id, &body.data).await?;
        sqlx::query("UPDATE order_intakes SET prepared_data=data-'step' WHERE order_id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
    }
    if body.action == Action::ReviewDocuments {
        if !facts_confirmed {
            return Err(conflict(
                "Confirm current patient details before reviewing documents",
            ));
        }
        let context = context_tx(&mut tx, id).await?;
        let signed_framework:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM documents d
            WHERE order_id=$1 AND generated_template_id='framework_contract' AND order_intake_context=$2
            AND signed_at IS NOT NULL AND status<>'archived' AND file_deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM documents n WHERE n.replaces_document_id=d.id))")
            .bind(id).bind(&context).fetch_one(&mut *tx).await.map_err(db_error)?;
        if signed_framework {
            sqlx::query(
                "UPDATE framework_contracts SET status='signed',signed_at=COALESCE(signed_at,now())
                WHERE id=$1 AND patient_id=$2 AND status IN ('draft','sent')",
            )
            .bind(body.data.contract_id)
            .bind(patient)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
    }
    if body.action == Action::Confirm {
        // Readiness uses the same transaction and locks as the confirmation.
        let context = context_tx(&mut tx, id).await?;
        let checks = checks_tx(&state, &mut tx, id, patient, &body.data, &context).await?;
        if checks.iter().any(|v| v["status"] == "blocked") {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"message":"Order is not ready","checks":checks})),
            )
                .into_response());
        }
        if body.data.case_id.is_none() {
            let seq: i64 = sqlx::query_scalar("SELECT nextval('case_id_seq')")
                .fetch_one(&mut *tx)
                .await
                .map_err(db_error)?;
            let retention = super::cases::load_case_retention_years(&state, 30).await;
            let case:Uuid=sqlx::query_scalar("INSERT INTO cases(case_id,patient_id,manager_id,hauptanfragegrund,retention_until,last_clinical_update_at)
                VALUES($1,$2,$3,$4,now()+($5*interval '1 year'),now()) RETURNING id")
                .bind(super::cases::gen_case_id(seq)).bind(patient).bind(auth.user_id).bind(&body.data.needs_description)
                .bind(retention).fetch_one(&mut *tx).await.map_err(db_error)?;
            sqlx::query("UPDATE orders SET case_id=$2 WHERE id=$1")
                .bind(id)
                .bind(case)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
        sqlx::query("UPDATE order_intakes SET confirmed_at=now(),confirmed_by=$2,confirmation_snapshot=$3 WHERE order_id=$1")
            .bind(id).bind(auth.user_id).bind(json!({"context":context,"checks":checks}))
            .execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query("UPDATE orders SET intake_state='confirmed',prepayment_required=$2,prepayment_amount=$3,prepayment_due_at=$4,
            signed_patient=true,signed_agency=true,signed_at=now() WHERE id=$1")
            .bind(id).bind(body.data.prepayment_required)
            .bind(if body.data.prepayment_required {Some(money(&body.data.prepayment_amount)?)} else {None})
            .bind(body.data.prepayment_due_at).execute(&mut *tx).await.map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    if body.action != Action::Save {
        state.audit_sender.try_send(audit::domain_event(
            if body.action == Action::Confirm {
                "order_intake_confirmed"
            } else {
                "order_intake_reviewed"
            },
            Some(auth.user_id),
            "order",
            Some(id),
            json!({"revision":body.revision+1}),
        ));
    }
    if body.action == Action::Confirm {
        super::orders::ensure_created_order_state(&state, id, auth.user_id).await?;
        crate::realtime::publish_order_event(
            &state,
            Some(auth.user_id),
            "order.created",
            id,
            json!({"patient_id":patient}),
        )
        .await;
    }
    workspace(&state, id).await
}

async fn sync_services(conn: &mut PgConnection, id: Uuid, d: &Draft) -> Result<(), Response> {
    // This order has never entered execution or invoicing. The database guards
    // prevent financial records from attaching until confirmation.
    let mut total = Decimal::ZERO;
    let mut ids = Vec::new();
    for l in &d.lines {
        let qty = money(&l.quantity)?;
        let price = money(&l.unit_price)?;
        let vat = money(&l.vat_rate)?;
        if let Some(service) = l.agency_service_id {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM agency_service_catalog WHERE id=$1)",
            )
            .bind(service)
            .fetch_one(&mut *conn)
            .await
            .map_err(db_error)?;
            if !valid {
                return Err(invalid("Service no longer exists"));
            }
        }
        if let Some(version) = l.agency_service_price_version_id {
            let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agency_service_price_versions WHERE id=$1 AND agency_service_id=$2
                AND unit_price=$3 AND vat_rate=$4 AND upper(currency)='EUR')")
                .bind(version).bind(l.agency_service_id).bind(price).bind(vat)
                .fetch_one(&mut *conn).await.map_err(db_error)?;
            if !valid {
                return Err(invalid(
                    "Price version does not match the service or amount",
                ));
            }
        }
        let line_net = (qty * price).round_dp(2);
        total += line_net + (line_net * vat / Decimal::from(100)).round_dp(2);
        let key = format!("order-intake:{id}:{}", l.id);
        let note = d.catalog_snapshot["services"].as_array().into_iter().flatten()
            .find(|service| l.agency_service_id.is_some_and(|id| service["id"] == id.to_string()))
            .and_then(|service| {
                let items = service["description_items"].as_array().into_iter().flatten()
                    .filter_map(|item| item["text"].as_str()).collect::<Vec<_>>().join("\n\n");
                let template = if items.is_empty() { service["description"].as_str().unwrap_or_default() } else { &items };
                (!template.is_empty()).then(|| catalog_description(template, &json!(d)))
            });
        let service_id = sqlx::query_scalar::<_,Uuid>("INSERT INTO order_leistungen(order_id,description,quantity,unit_price,vat_rate,client_reference,agency_service_id,agency_service_price_version_id,patient_id,notes)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT patient_id FROM orders WHERE id=$1),$9) ON CONFLICT(order_id,client_reference)
            DO UPDATE SET description=EXCLUDED.description,quantity=EXCLUDED.quantity,unit_price=EXCLUDED.unit_price,vat_rate=EXCLUDED.vat_rate,
                agency_service_id=EXCLUDED.agency_service_id,agency_service_price_version_id=EXCLUDED.agency_service_price_version_id,notes=EXCLUDED.notes
            RETURNING id")
            .bind(id).bind(l.description.trim()).bind(qty).bind(price).bind(vat).bind(key)
            .bind(l.agency_service_id).bind(l.agency_service_price_version_id).bind(note)
            .fetch_one(&mut *conn).await.map_err(db_error)?;
        ids.push(service_id);
    }
    sqlx::query(
        "DELETE FROM order_leistungen WHERE order_id=$1 AND NOT(id=ANY($2)) AND status='planned'",
    )
    .bind(id)
    .bind(ids)
    .execute(&mut *conn)
    .await
    .map_err(db_error)?;
    if d.prepayment_required && money(&d.prepayment_amount)? > total {
        return Err(invalid("Prepayment cannot exceed the order total"));
    }
    sqlx::query("UPDATE orders SET total_estimated=$2 WHERE id=$1")
        .bind(id)
        .bind(total)
        .execute(conn)
        .await
        .map_err(db_error)?;
    Ok(())
}

// A stable document context excludes UI step, revision counters, and signature
// timestamps. It changes when the actual content or selected contract changes.
async fn context_tx(conn: &mut PgConnection, id: Uuid) -> Result<Value, Response> {
    let row = sqlx::query("SELECT i.data,i.prepared_data,i.confirmed_facts,o.patient_id,
        p.legal_status->'aml_enhanced_due_diligence' AS aml,
        jsonb_build_object('first_name',p.first_name,'last_name',p.last_name,'title',p.title,'birth_date',p.birth_date,
            'gender',p.gender,'nationality',p.nationality,'residence_country',p.residence_country,'languages',p.languages) AS identity,
        CASE WHEN fc.id IS NOT NULL THEN jsonb_build_object('id',fc.id,'number',fc.contract_number,
            'valid_from',fc.valid_from,'valid_to',fc.valid_to,'conditions',fc.conditions) END AS contract,
        (SELECT jsonb_build_object('id',q.id,'lines',q.line_items,'net',q.total_net,'vat',q.total_vat,'gross',q.total_gross,'valid_until',q.valid_until,'notes',q.notes)
         FROM quotes q WHERE q.order_id=o.id ORDER BY q.created_at DESC,q.id DESC LIMIT 1) AS quote
        FROM order_intakes i JOIN orders o ON o.id=i.order_id JOIN patients p ON p.id=o.patient_id LEFT JOIN framework_contracts fc ON fc.id=o.contract_id
        WHERE i.order_id=$1")
        .bind(id).fetch_one(&mut *conn).await.map_err(db_error)?;
    let mut data: Value = row.try_get("data").map_err(db_error)?;
    data.as_object_mut()
        .ok_or_else(|| invalid("Invalid preparation data"))?
        .remove("step");
    Ok(
        json!({"order_id":id,"prepared":row.try_get::<Option<Value>,_>("prepared_data").map_err(db_error)?.as_ref()==Some(&data),"data":data,"facts":row.try_get::<Option<Value>,_>("confirmed_facts").map_err(db_error)?,
        "identity":row.try_get::<Value,_>("identity").map_err(db_error)?,
        "aml":row.try_get::<Option<Value>,_>("aml").map_err(db_error)?,
        "contract":row.try_get::<Option<Value>,_>("contract").map_err(db_error)?,
        "quote":row.try_get::<Option<Value>,_>("quote").map_err(db_error)?}),
    )
}

async fn checks_tx(
    state: &AppState,
    conn: &mut PgConnection,
    id: Uuid,
    patient: Uuid,
    d: &Draft,
    context: &Value,
) -> Result<Vec<Value>, Response> {
    let mut checks = Vec::new();
    let mut add = |key: &str, passed: bool, step: u8| {
        checks.push(json!({"key":key,"status":if passed {"passed"} else {"blocked"},"step":step}))
    };
    let current = facts(conn, patient).await?;
    add(
        "facts",
        context["facts"] == json!(current)
            && current == d.facts
            && validate_facts(&current).is_ok(),
        0,
    );
    add(
        "period",
        d.date_from.zip(d.date_to).is_some_and(|(a, b)| a <= b)
            && !d.needs_description.trim().is_empty(),
        1,
    );
    add(
        "services",
        validate(d, true).is_ok() && context["prepared"] == true,
        2,
    );
    let contract = sqlx::query(
        "SELECT status,valid_from,valid_to FROM framework_contracts WHERE id=$1 AND patient_id=$2",
    )
    .bind(d.contract_id)
    .bind(patient)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_error)?;
    let contract_ok = contract.as_ref().is_some_and(|r| {
        covers_period(
            &r.try_get::<String, _>("status").unwrap_or_default(),
            r.try_get("valid_from").ok().flatten(),
            r.try_get("valid_to").ok().flatten(),
            d.date_from,
            d.date_to,
        )
    });
    add("contract", contract_ok, 3);
    let recheck = super::patients::load_patient_recheck_readiness(state, patient)
        .await?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Patient not found"))?;
    for key in [
        "base_data_ready",
        "compliance_ready",
        "identity_ready",
        "document_pack_ready",
        "confidentiality_release_ready",
    ] {
        add(key, recheck.payload[key].as_bool() == Some(true), 4);
    }
    add(
        "debt_clear",
        recheck.payload["debt_hold"].as_bool() != Some(true),
        5,
    );
    let docs = sqlx::query("SELECT generated_template_id,compliance_kind,signed_at,order_intake_context FROM documents
        WHERE order_id=$1 AND status<>'archived' AND file_deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM documents newer WHERE newer.replaces_document_id=documents.id)")
        .bind(id).fetch_all(&mut *conn).await.map_err(db_error)?;
    let signed = |kind: &str| {
        docs.iter().any(|r| {
            let template = r
                .try_get::<Option<String>, _>("generated_template_id")
                .ok()
                .flatten()
                .unwrap_or_default();
            let compliance = r
                .try_get::<Option<String>, _>("compliance_kind")
                .ok()
                .flatten()
                .unwrap_or_default();
            (template == kind || compliance == kind)
                && r.try_get::<Option<Value>, _>("order_intake_context")
                    .ok()
                    .flatten()
                    .as_ref()
                    == Some(context)
                && r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at")
                    .ok()
                    .flatten()
                    .is_some()
        })
    };
    add("single_order", signed("single_order"), 4);
    add("quote", quote_matches(d, &context["quote"]["lines"]), 2);
    if d.facts.pep_contract_partner == Some(true) || d.facts.pep_beneficial_owner == Some(true) {
        add(
            "pep_review",
            !d.aml_review.risk_reason.trim().is_empty()
                && !d.aml_review.manager_approval_name.trim().is_empty()
                && !d.aml_review.continuous_monitoring.trim().is_empty()
                && !d.aml_review.reviewer_name.trim().is_empty()
                && d.aml_review.review_date.is_some(),
            4,
        );
        add("pep_evidence", signed("enhanced_due_diligence"), 4);
    }
    if recheck.payload["passport_expired"] == true || recheck.payload["passport_expiring"] == true {
        checks.push(json!({"key":"passport","status":"warning","step":0}));
    }
    Ok(checks)
}

async fn workspace(state: &AppState, id: Uuid) -> ApiResult {
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let row = sqlx::query("SELECT i.*,o.patient_id,o.order_number,o.intake_state FROM order_intakes i JOIN orders o ON o.id=i.order_id WHERE i.order_id=$1")
        .bind(id).fetch_one(&mut *tx).await.map_err(db_error)?;
    let patient: Uuid = row.try_get("patient_id").map_err(db_error)?;
    let data: Value = row.try_get("data").map_err(db_error)?;
    let draft: Draft =
        serde_json::from_value(data.clone()).map_err(|_| invalid("Invalid preparation data"))?;
    let current = facts(&mut tx, patient).await?;
    let context = context_tx(&mut tx, id).await?;
    let checks = checks_tx(state, &mut tx, id, patient, &draft, &context).await?;
    let documents = sqlx::query("SELECT id,order_intake_context FROM documents WHERE order_id=$1")
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
    let current_documents: Vec<Uuid> = documents
        .into_iter()
        .filter(|r| {
            r.try_get::<Option<Value>, _>("order_intake_context")
                .ok()
                .flatten()
                .as_ref()
                == Some(&context)
        })
        .filter_map(|r| r.try_get("id").ok())
        .collect();
    let result = json!({"order_id":id,"patient_id":patient,"order_number":row.try_get::<String,_>("order_number").map_err(db_error)?,
        "intake_state":row.try_get::<String,_>("intake_state").map_err(db_error)?,
        "revision":row.try_get::<i64,_>("revision").map_err(db_error)?,"data":data,"current_facts":current,
        "confirmed_facts":row.try_get::<Option<Value>,_>("confirmed_facts").map_err(db_error)?,
        "baseline_facts":row.try_get::<Value,_>("baseline_facts").map_err(db_error)?,
        "facts_confirmed_at":row.try_get::<Option<chrono::DateTime<chrono::Utc>>,_>("facts_confirmed_at").map_err(db_error)?,
        "checks":checks,"current_document_ids":current_documents});
    tx.commit().await.map_err(db_error)?;
    Ok(Json(result))
}

/// Called by PDF generation. None preserves the legacy document workflow.
pub(crate) async fn document_context(
    state: &AppState,
    id: Option<Uuid>,
) -> Result<Option<Value>, Response> {
    let Some(id) = id else { return Ok(None) };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_intakes WHERE order_id=$1)")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .map_err(db_error)?;
    if !exists {
        return Ok(None);
    };
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let ctx = context_tx(&mut tx, id).await?;
    let draft: Draft = serde_json::from_value(ctx["data"].clone())
        .map_err(|_| invalid("Invalid preparation data"))?;
    validate(&draft, true)?;
    if ctx["prepared"] != true || !quote_matches(&draft, &ctx["quote"]["lines"]) {
        return Err(conflict(
            "Update services and quote before generating documents",
        ));
    }
    let patient: Uuid = sqlx::query_scalar("SELECT patient_id FROM orders WHERE id=$1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
    let current = facts(&mut tx, patient).await?;
    if ctx["facts"] != json!(current) || current != draft.facts {
        return Err(conflict(
            "Confirm current patient details before generating documents",
        ));
    }
    if draft.contract_id.is_none() {
        return Err(invalid("Select a contract before generating documents"));
    }
    tx.commit().await.map_err(db_error)?;
    Ok(Some(ctx))
}

fn quote_matches(d: &Draft, value: &Value) -> bool {
    let Some(lines) = value.as_array() else {
        return false;
    };
    let mut expected: Vec<_> = d
        .lines
        .iter()
        .map(|l| {
            (
                l.description.trim().to_string(),
                money(&l.quantity).ok(),
                money(&l.unit_price).ok(),
                money(&l.vat_rate).ok(),
            )
        })
        .collect();
    let mut actual: Vec<_> = lines
        .iter()
        .map(|l| {
            let decimal = |key| {
                l[key]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| l[key].to_string())
                    .parse::<Decimal>()
                    .ok()
            };
            (
                l["description"]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                decimal("quantity"),
                decimal("unit_price"),
                decimal("vat_rate"),
            )
        })
        .collect();
    expected.sort();
    actual.sort();
    !expected.is_empty() && actual == expected
}
