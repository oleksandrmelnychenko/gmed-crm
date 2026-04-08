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
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cases", get(list_cases).post(create_case))
        .route("/cases/{case_id}", get(get_case_full))
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
        .route("/cases/{case_id}/vegetative", post(save_vegetative))
        .route("/cases/{case_id}/impfstatus", post(save_impfstatus))
}

#[derive(Deserialize)]
struct CreateCaseRequest {
    patient_id: Uuid,
    hauptanfragegrund: Option<String>,
    aktuelle_anamnese: Option<String>,
    zuweiser: Option<String>,
}

#[derive(Deserialize)]
struct UpdateAnamnesisRequest {
    hauptanfragegrund: Option<String>,
    aktuelle_anamnese: Option<String>,
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

fn gen_case_id(seq: i64) -> String {
    let now = chrono::Utc::now();
    format!("C-{}-{:04}", now.format("%Y%m%d"), seq)
}

async fn list_cases(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListCasesQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
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

    let row = match sqlx::query!(
        "INSERT INTO cases (case_id, patient_id, manager_id, hauptanfragegrund, aktuelle_anamnese, zuweiser)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, case_id, created_at",
        cid, body.patient_id, auth.user_id,
        body.hauptanfragegrund, body.aktuelle_anamnese, body.zuweiser
    ).fetch_one(&state.db).await {
        Ok(r) => r,
        Err(e) => { tracing::error!(error = %e, "create case"); return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"); }
    };

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'create_case', 'case', $2, $3)",
        auth.user_id, row.id, serde_json::json!({"case_id": row.case_id, "patient_id": body.patient_id})
    ).execute(&state.db).await;

    tracing::info!(by = %auth.user_id, case = %row.case_id, "Case created");

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": row.id, "case_id": row.case_id, "created_at": row.created_at
        })),
    )
        .into_response()
}

async fn get_case_full(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }

    let case = match sqlx::query!(
        "SELECT id, case_id, patient_id, manager_id, status, hauptanfragegrund, aktuelle_anamnese, zuweiser, notes, created_at, updated_at FROM cases WHERE id = $1",
        case_uuid
    ).fetch_optional(&state.db).await {
        Ok(Some(c)) => c,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(e) => { tracing::error!(error = %e, "get case"); return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"); }
    };

    match can_access_case(&state, &auth, case.id, Some(case.patient_id)).await {
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
    let ops = sqlx::query!(
        "SELECT datum, grund, arzt, notiz FROM operationen WHERE case_id = $1 ORDER BY sort_order",
        case_uuid
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let meds = sqlx::query!("SELECT handelsname, wirkstoff, dosis, dosis_einheit, einnahmeschema, darreichungsform, einheit, anmerkung, grund, seit, verordnender_arzt, med_typ FROM medikamente WHERE case_id = $1 ORDER BY sort_order", case_uuid)
        .fetch_all(&state.db).await.unwrap_or_default();
    let pains = sqlx::query!("SELECT lokalisierung, seit_wann, ursache, qualitaet, kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang, dauer_aktuell, ausstrahlung, auftreten FROM pain_records WHERE case_id = $1 ORDER BY sort_order", case_uuid)
        .fetch_all(&state.db).await.unwrap_or_default();
    let symptoms = sqlx::query!(
        "SELECT beschreibung, fachrichtung FROM symptome WHERE case_id = $1 ORDER BY sort_order",
        case_uuid
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
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
        ops_json.push(serde_json::json!({"datum": o.datum, "grund": o.grund, "arzt": o.arzt, "notiz": o.notiz}));
    }
    let mut meds_json = Vec::new();
    for m in meds {
        meds_json.push(serde_json::json!({"handelsname": m.handelsname, "wirkstoff": m.wirkstoff, "dosis": m.dosis, "dosis_einheit": m.dosis_einheit, "einnahmeschema": m.einnahmeschema, "darreichungsform": m.darreichungsform, "einheit": m.einheit, "anmerkung": m.anmerkung, "grund": m.grund, "seit": m.seit, "verordnender_arzt": m.verordnender_arzt, "med_typ": m.med_typ}));
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

    Json(serde_json::json!({
        "id": case.id,
        "case_id": case.case_id,
        "patient_id": case.patient_id,
        "manager_id": case.manager_id,
        "status": case.status,
        "hauptanfragegrund": case.hauptanfragegrund,
        "aktuelle_anamnese": case.aktuelle_anamnese,
        "zuweiser": case.zuweiser,
        "notes": case.notes,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "vorerkrankungen": vorerkr_json,
        "allergien": allergien_json,
        "operationen": ops_json,
        "medikamente": meds_json,
        "pain_records": pains_json,
        "symptome": symptoms_json,
        "vegetative_anamnese": veg.map(|v| serde_json::json!({"appetit_durst": v.appetit_durst, "koerpergroesse": v.koerpergroesse, "gewicht": v.gewicht, "gewichtsveraenderung": v.gewichtsveraenderung, "grund": v.grund})),
        "impfstatus": impf.map(|i| i.status_text),
    })).into_response()
}

async fn update_anamnesis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<UpdateAnamnesisRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let result = sqlx::query!(
        "UPDATE cases SET hauptanfragegrund = COALESCE($2, hauptanfragegrund), aktuelle_anamnese = COALESCE($3, aktuelle_anamnese), zuweiser = COALESCE($4, zuweiser) WHERE id = $1",
        case_uuid, body.hauptanfragegrund, body.aktuelle_anamnese, body.zuweiser
    ).execute(&state.db).await;
    if let Err(e) = result {
        tracing::error!(error = %e, "update anamnesis");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_vorerkrankungen(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<VorerkrankungItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    sqlx::query!("DELETE FROM vorerkrankungen WHERE case_id = $1", case_uuid)
        .execute(&state.db)
        .await
        .ok();
    for (i, item) in body.items.iter().enumerate() {
        sqlx::query!("INSERT INTO vorerkrankungen (case_id, erkrankung, erstdiagnose, notiz, sort_order) VALUES ($1, $2, $3, $4, $5)",
            case_uuid, item.erkrankung, item.erstdiagnose, item.notiz, i as i32
        ).execute(&state.db).await.ok();
    }
    version_log(
        &state.db,
        case_uuid,
        auth.user_id,
        "vorerkrankungen",
        &body.items,
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    sqlx::query!("DELETE FROM allergien WHERE case_id = $1", case_uuid)
        .execute(&state.db)
        .await
        .ok();
    for (i, item) in body.items.iter().enumerate() {
        sqlx::query!("INSERT INTO allergien (case_id, allergie, reaktion, sort_order) VALUES ($1, $2, $3, $4)",
            case_uuid, item.allergie, item.reaktion, i as i32
        ).execute(&state.db).await.ok();
    }
    version_log(&state.db, case_uuid, auth.user_id, "allergien", &body.items).await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_operationen(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<OperationItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    sqlx::query!("DELETE FROM operationen WHERE case_id = $1", case_uuid)
        .execute(&state.db)
        .await
        .ok();
    for (i, item) in body.items.iter().enumerate() {
        let datum = item
            .datum
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
        sqlx::query!("INSERT INTO operationen (case_id, datum, grund, arzt, notiz, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
            case_uuid, datum, item.grund, item.arzt, item.notiz, i as i32
        ).execute(&state.db).await.ok();
    }
    version_log(
        &state.db,
        case_uuid,
        auth.user_id,
        "operationen",
        &body.items,
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    sqlx::query!("DELETE FROM medikamente WHERE case_id = $1", case_uuid)
        .execute(&state.db)
        .await
        .ok();
    for (i, item) in body.items.iter().enumerate() {
        let mt = item.med_typ.as_deref().unwrap_or("permanent");
        sqlx::query!("INSERT INTO medikamente (case_id, handelsname, wirkstoff, dosis, dosis_einheit, einnahmeschema, darreichungsform, einheit, anmerkung, grund, seit, verordnender_arzt, med_typ, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            case_uuid, item.handelsname, item.wirkstoff, item.dosis, item.dosis_einheit, item.einnahmeschema, item.darreichungsform, item.einheit, item.anmerkung, item.grund, item.seit, item.verordnender_arzt, mt, i as i32
        ).execute(&state.db).await.ok();
    }
    version_log(
        &state.db,
        case_uuid,
        auth.user_id,
        "medikamente",
        &body.items,
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    sqlx::query!("DELETE FROM pain_records WHERE case_id = $1", case_uuid)
        .execute(&state.db)
        .await
        .ok();
    for (i, item) in body.items.iter().enumerate() {
        sqlx::query!("INSERT INTO pain_records (case_id, lokalisierung, seit_wann, ursache, qualitaet, kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang, dauer_aktuell, ausstrahlung, auftreten, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            case_uuid, item.lokalisierung, item.seit_wann, item.ursache, item.qualitaet, item.kontinuitaet, item.entwicklung, item.nrs_aktuell, item.nrs_anfang, item.dauer_anfang, item.dauer_aktuell, item.ausstrahlung, item.auftreten, i as i32
        ).execute(&state.db).await.ok();
    }
    version_log(
        &state.db,
        case_uuid,
        auth.user_id,
        "pain_records",
        &body.items,
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    sqlx::query!("DELETE FROM symptome WHERE case_id = $1", case_uuid)
        .execute(&state.db)
        .await
        .ok();
    for (i, item) in body.items.iter().enumerate() {
        sqlx::query!("INSERT INTO symptome (case_id, beschreibung, fachrichtung, sort_order) VALUES ($1, $2, $3, $4)",
            case_uuid, item.beschreibung, item.fachrichtung, i as i32
        ).execute(&state.db).await.ok();
    }
    version_log(&state.db, case_uuid, auth.user_id, "symptome", &body.items).await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_vegetative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<VegetativeRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
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
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_impfstatus(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ImpfstatusRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
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
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn version_log<T: Serialize>(
    db: &sqlx::PgPool,
    case_id: Uuid,
    user_id: Uuid,
    section: &str,
    data: &[T],
) {
    let json = serde_json::to_value(data).unwrap_or_default();
    let _ = sqlx::query!(
        "INSERT INTO case_versions (case_id, changed_by, section, new_value) VALUES ($1, $2, $3, $4)",
        case_id, user_id, section, json
    ).execute(db).await;
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
