use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cases", get(list_cases).post(create_case))
        .route("/cases/meta/doctors", get(list_case_doctors))
        .route("/cases/{case_id}", get(get_case_full))
        .route("/cases/{case_id}/history", get(get_case_history))
        .route("/cases/{case_id}/anamnesis", post(update_anamnesis))
        .route(
            "/cases/{case_id}/vorerkrankungen",
            post(save_vorerkrankungen),
        )
        .route("/cases/{case_id}/allergien", post(save_allergien))
        .route("/cases/{case_id}/operationen", post(save_operationen))
        .route("/cases/{case_id}/medikamente", post(save_medikamente))
        .route("/cases/{case_id}/pain", post(save_pain_records))
        .route("/cases/{case_id}/symptome", post(save_symptome))
        .route("/cases/{case_id}/cardiology", post(save_cardiology))
        .route(
            "/cases/{case_id}/gastroenterology",
            post(save_gastroenterology),
        )
        .route("/cases/{case_id}/orthopedics", post(save_orthopedics))
        .route("/cases/{case_id}/neurology", post(save_neurology))
        .route("/cases/{case_id}/vegetative", post(save_vegetative))
        .route("/cases/{case_id}/impfstatus", post(save_impfstatus))
}

#[derive(Deserialize)]
struct CreateCaseRequest {
    patient_id: Uuid,
    hauptanfragegrund: Option<String>,
    aktuelle_anamnese: Option<String>,
    zuweiser_doctor_id: Option<Uuid>,
    zuweiser: Option<String>,
}

#[derive(Deserialize)]
struct UpdateAnamnesisRequest {
    hauptanfragegrund: Option<String>,
    aktuelle_anamnese: Option<String>,
    zuweiser_doctor_id: Option<Uuid>,
    zuweiser: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct VorerkrankungItem {
    erkrankung: String,
    erstdiagnose: Option<String>,
    notiz: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct AllergieItem {
    allergie: String,
    reaktion: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct OperationItem {
    datum: Option<String>,
    grund: String,
    arzt_id: Option<Uuid>,
    arzt: Option<String>,
    notiz: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct MedikamentItem {
    handelsname: String,
    wirkstoff: Option<String>,
    dosis: Option<String>,
    dosis_einheit: Option<String>,
    einnahmeschema: Option<String>,
    darreichungsform: Option<String>,
    einheit: Option<String>,
    anmerkung: Option<String>,
    grund: Option<String>,
    seit: Option<String>,
    verordnender_arzt_id: Option<Uuid>,
    verordnender_arzt: Option<String>,
    med_typ: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct PainItem {
    lokalisierung: String,
    seit_wann: Option<String>,
    ursache: Option<String>,
    qualitaet: Option<String>,
    kontinuitaet: Option<String>,
    entwicklung: Option<String>,
    nrs_aktuell: Option<i32>,
    nrs_anfang: Option<i32>,
    dauer_anfang: Option<String>,
    dauer_aktuell: Option<String>,
    ausstrahlung: Option<String>,
    auftreten: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct SymptomItem {
    beschreibung: String,
    fachrichtung: Option<String>,
}

#[derive(Deserialize)]
struct VegetativeRequest {
    appetit_durst: Option<String>,
    koerpergroesse: Option<f64>,
    gewicht: Option<f64>,
    gewichtsveraenderung: Option<String>,
    grund: Option<String>,
}

#[derive(Deserialize)]
struct ImpfstatusRequest {
    status_text: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct CardiologyAssessmentRequest {
    is_relevant: Option<bool>,
    chest_pain: Option<bool>,
    dyspnea: Option<bool>,
    palpitations: Option<bool>,
    syncope: Option<bool>,
    edema: Option<bool>,
    known_diagnosis: Option<String>,
    prior_cardiac_workup: Option<String>,
    cardiovascular_risk_factors: Option<String>,
    anticoagulation: Option<String>,
    family_history: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct GastroenterologyAssessmentRequest {
    is_relevant: Option<bool>,
    abdominal_pain: Option<bool>,
    reflux: Option<bool>,
    nausea: Option<bool>,
    diarrhea: Option<bool>,
    constipation: Option<bool>,
    gi_bleeding: Option<bool>,
    prior_endoscopy: Option<String>,
    bowel_habits: Option<String>,
    liver_history: Option<String>,
    food_intolerance: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct OrthopedicsAssessmentRequest {
    is_relevant: Option<bool>,
    joint_pain: Option<bool>,
    back_pain: Option<bool>,
    mobility_limitation: Option<bool>,
    trauma_history: Option<bool>,
    prior_imaging: Option<String>,
    assistive_devices: Option<String>,
    physiotherapy_history: Option<String>,
    pain_triggers: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct NeurologyAssessmentRequest {
    is_relevant: Option<bool>,
    headache: Option<bool>,
    dizziness: Option<bool>,
    sensory_changes: Option<bool>,
    weakness: Option<bool>,
    seizure_history: Option<bool>,
    gait_balance_issues: Option<bool>,
    prior_neuro_imaging: Option<String>,
    prior_neurology_workup: Option<String>,
    cognitive_changes: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ItemsWrapper<T> {
    items: Vec<T>,
}

#[derive(Deserialize)]
struct ListCasesQuery {
    search: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CaseHistoryQuery {
    limit: Option<i64>,
}

fn gen_case_id(seq: i64) -> String {
    let now = chrono::Utc::now();
    format!("C-{}-{:04}", now.format("%Y%m%d"), seq)
}

fn symptom_matches_specialty(item: &serde_json::Value, aliases: &[&str]) -> bool {
    item["fachrichtung"]
        .as_str()
        .map(|value| {
            let normalized = value.trim().to_lowercase();
            aliases
                .iter()
                .any(|alias| normalized.contains(&alias.to_lowercase()))
        })
        .unwrap_or(false)
}

async fn list_cases(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListCasesQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }

    if let Some(ref status) = query.status
        && !is_valid_case_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());

    match sqlx::query(
        r#"SELECT c.id, c.case_id, c.patient_id, c.status, c.hauptanfragegrund,
                  c.created_at, p.first_name, p.last_name, p.patient_id AS p_pid
           FROM cases c
           JOIN patients p ON p.id = c.patient_id
           WHERE ($1::text = '%%'
                  OR c.case_id ILIKE $1
                  OR COALESCE(c.hauptanfragegrund, '') ILIKE $1
                  OR p.first_name ILIKE $1
                  OR p.last_name ILIKE $1
                  OR p.patient_id ILIKE $1
           )
             AND ($2::text IS NULL OR c.status = $2)
             AND ($3::uuid IS NULL OR c.patient_id = $3)
           ORDER BY c.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.status)
    .bind(query.patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut cases = Vec::with_capacity(rows.len());
            for r in rows {
                let case_id = r.try_get::<Uuid, _>("id").unwrap_or_default();
                let patient_id = r.try_get::<Uuid, _>("patient_id").unwrap_or_default();

                match can_access_case(&state, &auth, case_id, Some(patient_id)).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                cases.push(serde_json::json!({
                    "id": case_id,
                    "case_uuid": case_id,
                    "case_id": r.try_get::<String, _>("case_id").unwrap_or_default(),
                    "patient_id": patient_id,
                    "patient_name": format!(
                        "{} {}",
                        r.try_get::<String, _>("first_name").unwrap_or_default(),
                        r.try_get::<String, _>("last_name").unwrap_or_default()
                    ),
                    "patient_pid": r.try_get::<String, _>("p_pid").unwrap_or_default(),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "hauptanfragegrund": r.try_get::<Option<String>, _>("hauptanfragegrund").unwrap_or_default(),
                    "created_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(cases).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list cases");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list cases")
        }
    }
}

fn is_valid_case_status(value: &str) -> bool {
    matches!(value, "open" | "in_progress" | "closed")
}

async fn create_case(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateCaseRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match ensure_patient_access(&state, &auth, body.patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    let seq: i64 = match sqlx::query_scalar!("SELECT nextval('case_id_seq') AS \"v!\"")
        .fetch_one(&state.db)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "seq error");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let cid = gen_case_id(seq);

    let zuweiser_label =
        match resolve_case_doctor_label(&state, body.zuweiser_doctor_id, body.zuweiser.as_deref())
            .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let retention_years = load_case_retention_years(&state, 30).await;

    let row = match sqlx::query(
        "INSERT INTO cases (
            case_id, patient_id, manager_id, hauptanfragegrund, aktuelle_anamnese,
            zuweiser_doctor_id, zuweiser, retention_until, last_clinical_update_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 * interval '1 year'), now())
         RETURNING id, case_id, created_at, retention_until",
    )
    .bind(&cid)
    .bind(body.patient_id)
    .bind(auth.user_id)
    .bind(body.hauptanfragegrund.clone())
    .bind(body.aktuelle_anamnese.clone())
    .bind(body.zuweiser_doctor_id)
    .bind(zuweiser_label.clone())
    .bind(retention_years)
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "create case");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let created_case_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
    let created_case_code = row.try_get::<String, _>("case_id").unwrap_or(cid.clone());
    let created_at = row
        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
        .unwrap_or_else(|_| chrono::Utc::now());
    let retention_until = row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until")
        .unwrap_or_default();

    let overview_snapshot = serde_json::json!({
        "hauptanfragegrund": body.hauptanfragegrund,
        "aktuelle_anamnese": body.aktuelle_anamnese,
        "zuweiser_doctor_id": body.zuweiser_doctor_id,
        "zuweiser": zuweiser_label,
    });

    version_log(
        &state,
        created_case_id,
        auth.user_id,
        "overview",
        serde_json::Value::Null,
        overview_snapshot,
    )
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "create_case",
        Some(auth.user_id),
        "case",
        Some(created_case_id),
        serde_json::json!({
            "case_id": created_case_code.clone(),
            "patient_id": body.patient_id,
        }),
    ));

    tracing::info!(by = %auth.user_id, case = %created_case_code, "Case created");

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": created_case_id,
            "case_uuid": created_case_id,
            "case_id": created_case_code,
            "created_at": created_at,
            "retention_until": retention_until.map(|value| value.to_rfc3339()),
        })),
    )
        .into_response()
}

async fn get_case_full(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }

    let case = match sqlx::query(
        r#"SELECT c.id, c.case_id, c.patient_id, c.manager_id, c.status,
                  c.hauptanfragegrund, c.aktuelle_anamnese, c.zuweiser_doctor_id, c.zuweiser,
                  c.notes, c.created_at, c.updated_at, c.retention_until,
                  c.last_clinical_update_at, c.version_count,
                  d.name AS zuweiser_doctor_name,
                  p.name AS zuweiser_provider_name
           FROM cases c
           LEFT JOIN provider_doctors d ON d.id = c.zuweiser_doctor_id
           LEFT JOIN providers p ON p.id = d.provider_id
           WHERE c.id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(c)) => c,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(e) => {
            tracing::error!(error = %e, "get case");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let case_id = case.try_get::<Uuid, _>("id").unwrap_or(case_uuid);
    let patient_id = case.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    match can_access_case(&state, &auth, case_id, Some(patient_id)).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let vorerkr = sqlx::query!("SELECT erkrankung, erstdiagnose, notiz FROM vorerkrankungen WHERE case_id = $1 ORDER BY sort_order", case_uuid)
        .fetch_all(&state.db).await.unwrap_or_default();
    let allergien = sqlx::query!(
        "SELECT allergie, reaktion FROM allergien WHERE case_id = $1 ORDER BY sort_order",
        case_uuid
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let ops = sqlx::query(
        r#"SELECT o.datum, o.grund, o.doctor_id, o.arzt, o.notiz,
                  d.name AS doctor_name,
                  p.name AS provider_name
           FROM operationen o
           LEFT JOIN provider_doctors d ON d.id = o.doctor_id
           LEFT JOIN providers p ON p.id = d.provider_id
           WHERE o.case_id = $1
           ORDER BY o.sort_order"#,
    )
    .bind(case_uuid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let meds = sqlx::query(
        r#"SELECT m.handelsname, m.wirkstoff, m.dosis, m.dosis_einheit,
                  m.einnahmeschema, m.darreichungsform, m.einheit, m.anmerkung,
                  m.grund, m.seit, m.verordnender_arzt_id, m.verordnender_arzt, m.med_typ,
                  d.name AS doctor_name,
                  p.name AS provider_name
           FROM medikamente m
           LEFT JOIN provider_doctors d ON d.id = m.verordnender_arzt_id
           LEFT JOIN providers p ON p.id = d.provider_id
           WHERE m.case_id = $1
           ORDER BY m.sort_order"#,
    )
    .bind(case_uuid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let pains = sqlx::query!("SELECT lokalisierung, seit_wann, ursache, qualitaet, kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang, dauer_aktuell, ausstrahlung, auftreten FROM pain_records WHERE case_id = $1 ORDER BY sort_order", case_uuid)
        .fetch_all(&state.db).await.unwrap_or_default();
    let symptoms = sqlx::query!(
        "SELECT beschreibung, fachrichtung FROM symptome WHERE case_id = $1 ORDER BY sort_order",
        case_uuid
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let cardiology = sqlx::query(
        r#"SELECT is_relevant, chest_pain, dyspnea, palpitations, syncope, edema,
                  known_diagnosis, prior_cardiac_workup, cardiovascular_risk_factors,
                  anticoagulation, family_history, red_flags, notes
           FROM case_cardiology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let gastroenterology = sqlx::query(
        r#"SELECT is_relevant, abdominal_pain, reflux, nausea, diarrhea, constipation,
                  gi_bleeding, prior_endoscopy, bowel_habits, liver_history,
                  food_intolerance, red_flags, notes
           FROM case_gastroenterology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let orthopedics = sqlx::query(
        r#"SELECT is_relevant, joint_pain, back_pain, mobility_limitation, trauma_history,
                  prior_imaging, assistive_devices, physiotherapy_history, pain_triggers,
                  red_flags, notes
           FROM case_orthopedics_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let neurology = sqlx::query(
        r#"SELECT is_relevant, headache, dizziness, sensory_changes, weakness,
                  seizure_history, gait_balance_issues, prior_neuro_imaging,
                  prior_neurology_workup, cognitive_changes, red_flags, notes
           FROM case_neurology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let veg = sqlx::query!("SELECT appetit_durst, koerpergroesse, gewicht, gewichtsveraenderung, grund FROM vegetative_anamnese WHERE case_id = $1", case_uuid)
        .fetch_optional(&state.db).await.ok().flatten();
    let impf = sqlx::query!(
        "SELECT status_text FROM impfstatus WHERE case_id = $1",
        case_uuid
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let mut vorerkr_json = Vec::new();
    for v in vorerkr {
        vorerkr_json.push(serde_json::json!({"erkrankung": v.erkrankung, "erstdiagnose": v.erstdiagnose, "notiz": v.notiz}));
    }
    let mut allergien_json = Vec::new();
    for a in allergien {
        allergien_json.push(serde_json::json!({"allergie": a.allergie, "reaktion": a.reaktion}));
    }
    let mut ops_json = Vec::new();
    for o in ops {
        ops_json.push(serde_json::json!({
            "datum": o.try_get::<Option<chrono::NaiveDate>, _>("datum").unwrap_or_default().map(|value| value.to_string()),
            "grund": o.try_get::<String, _>("grund").unwrap_or_default(),
            "arzt_id": o.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
            "arzt": o.try_get::<Option<String>, _>("arzt").unwrap_or_default(),
            "arzt_registry_name": o.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            "arzt_provider_name": o.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
            "notiz": o.try_get::<Option<String>, _>("notiz").unwrap_or_default()
        }));
    }
    let mut meds_json = Vec::new();
    for m in meds {
        meds_json.push(serde_json::json!({
            "handelsname": m.try_get::<String, _>("handelsname").unwrap_or_default(),
            "wirkstoff": m.try_get::<Option<String>, _>("wirkstoff").unwrap_or_default(),
            "dosis": m.try_get::<Option<String>, _>("dosis").unwrap_or_default(),
            "dosis_einheit": m.try_get::<Option<String>, _>("dosis_einheit").unwrap_or_default(),
            "einnahmeschema": m.try_get::<Option<String>, _>("einnahmeschema").unwrap_or_default(),
            "darreichungsform": m.try_get::<Option<String>, _>("darreichungsform").unwrap_or_default(),
            "einheit": m.try_get::<Option<String>, _>("einheit").unwrap_or_default(),
            "anmerkung": m.try_get::<Option<String>, _>("anmerkung").unwrap_or_default(),
            "grund": m.try_get::<Option<String>, _>("grund").unwrap_or_default(),
            "seit": m.try_get::<Option<String>, _>("seit").unwrap_or_default(),
            "verordnender_arzt_id": m.try_get::<Option<Uuid>, _>("verordnender_arzt_id").unwrap_or_default(),
            "verordnender_arzt": m.try_get::<Option<String>, _>("verordnender_arzt").unwrap_or_default(),
            "verordnender_arzt_registry_name": m.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            "verordnender_arzt_provider_name": m.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
            "med_typ": m.try_get::<String, _>("med_typ").unwrap_or_default()
        }));
    }
    let mut pains_json = Vec::new();
    for p in pains {
        pains_json.push(serde_json::json!({"lokalisierung": p.lokalisierung, "seit_wann": p.seit_wann, "ursache": p.ursache, "qualitaet": p.qualitaet, "kontinuitaet": p.kontinuitaet, "entwicklung": p.entwicklung, "nrs_aktuell": p.nrs_aktuell, "nrs_anfang": p.nrs_anfang, "dauer_anfang": p.dauer_anfang, "dauer_aktuell": p.dauer_aktuell, "ausstrahlung": p.ausstrahlung, "auftreten": p.auftreten}));
    }
    let mut symptoms_json = Vec::new();
    for s in symptoms {
        symptoms_json.push(
            serde_json::json!({"beschreibung": s.beschreibung, "fachrichtung": s.fachrichtung}),
        );
    }
    let cardiology_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["cardio", "kardio"]));
    let gastroenterology_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["gastro", "kolo", "colo"]));
    let orthopedics_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["ortho", "orthop", "trauma", "bewegung"]));
    let neurology_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["neuro", "neurol"]));
    let recent_history = match load_case_history(&state.db, case_uuid, 12).await {
        Ok(items) => items,
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load case history");
            Vec::new()
        }
    };

    Json(serde_json::json!({
        "id": case_id,
        "case_uuid": case_id,
        "case_id": case.try_get::<String, _>("case_id").unwrap_or_default(),
        "patient_id": patient_id,
        "manager_id": case.try_get::<Uuid, _>("manager_id").unwrap_or_default(),
        "status": case.try_get::<String, _>("status").unwrap_or_default(),
        "hauptanfragegrund": case.try_get::<Option<String>, _>("hauptanfragegrund").unwrap_or_default(),
        "aktuelle_anamnese": case.try_get::<Option<String>, _>("aktuelle_anamnese").unwrap_or_default(),
        "zuweiser_doctor_id": case.try_get::<Option<Uuid>, _>("zuweiser_doctor_id").unwrap_or_default(),
        "zuweiser": case.try_get::<Option<String>, _>("zuweiser").unwrap_or_default(),
        "zuweiser_registry_name": case.try_get::<Option<String>, _>("zuweiser_doctor_name").unwrap_or_default(),
        "zuweiser_provider_name": case.try_get::<Option<String>, _>("zuweiser_provider_name").unwrap_or_default(),
        "notes": case.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "created_at": case.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": case.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "retention_until": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until").unwrap_or_default().map(|value| value.to_rfc3339()),
        "last_clinical_update_at": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_clinical_update_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "version_count": case.try_get::<i32, _>("version_count").unwrap_or_default(),
        "vorerkrankungen": vorerkr_json,
        "allergien": allergien_json,
        "operationen": ops_json,
        "medikamente": meds_json,
        "pain_records": pains_json,
        "symptome": symptoms_json,
        "cardiology_recommended": cardiology_recommended,
        "cardiology": cardiology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "chest_pain": item.try_get::<bool, _>("chest_pain").unwrap_or(false),
            "dyspnea": item.try_get::<bool, _>("dyspnea").unwrap_or(false),
            "palpitations": item.try_get::<bool, _>("palpitations").unwrap_or(false),
            "syncope": item.try_get::<bool, _>("syncope").unwrap_or(false),
            "edema": item.try_get::<bool, _>("edema").unwrap_or(false),
            "known_diagnosis": item.try_get::<Option<String>, _>("known_diagnosis").unwrap_or_default(),
            "prior_cardiac_workup": item.try_get::<Option<String>, _>("prior_cardiac_workup").unwrap_or_default(),
            "cardiovascular_risk_factors": item.try_get::<Option<String>, _>("cardiovascular_risk_factors").unwrap_or_default(),
            "anticoagulation": item.try_get::<Option<String>, _>("anticoagulation").unwrap_or_default(),
            "family_history": item.try_get::<Option<String>, _>("family_history").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "gastroenterology_recommended": gastroenterology_recommended,
        "gastroenterology": gastroenterology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "abdominal_pain": item.try_get::<bool, _>("abdominal_pain").unwrap_or(false),
            "reflux": item.try_get::<bool, _>("reflux").unwrap_or(false),
            "nausea": item.try_get::<bool, _>("nausea").unwrap_or(false),
            "diarrhea": item.try_get::<bool, _>("diarrhea").unwrap_or(false),
            "constipation": item.try_get::<bool, _>("constipation").unwrap_or(false),
            "gi_bleeding": item.try_get::<bool, _>("gi_bleeding").unwrap_or(false),
            "prior_endoscopy": item.try_get::<Option<String>, _>("prior_endoscopy").unwrap_or_default(),
            "bowel_habits": item.try_get::<Option<String>, _>("bowel_habits").unwrap_or_default(),
            "liver_history": item.try_get::<Option<String>, _>("liver_history").unwrap_or_default(),
            "food_intolerance": item.try_get::<Option<String>, _>("food_intolerance").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "orthopedics_recommended": orthopedics_recommended,
        "orthopedics": orthopedics.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "joint_pain": item.try_get::<bool, _>("joint_pain").unwrap_or(false),
            "back_pain": item.try_get::<bool, _>("back_pain").unwrap_or(false),
            "mobility_limitation": item.try_get::<bool, _>("mobility_limitation").unwrap_or(false),
            "trauma_history": item.try_get::<bool, _>("trauma_history").unwrap_or(false),
            "prior_imaging": item.try_get::<Option<String>, _>("prior_imaging").unwrap_or_default(),
            "assistive_devices": item.try_get::<Option<String>, _>("assistive_devices").unwrap_or_default(),
            "physiotherapy_history": item.try_get::<Option<String>, _>("physiotherapy_history").unwrap_or_default(),
            "pain_triggers": item.try_get::<Option<String>, _>("pain_triggers").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "neurology_recommended": neurology_recommended,
        "neurology": neurology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "headache": item.try_get::<bool, _>("headache").unwrap_or(false),
            "dizziness": item.try_get::<bool, _>("dizziness").unwrap_or(false),
            "sensory_changes": item.try_get::<bool, _>("sensory_changes").unwrap_or(false),
            "weakness": item.try_get::<bool, _>("weakness").unwrap_or(false),
            "seizure_history": item.try_get::<bool, _>("seizure_history").unwrap_or(false),
            "gait_balance_issues": item.try_get::<bool, _>("gait_balance_issues").unwrap_or(false),
            "prior_neuro_imaging": item.try_get::<Option<String>, _>("prior_neuro_imaging").unwrap_or_default(),
            "prior_neurology_workup": item.try_get::<Option<String>, _>("prior_neurology_workup").unwrap_or_default(),
            "cognitive_changes": item.try_get::<Option<String>, _>("cognitive_changes").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "vegetative_anamnese": veg.map(|v| serde_json::json!({"appetit_durst": v.appetit_durst, "koerpergroesse": v.koerpergroesse, "gewicht": v.gewicht, "gewichtsveraenderung": v.gewichtsveraenderung, "grund": v.grund})),
        "impfstatus": impf.map(|i| i.status_text),
        "history": recent_history,
    })).into_response()
}

async fn list_case_doctors(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT d.id, d.provider_id, d.name, d.title, d.fachbereich,
                  p.name AS provider_name
           FROM provider_doctors d
           JOIN providers p ON p.id = d.provider_id
           WHERE p.is_active = true
           ORDER BY p.name, d.name"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
                        "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
                        "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to list case doctors");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load case doctors")
        }
    }
}

async fn update_anamnesis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<UpdateAnamnesisRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let zuweiser_label =
        match resolve_case_doctor_label(&state, body.zuweiser_doctor_id, body.zuweiser.as_deref())
            .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "overview").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load overview snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let result = sqlx::query(
        "UPDATE cases
         SET hauptanfragegrund = COALESCE($2, hauptanfragegrund),
             aktuelle_anamnese = COALESCE($3, aktuelle_anamnese),
             zuweiser_doctor_id = COALESCE($4, zuweiser_doctor_id),
             zuweiser = COALESCE($5, zuweiser)
         WHERE id = $1",
    )
    .bind(case_uuid)
    .bind(body.hauptanfragegrund.clone())
    .bind(body.aktuelle_anamnese.clone())
    .bind(body.zuweiser_doctor_id)
    .bind(zuweiser_label)
    .execute(&state.db)
    .await;
    if let Err(e) = result {
        tracing::error!(error = %e, "update anamnesis");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "overview").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload overview snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "overview",
        old_value,
        new_value,
    )
    .await;

    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_vorerkrankungen(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<VorerkrankungItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "vorerkrankungen").await
    {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load vorerkrankungen snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin vorerkrankungen tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM vorerkrankungen WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete vorerkrankungen");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO vorerkrankungen (case_id, erkrankung, erstdiagnose, notiz, sort_order) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(case_uuid)
        .bind(&item.erkrankung)
        .bind(item.erstdiagnose.clone())
        .bind(item.notiz.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert vorerkrankungen");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit vorerkrankungen");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "vorerkrankungen").await
    {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload vorerkrankungen snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "vorerkrankungen",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_allergien(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<AllergieItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "allergien").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load allergien snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin allergien tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM allergien WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete allergien");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO allergien (case_id, allergie, reaktion, sort_order) VALUES ($1, $2, $3, $4)",
        )
        .bind(case_uuid)
        .bind(&item.allergie)
        .bind(item.reaktion.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert allergien");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit allergien");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "allergien").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload allergien snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "allergien",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_operationen(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<OperationItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "operationen").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load operationen snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin operationen tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM operationen WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete operationen");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        let doctor_label =
            match resolve_case_doctor_label(&state, item.arzt_id, item.arzt.as_deref()).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
        let datum = item
            .datum
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
        if let Err(e) = sqlx::query(
            "INSERT INTO operationen (case_id, datum, grund, doctor_id, arzt, notiz, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(case_uuid)
        .bind(datum)
        .bind(&item.grund)
        .bind(item.arzt_id)
        .bind(doctor_label)
        .bind(item.notiz.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert operationen");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit operationen");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "operationen").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload operationen snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "operationen",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_medikamente(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<MedikamentItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "medikamente").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load medikamente snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin medikamente tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM medikamente WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete medikamente");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        let doctor_label = match resolve_case_doctor_label(
            &state,
            item.verordnender_arzt_id,
            item.verordnender_arzt.as_deref(),
        )
        .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        let mt = item.med_typ.as_deref().unwrap_or("permanent");
        if let Err(e) = sqlx::query(
            "INSERT INTO medikamente (case_id, handelsname, wirkstoff, dosis, dosis_einheit, einnahmeschema, darreichungsform, einheit, anmerkung, grund, seit, verordnender_arzt_id, verordnender_arzt, med_typ, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        )
        .bind(case_uuid)
        .bind(&item.handelsname)
        .bind(item.wirkstoff.clone())
        .bind(item.dosis.clone())
        .bind(item.dosis_einheit.clone())
        .bind(item.einnahmeschema.clone())
        .bind(item.darreichungsform.clone())
        .bind(item.einheit.clone())
        .bind(item.anmerkung.clone())
        .bind(item.grund.clone())
        .bind(item.seit.clone())
        .bind(item.verordnender_arzt_id)
        .bind(doctor_label)
        .bind(mt)
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert medikamente");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit medikamente");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "medikamente").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload medikamente snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "medikamente",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_pain_records(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<PainItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "pain_records").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load pain snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin pain tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM pain_records WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete pain records");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO pain_records (case_id, lokalisierung, seit_wann, ursache, qualitaet, kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang, dauer_aktuell, ausstrahlung, auftreten, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        )
        .bind(case_uuid)
        .bind(&item.lokalisierung)
        .bind(item.seit_wann.clone())
        .bind(item.ursache.clone())
        .bind(item.qualitaet.clone())
        .bind(item.kontinuitaet.clone())
        .bind(item.entwicklung.clone())
        .bind(item.nrs_aktuell)
        .bind(item.nrs_anfang)
        .bind(item.dauer_anfang.clone())
        .bind(item.dauer_aktuell.clone())
        .bind(item.ausstrahlung.clone())
        .bind(item.auftreten.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert pain records");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit pain records");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "pain_records").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload pain snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "pain_records",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_symptome(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<SymptomItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "symptome").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load symptome snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin symptome tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM symptome WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete symptome");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO symptome (case_id, beschreibung, fachrichtung, sort_order) VALUES ($1, $2, $3, $4)",
        )
        .bind(case_uuid)
        .bind(&item.beschreibung)
        .bind(item.fachrichtung.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert symptome");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit symptome");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "symptome").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload symptome snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "symptome",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_cardiology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<CardiologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "cardiology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load cardiology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_cardiology_assessments (
                case_id, is_relevant, chest_pain, dyspnea, palpitations, syncope, edema,
                known_diagnosis, prior_cardiac_workup, cardiovascular_risk_factors,
                anticoagulation, family_history, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                chest_pain = EXCLUDED.chest_pain,
                dyspnea = EXCLUDED.dyspnea,
                palpitations = EXCLUDED.palpitations,
                syncope = EXCLUDED.syncope,
                edema = EXCLUDED.edema,
                known_diagnosis = EXCLUDED.known_diagnosis,
                prior_cardiac_workup = EXCLUDED.prior_cardiac_workup,
                cardiovascular_risk_factors = EXCLUDED.cardiovascular_risk_factors,
                anticoagulation = EXCLUDED.anticoagulation,
                family_history = EXCLUDED.family_history,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.chest_pain.unwrap_or(false))
    .bind(body.dyspnea.unwrap_or(false))
    .bind(body.palpitations.unwrap_or(false))
    .bind(body.syncope.unwrap_or(false))
    .bind(body.edema.unwrap_or(false))
    .bind(body.known_diagnosis.clone())
    .bind(body.prior_cardiac_workup.clone())
    .bind(body.cardiovascular_risk_factors.clone())
    .bind(body.anticoagulation.clone())
    .bind(body.family_history.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save cardiology assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "cardiology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload cardiology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "cardiology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_gastroenterology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<GastroenterologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "gastroenterology").await
    {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(
                error = %e,
                case_id = %case_uuid,
                "load gastroenterology snapshot"
            );
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_gastroenterology_assessments (
                case_id, is_relevant, abdominal_pain, reflux, nausea, diarrhea,
                constipation, gi_bleeding, prior_endoscopy, bowel_habits,
                liver_history, food_intolerance, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13, $14
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                abdominal_pain = EXCLUDED.abdominal_pain,
                reflux = EXCLUDED.reflux,
                nausea = EXCLUDED.nausea,
                diarrhea = EXCLUDED.diarrhea,
                constipation = EXCLUDED.constipation,
                gi_bleeding = EXCLUDED.gi_bleeding,
                prior_endoscopy = EXCLUDED.prior_endoscopy,
                bowel_habits = EXCLUDED.bowel_habits,
                liver_history = EXCLUDED.liver_history,
                food_intolerance = EXCLUDED.food_intolerance,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.abdominal_pain.unwrap_or(false))
    .bind(body.reflux.unwrap_or(false))
    .bind(body.nausea.unwrap_or(false))
    .bind(body.diarrhea.unwrap_or(false))
    .bind(body.constipation.unwrap_or(false))
    .bind(body.gi_bleeding.unwrap_or(false))
    .bind(body.prior_endoscopy.clone())
    .bind(body.bowel_habits.clone())
    .bind(body.liver_history.clone())
    .bind(body.food_intolerance.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(
            error = %e,
            case_id = %case_uuid,
            "save gastroenterology assessment"
        );
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "gastroenterology").await
    {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(
                error = %e,
                case_id = %case_uuid,
                "reload gastroenterology snapshot"
            );
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "gastroenterology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_orthopedics(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<OrthopedicsAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "orthopedics").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load orthopedics snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_orthopedics_assessments (
                case_id, is_relevant, joint_pain, back_pain, mobility_limitation,
                trauma_history, prior_imaging, assistive_devices, physiotherapy_history,
                pain_triggers, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                joint_pain = EXCLUDED.joint_pain,
                back_pain = EXCLUDED.back_pain,
                mobility_limitation = EXCLUDED.mobility_limitation,
                trauma_history = EXCLUDED.trauma_history,
                prior_imaging = EXCLUDED.prior_imaging,
                assistive_devices = EXCLUDED.assistive_devices,
                physiotherapy_history = EXCLUDED.physiotherapy_history,
                pain_triggers = EXCLUDED.pain_triggers,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.joint_pain.unwrap_or(false))
    .bind(body.back_pain.unwrap_or(false))
    .bind(body.mobility_limitation.unwrap_or(false))
    .bind(body.trauma_history.unwrap_or(false))
    .bind(body.prior_imaging.clone())
    .bind(body.assistive_devices.clone())
    .bind(body.physiotherapy_history.clone())
    .bind(body.pain_triggers.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save orthopedics assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "orthopedics").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload orthopedics snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "orthopedics",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_neurology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<NeurologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "neurology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load neurology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_neurology_assessments (
                case_id, is_relevant, headache, dizziness, sensory_changes,
                weakness, seizure_history, gait_balance_issues, prior_neuro_imaging,
                prior_neurology_workup, cognitive_changes, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12, $13
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                headache = EXCLUDED.headache,
                dizziness = EXCLUDED.dizziness,
                sensory_changes = EXCLUDED.sensory_changes,
                weakness = EXCLUDED.weakness,
                seizure_history = EXCLUDED.seizure_history,
                gait_balance_issues = EXCLUDED.gait_balance_issues,
                prior_neuro_imaging = EXCLUDED.prior_neuro_imaging,
                prior_neurology_workup = EXCLUDED.prior_neurology_workup,
                cognitive_changes = EXCLUDED.cognitive_changes,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.headache.unwrap_or(false))
    .bind(body.dizziness.unwrap_or(false))
    .bind(body.sensory_changes.unwrap_or(false))
    .bind(body.weakness.unwrap_or(false))
    .bind(body.seizure_history.unwrap_or(false))
    .bind(body.gait_balance_issues.unwrap_or(false))
    .bind(body.prior_neuro_imaging.clone())
    .bind(body.prior_neurology_workup.clone())
    .bind(body.cognitive_changes.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save neurology assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "neurology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload neurology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "neurology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_vegetative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<VegetativeRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "vegetative").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load vegetative snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let kg = body
        .koerpergroesse
        .and_then(|v| rust_decimal::Decimal::try_from(v).ok());
    let gw = body
        .gewicht
        .and_then(|v| rust_decimal::Decimal::try_from(v).ok());
    if let Err(e) = sqlx::query!(
        "INSERT INTO vegetative_anamnese (case_id, appetit_durst, koerpergroesse, gewicht, gewichtsveraenderung, grund)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (case_id) DO UPDATE SET appetit_durst=$2, koerpergroesse=$3, gewicht=$4, gewichtsveraenderung=$5, grund=$6",
        case_uuid, body.appetit_durst, kg, gw, body.gewichtsveraenderung, body.grund
    ).execute(&state.db).await {
        tracing::error!(error = %e, "save vegetative");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "vegetative").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload vegetative snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "vegetative",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_impfstatus(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ImpfstatusRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "impfstatus").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load impfstatus snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query!(
        "INSERT INTO impfstatus (case_id, status_text) VALUES ($1, $2)
         ON CONFLICT (case_id) DO UPDATE SET status_text=$2",
        case_uuid,
        body.status_text
    )
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, "save impfstatus");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "impfstatus").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload impfstatus snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "impfstatus",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn get_case_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Query(query): Query<CaseHistoryQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    match load_case_history(&state.db, case_uuid, limit).await {
        Ok(items) => Json(items).into_response(),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "get case history");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load case history",
            )
        }
    }
}

async fn version_log(
    state: &AppState,
    case_id: Uuid,
    user_id: Uuid,
    section: &str,
    old_value: serde_json::Value,
    new_value: serde_json::Value,
) {
    let retention_years = load_case_retention_years(state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_id, "begin case version tx");
            return;
        }
    };
    if let Err(e) = sqlx::query(
        "INSERT INTO case_versions (case_id, changed_by, section, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(case_id)
    .bind(user_id)
    .bind(section)
    .bind(old_value)
    .bind(new_value)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, case_id = %case_id, section, "insert case version");
        return;
    }

    if let Err(e) = sqlx::query(
        "UPDATE cases
         SET version_count = version_count + 1,
             last_clinical_update_at = now(),
             retention_until = GREATEST(
                 COALESCE(retention_until, now()),
                 now() + ($2 * interval '1 year')
             )
         WHERE id = $1",
    )
    .bind(case_id)
    .bind(retention_years.max(1))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, case_id = %case_id, section, "update case retention metadata");
        return;
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_id, section, "commit case version tx");
    }
}

async fn load_case_retention_years(state: &AppState, default: i64) -> i64 {
    match sqlx::query(r#"SELECT value::TEXT AS value_text FROM system_settings WHERE key = $1"#)
        .bind("clinical_case_retention_years")
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row
            .try_get::<String, _>("value_text")
            .ok()
            .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
            .unwrap_or(default),
        _ => default,
    }
}

async fn load_case_history(
    db: &sqlx::PgPool,
    case_id: Uuid,
    limit: i64,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT cv.id, cv.section, cv.old_value, cv.new_value, cv.created_at,
                  cv.changed_by, u.name AS changed_by_name, u.role AS changed_by_role
           FROM case_versions cv
           JOIN users u ON u.id = cv.changed_by
           WHERE cv.case_id = $1
           ORDER BY cv.created_at DESC, cv.id DESC
           LIMIT $2"#,
    )
    .bind(case_id)
    .bind(limit)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<i64, _>("id").unwrap_or_default(),
                "section": row.try_get::<String, _>("section").unwrap_or_default(),
                "old_value": row.try_get::<Option<serde_json::Value>, _>("old_value").unwrap_or_default(),
                "new_value": row.try_get::<Option<serde_json::Value>, _>("new_value").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "changed_by": row.try_get::<Uuid, _>("changed_by").unwrap_or_default(),
                "changed_by_name": row.try_get::<String, _>("changed_by_name").unwrap_or_default(),
                "changed_by_role": row.try_get::<String, _>("changed_by_role").unwrap_or_default(),
            })
        })
        .collect())
}

async fn load_case_section_snapshot(
    db: &sqlx::PgPool,
    case_id: Uuid,
    section: &str,
) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let query = match section {
        "overview" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'hauptanfragegrund', hauptanfragegrund,
                        'aktuelle_anamnese', aktuelle_anamnese,
                        'zuweiser_doctor_id', zuweiser_doctor_id,
                        'zuweiser', zuweiser,
                        'notes', notes
                    ) AS value
                   FROM cases
                   WHERE id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "vorerkrankungen" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'erkrankung', erkrankung,
                                'erstdiagnose', erstdiagnose,
                                'notiz', notiz
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM vorerkrankungen
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "allergien" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'allergie', allergie,
                                'reaktion', reaktion
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM allergien
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "operationen" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'datum', datum,
                                'grund', grund,
                                'arzt_id', doctor_id,
                                'arzt', arzt,
                                'notiz', notiz
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM operationen
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "medikamente" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'handelsname', handelsname,
                                'wirkstoff', wirkstoff,
                                'dosis', dosis,
                                'dosis_einheit', dosis_einheit,
                                'einnahmeschema', einnahmeschema,
                                'darreichungsform', darreichungsform,
                                'einheit', einheit,
                                'anmerkung', anmerkung,
                                'grund', grund,
                                'seit', seit,
                                'verordnender_arzt_id', verordnender_arzt_id,
                                'verordnender_arzt', verordnender_arzt,
                                'med_typ', med_typ
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM medikamente
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "pain_records" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'lokalisierung', lokalisierung,
                                'seit_wann', seit_wann,
                                'ursache', ursache,
                                'qualitaet', qualitaet,
                                'kontinuitaet', kontinuitaet,
                                'entwicklung', entwicklung,
                                'nrs_aktuell', nrs_aktuell,
                                'nrs_anfang', nrs_anfang,
                                'dauer_anfang', dauer_anfang,
                                'dauer_aktuell', dauer_aktuell,
                                'ausstrahlung', ausstrahlung,
                                'auftreten', auftreten
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM pain_records
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "symptome" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'beschreibung', beschreibung,
                                'fachrichtung', fachrichtung
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM symptome
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "cardiology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'chest_pain', chest_pain,
                        'dyspnea', dyspnea,
                        'palpitations', palpitations,
                        'syncope', syncope,
                        'edema', edema,
                        'known_diagnosis', known_diagnosis,
                        'prior_cardiac_workup', prior_cardiac_workup,
                        'cardiovascular_risk_factors', cardiovascular_risk_factors,
                        'anticoagulation', anticoagulation,
                        'family_history', family_history,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_cardiology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "gastroenterology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'abdominal_pain', abdominal_pain,
                        'reflux', reflux,
                        'nausea', nausea,
                        'diarrhea', diarrhea,
                        'constipation', constipation,
                        'gi_bleeding', gi_bleeding,
                        'prior_endoscopy', prior_endoscopy,
                        'bowel_habits', bowel_habits,
                        'liver_history', liver_history,
                        'food_intolerance', food_intolerance,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_gastroenterology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "orthopedics" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'joint_pain', joint_pain,
                        'back_pain', back_pain,
                        'mobility_limitation', mobility_limitation,
                        'trauma_history', trauma_history,
                        'prior_imaging', prior_imaging,
                        'assistive_devices', assistive_devices,
                        'physiotherapy_history', physiotherapy_history,
                        'pain_triggers', pain_triggers,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_orthopedics_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "neurology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'headache', headache,
                        'dizziness', dizziness,
                        'sensory_changes', sensory_changes,
                        'weakness', weakness,
                        'seizure_history', seizure_history,
                        'gait_balance_issues', gait_balance_issues,
                        'prior_neuro_imaging', prior_neuro_imaging,
                        'prior_neurology_workup', prior_neurology_workup,
                        'cognitive_changes', cognitive_changes,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_neurology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "vegetative" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'appetit_durst', appetit_durst,
                        'koerpergroesse', koerpergroesse,
                        'gewicht', gewicht,
                        'gewichtsveraenderung', gewichtsveraenderung,
                        'grund', grund
                    ) AS value
                   FROM vegetative_anamnese
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "impfstatus" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'status_text', status_text
                    ) AS value
                   FROM impfstatus
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        _ => None,
    };

    Ok(query.flatten().and_then(|row| {
        row.try_get::<Option<serde_json::Value>, _>("value")
            .ok()
            .flatten()
    }))
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access")
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn can_access_case(
    state: &AppState,
    auth: &AuthUser,
    case_id: Uuid,
    patient_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(true);
    }

    let Some(patient_id) = patient_id else {
        let row = sqlx::query("SELECT patient_id, manager_id FROM cases WHERE id = $1")
            .bind(case_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, case_id = %case_id, "Failed to load case access context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate case access")
            })?;

        let Some(row) = row else {
            return Ok(false);
        };
        let owner_id: Uuid = row.try_get("manager_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode case access context",
            )
        })?;
        if owner_id == auth.user_id {
            return Ok(true);
        }

        let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode case access context",
            )
        })?;
        return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, case_id = %case_id, "Failed to validate case assignment");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate case access")
            });
    };

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate case assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate case access")
        })
}

async fn resolve_case_doctor_label(
    state: &AppState,
    doctor_id: Option<Uuid>,
    free_text: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    let normalized_free_text = free_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let Some(doctor_id) = doctor_id else {
        return Ok(normalized_free_text);
    };

    let row = sqlx::query("SELECT name FROM provider_doctors WHERE id = $1")
        .bind(doctor_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %doctor_id, "resolve case doctor");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate doctor",
            )
        })?;

    let Some(row) = row else {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Doctor not found"));
    };

    let doctor_name = row.try_get::<String, _>("name").unwrap_or_default();
    if doctor_name.trim().is_empty() {
        return Ok(normalized_free_text);
    }

    Ok(Some(normalized_free_text.unwrap_or(doctor_name)))
}
