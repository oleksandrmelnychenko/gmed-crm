use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::Response,
    routing::get,
};
use chrono::{Datelike, NaiveDate};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use super::{
    SignerPolicy, db_error, error,
    provider::{Signer, normalize_signers},
};
use crate::{audit, auth::middleware::AuthUser, routes::patients, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/document-signatures/signer-defaults",
            get(get_defaults).put(save_defaults),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Defaults {
    signers: Vec<Signer>,
}

fn normalize_defaults(signers: Vec<Signer>) -> Result<Vec<Signer>, &'static str> {
    if signers.len() > 5 || signers.iter().any(|s| s.role != "agency") {
        return Err("agency_signers_required");
    }
    if signers.is_empty() {
        return Ok(signers);
    }
    normalize_signers(signers)
}

/// GMED's default signers (the agency side of every request).
pub(super) async fn load(state: &AppState) -> Result<Vec<Signer>, Response> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT signers FROM signature_signer_defaults WHERE singleton=true")
            .fetch_optional(&state.db)
            .await
            .map_err(db_error)?;
    serde_json::from_value(value.unwrap_or_else(|| json!([]))).map_err(|_| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "signature_defaults_invalid",
        )
    })
}

async fn get_defaults(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    auth.require_capability(Capability::AdminSignatures)?;
    Ok(Json(json!({"signers":load(&state).await?})))
}

async fn save_defaults(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<Defaults>,
) -> Result<Json<Value>, Response> {
    auth.require_capability(Capability::AdminSignatures)?;
    let signers = normalize_defaults(body.signers)
        .map_err(|code| error(StatusCode::UNPROCESSABLE_ENTITY, code))?;
    sqlx::query("INSERT INTO signature_signer_defaults(singleton,signers,updated_by) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET signers=EXCLUDED.signers,updated_by=EXCLUDED.updated_by,updated_at=now()")
        .bind(json!(signers)).bind(auth.user_id).execute(&state.db).await.map_err(db_error)?;
    state.audit_sender.try_send(audit::domain_event(
        "signature_signer_defaults_saved",
        Some(auth.user_id),
        "signature_settings",
        None,
        json!({"representatives":signers.len()}),
    ));
    Ok(Json(json!({"signers":signers})))
}

fn empty(role: &str) -> Signer {
    Signer {
        first_name: String::new(),
        last_name: String::new(),
        email: String::new(),
        role: role.into(),
        positions: Vec::new(),
    }
}

pub(super) fn is_minor(date_of_birth: Option<NaiveDate>) -> bool {
    let Some(date_of_birth) = date_of_birth else {
        return false;
    };
    let today = crate::app_time::today();
    let mut age = today.year() - date_of_birth.year();
    if (today.month(), today.day()) < (date_of_birth.month(), date_of_birth.day()) {
        age -= 1;
    }
    age < 18
}

pub(crate) fn is_guardian_relation(value: Option<&str>) -> bool {
    let value = value.unwrap_or_default().trim().to_lowercase();
    [
        "parent",
        "mother",
        "father",
        "guardian",
        "mutter",
        "vater",
        "vormund",
        "мам",
        "пап",
        "родител",
        "опек",
        "бать",
    ]
    .iter()
    .any(|candidate| value.contains(candidate))
}

fn signer_name(name: &str) -> (String, String) {
    let mut parts = name.split_whitespace().collect::<Vec<_>>();
    if parts.len() <= 1 {
        return (
            parts.first().copied().unwrap_or_default().to_string(),
            String::new(),
        );
    }
    let last_name = parts.pop().unwrap_or_default().to_string();
    (parts.join(" "), last_name)
}

fn contact_signer(contact: &Value) -> Option<Signer> {
    let email = contact.get("email").and_then(Value::as_str)?.trim();
    let name = contact.get("name").and_then(Value::as_str)?.trim();
    if email.is_empty() || name.is_empty() {
        return None;
    }
    let (first_name, last_name) = signer_name(name);
    Some(Signer {
        first_name,
        last_name,
        email: email.to_lowercase(),
        role: "client".into(),
        positions: Vec::new(),
    })
}

/// Every recorded guardian with an e-mail address, once each: under joint
/// custody both parents represent the child together (§ 1629 Abs. 1 BGB) and
/// both sign; one signs when only one is recorded.
fn guardian_signers(contacts: &Value) -> Vec<Signer> {
    let mut signers: Vec<Signer> = Vec::new();
    for contact in contacts.as_array().into_iter().flatten() {
        if !is_guardian_relation(contact.get("relation").and_then(Value::as_str)) {
            continue;
        }
        if let Some(signer) = contact_signer(contact)
            && !signers.iter().any(|known| known.email == signer.email)
        {
            signers.push(signer);
        }
    }
    signers
}

/// A signer of a representative with a name and an e-mail address.
fn named_signer(first_name: &str, last_name: &str, email: Option<&str>) -> Option<Signer> {
    let email = email.map(str::trim).filter(|email| !email.is_empty())?;
    let (first_name, last_name) = (first_name.trim(), last_name.trim());
    if first_name.is_empty() && last_name.is_empty() {
        return None;
    }
    Some(Signer {
        first_name: first_name.into(),
        last_name: last_name.into(),
        email: email.to_lowercase(),
        role: "client".into(),
        positions: Vec::new(),
    })
}

/// Each signer once, by e-mail address.
fn unique_signers(signers: impl IntoIterator<Item = Signer>) -> Vec<Signer> {
    let mut unique: Vec<Signer> = Vec::new();
    for signer in signers {
        if !unique.iter().any(|known| known.email == signer.email) {
            unique.push(signer);
        }
    }
    unique
}

/// The representatives of a minor lead who contract: the first parent, the
/// second one only under joint custody (the places of the form).
fn lead_contracting_signers(
    representation: &crate::routes::lead_representatives::Representation,
) -> Vec<Signer> {
    unique_signers(
        representation
            .representatives
            .iter()
            .filter(|person| person.slot.is_some())
            .filter_map(|person| {
                named_signer(
                    &person.first_name,
                    &person.last_name,
                    person.email.as_deref(),
                )
            }),
    )
}

/// The representatives of a minor patient who contract
/// (`contracting_party::resolve`: the order's choice, else the relations the
/// conversion stored on the patient, else every recorded parent).
fn patient_contracting_signers(
    representatives: &[crate::services::contracting_party::Representative],
) -> Vec<Signer> {
    unique_signers(representatives.iter().filter_map(|representative| {
        match (&representative.first_name, &representative.last_name) {
            (Some(first), Some(last)) => named_signer(first, last, representative.email.as_deref()),
            _ => {
                let (first, last) = signer_name(&representative.name);
                named_signer(&first, &last, representative.email.as_deref())
            }
        }
    }))
}

/// The contract documents a minor's paying parent signs alone (owner decision
/// 2026-10-25, map item 94: one e-mail, one signature — the parent the
/// cabinet named as invoice recipient who also pays is the only Auftraggeber,
/// as the PDF prints them). The consents keep every custody parent.
fn paying_parent_signs_alone(template: Option<&str>) -> bool {
    matches!(
        template,
        Some("framework_contract" | "single_order" | "order_cost_estimate")
    )
}

/// Who signs for a minor; `None` when nothing is recorded beyond the legacy
/// trusted contacts of a patient. `template` is the generated template of the
/// document: for the contract documents the signers follow the party block
/// (`paying_parent_signs_alone`).
async fn contracting_signers(
    state: &AppState,
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
    order_id: Option<Uuid>,
    template: Option<&str>,
) -> Result<Option<Vec<Signer>>, Response> {
    use crate::routes::documents::{only_paying_parent, paying_parent_contact};
    let mut conn = state.db.acquire().await.map_err(db_error)?;
    if let Some(lead_id) = lead_id {
        let Some(mut loaded) = crate::routes::lead_representatives::load(&mut conn, lead_id)
            .await
            .map_err(db_error)?
        else {
            return Ok(None);
        };
        if paying_parent_signs_alone(template) {
            let paying_parent = paying_parent_contact(&mut conn, lead_id)
                .await
                .map_err(db_error)?;
            loaded.representation.representatives = only_paying_parent(
                loaded.representation.representatives,
                paying_parent,
                |person| Some(person.id),
            );
        }
        return Ok(Some(lead_contracting_signers(&loaded.representation)));
    }
    let Some(patient_id) = patient_id else {
        return Ok(None);
    };
    let mut party = crate::services::contracting_party::resolve(
        &mut conn,
        patient_id,
        order_id,
        None,
        crate::app_time::today(),
    )
    .await
    .map_err(db_error)?;
    if party.representatives.is_empty() {
        return Ok(None);
    }
    if paying_parent_signs_alone(template)
        && party.representatives.len() > 1
        && let Some(lead_id) = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM leads WHERE converted_patient_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(patient_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_error)?
    {
        let paying_parent = paying_parent_contact(&mut conn, lead_id)
            .await
            .map_err(db_error)?;
        party.representatives =
            only_paying_parent(party.representatives, paying_parent, |representative| {
                representative.source_contact_id
            });
    }
    Ok(Some(patient_contracting_signers(&party.representatives)))
}

#[cfg(test)]
fn guardian_signer(contacts: &Value) -> Option<Signer> {
    guardian_signers(contacts).into_iter().next()
}

/// The payer of the order a Kostenübernahmeerklärung belongs to: the
/// Kostenübernehmer signs it, not the patient.
async fn order_payer_signer(state: &AppState, source: &PgRow) -> Result<Option<Signer>, Response> {
    let template = source
        .try_get::<Option<String>, _>("generated_template_id")
        .unwrap_or_default();
    if template.as_deref() != Some("cost_coverage_declaration") {
        return Ok(None);
    }
    let Some(order_id) = source
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default()
    else {
        return Ok(None);
    };
    // A lead's order has no patient yet: its payer (from the lead's payer
    // declaration) is a contact that needs none. The Kostenübernehmer chain,
    // not the recipient one: where the lead wants the invoice sent does not
    // change who joins the debt and signs.
    let patient_id = source
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
        .unwrap_or(Uuid::nil());
    let mut conn = state.db.acquire().await.map_err(db_error)?;
    let inherited = crate::routes::invoices::payer::inherited_cost_bearer(
        &mut conn,
        Some(order_id),
        patient_id,
    )
    .await
    .map_err(db_error)?;
    if !inherited.record.is_set() {
        return Ok(None);
    }
    let record = &inherited.record;
    // A minor's paying parent is the contracting party, never a
    // Kostenübernehmer who signs as `payer` (owner decision 2026-10-19): an
    // order payer in that role, or the parent the open lead's declaration
    // names (also a third-party row of before that names that parent).
    if record.payer_role.as_deref()
        == Some(crate::routes::invoices::payer::PAYER_ROLE_CONTRACTING_PARTY)
        || crate::routes::lead_payer::representative_pays(&mut conn, None, Some(order_id))
            .await
            .map_err(db_error)?
    {
        return Ok(None);
    }
    let recipient: Option<Value> =
        sqlx::query_scalar("SELECT invoice_recipient_resolve($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(patient_id)
            .bind(record.payer_patient_id)
            .bind(record.payer_patient_relation_id)
            .bind(&record.contact_name)
            .bind(&record.contact_email)
            .bind(&record.address_street)
            .bind(&record.address_zip)
            .bind(&record.address_city)
            .bind(&record.address_country)
            .fetch_one(&mut *conn)
            .await
            .map_err(db_error)?;
    // The Kostenübernehmer has its own role and signature frame (`payer`).
    Ok(recipient
        .as_ref()
        .and_then(contact_signer)
        .map(|signer| Signer {
            role: "payer".into(),
            ..signer
        }))
}

// Called only after checking this document's send permissions. Document access
// alone does not grant access to the linked patient's contact details.
pub(super) async fn suggested(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
    policy: SignerPolicy,
) -> Result<Vec<Signer>, Response> {
    let mut clients = vec![empty("client")];
    let patient_id: Option<Uuid> = source.get("patient_id");
    let lead_id: Option<Uuid> = source.get("lead_id");
    let row = match (patient_id, lead_id) {
        // These roles can read unmasked profile fields. IT administrators can
        // configure signatures, but profile field policies may hide contacts.
        (Some(id), None)
            if matches!(auth.role, Role::Ceo | Role::PatientManager)
                && patients::has_patient_access(state, auth, id).await? => {
            sqlx::query(r#"SELECT p.first_name, p.last_name, p.email, p.birth_date,
                        COALESCE(
                          CASE WHEN jsonb_typeof(p.intake_profile->'trusted_contacts') = 'array'
                            THEN p.intake_profile->'trusted_contacts' ELSE '[]'::jsonb END,
                          '[]'::jsonb
                        ) || COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                            'name', COALESCE(NULLIF(btrim(concat_ws(' ', rp.first_name, rp.last_name)), ''), pr.related_name),
                            'email', COALESCE(NULLIF(btrim(pr.email), ''), rp.email),
                            'relation', pr.relation_type
                          ))
                          FROM patient_relations pr
                          LEFT JOIN patients rp ON rp.id = pr.related_patient_id
                          WHERE pr.patient_id = p.id AND pr.relation_type IN ('parent', 'mother', 'father', 'guardian')
                        ), '[]'::jsonb) AS guardian_contacts
                      FROM patients p WHERE p.id=$1 AND p.is_active=true"#)
                .bind(id).fetch_optional(&state.db).await.map_err(db_error)?
        }
        // Callers already passed the CEO/PM document check (Sales and Concierge
        // never reach this point).
        (None, Some(id)) if matches!(auth.role, Role::Ceo | Role::PatientManager) => {
            sqlx::query("SELECT first_name,last_name,email,date_of_birth AS birth_date,COALESCE(trusted_contacts,'[]'::jsonb) AS guardian_contacts FROM leads WHERE id=$1 AND qualification_status<>'archived'")
                .bind(id).fetch_optional(&state.db).await.map_err(db_error)?
        }
        _ => None,
    };
    if let Some(row) = row {
        let birth_date = row.get::<Option<NaiveDate>, _>("birth_date");
        if is_minor(birth_date) {
            // The representatives who contract for the child sign (owner
            // decision 2026-10-19): the recorded parents only for old
            // patients nobody resolved.
            let template = source
                .try_get::<Option<String>, _>("generated_template_id")
                .unwrap_or_default();
            let guardians = match contracting_signers(
                state,
                patient_id,
                lead_id,
                source
                    .try_get::<Option<Uuid>, _>("order_id")
                    .unwrap_or_default(),
                template.as_deref(),
            )
            .await?
            {
                Some(signers) => signers,
                None => guardian_signers(&row.get::<Value, _>("guardian_contacts")),
            };
            if !guardians.is_empty() {
                clients = guardians;
            }
        } else {
            // An adult under rechtliche Betreuung: the Betreuer acts and
            // signs in the adult's name (owner decision 2026-10-25, DEV QA
            // F-G1), as the contracts and the adult's forms print them.
            let betreuer = {
                let mut conn = state.db.acquire().await.map_err(db_error)?;
                crate::routes::documents::adult_betreuer(
                    &mut conn,
                    patient_id,
                    lead_id,
                    source
                        .try_get::<Option<Uuid>, _>("order_id")
                        .unwrap_or_default(),
                    crate::app_time::today(),
                )
                .await
                .map_err(db_error)?
            };
            let betreuer = patient_contracting_signers(&betreuer);
            if betreuer.is_empty() {
                let client = &mut clients[0];
                client.first_name = row.get("first_name");
                client.last_name = row.get("last_name");
                client.email = row.get::<Option<String>, _>("email").unwrap_or_default();
            } else {
                clients = betreuer;
            }
        }
    }
    // The consent form declares the choice of the person who made it in the
    // cabinet: that parent or guardian signs first (the form names them
    // first, QA 2026-10-12 A2-06), and must sign (`create_request`).
    if let Some(choice) = crate::consent_choices::OwnConsentChoice::from_bindings(
        source
            .try_get::<Option<Value>, _>("generated_bindings")
            .ok()
            .flatten()
            .as_ref(),
    ) && let Some(position) = clients.iter().position(|signer| {
        choice
            .chosen_by_emails
            .contains(&signer.email.trim().to_lowercase())
    }) {
        let chooser = clients.remove(position);
        clients.insert(0, chooser);
    }
    // The Kostenübernehmer signs the cost coverage declaration, in its own
    // `payer` role. Only for roles that may read the patient's payer data
    // (same as above).
    let mut payer = None;
    if let Some(id) = patient_id
        && matches!(auth.role, Role::Ceo | Role::PatientManager)
        && patients::has_patient_access(state, auth, id).await?
    {
        payer = order_payer_signer(state, source).await?;
    } else if patient_id.is_none()
        && lead_id.is_some()
        && matches!(auth.role, Role::Ceo | Role::PatientManager)
    {
        payer = order_payer_signer(state, source).await?;
    }
    let mut signers = match policy {
        SignerPolicy::AgencyOnly => Vec::new(),
        // The payer's own documents: never the patient side.
        SignerPolicy::PayerAndAgency | SignerPolicy::PayerPackage => {
            vec![payer.unwrap_or_else(|| empty("payer"))]
        }
        SignerPolicy::ClientPayerAndAgency => {
            clients.extend(payer);
            clients
        }
        _ => clients,
    };
    if policy == SignerPolicy::ClientOnly {
        return Ok(signers);
    }
    let agency = load(state).await?;
    if agency.is_empty() {
        signers.push(empty("agency"));
    } else {
        signers.extend(agency);
    }
    Ok(signers)
}

/// The signers a package suggests: the union of every document's suggestion
/// (`suggested`), deduplicated by e-mail, the first document's signers first
/// (owner rule map 94 follow-up 2026-10-25). A minor's contract names only the
/// paying parent, the child's consents both custody parents: a package with
/// both suggests both. The parent who contracts leads the client signers, so
/// the bundle gives the contract's `client` frame to that parent and the other
/// parent only the `guardian_N` frames of the documents they sign
/// (`package::visual_positions`).
pub(super) async fn suggested_for_package(
    state: &AppState,
    auth: &AuthUser,
    rows: &[&PgRow],
    policy: SignerPolicy,
) -> Result<Vec<Signer>, Response> {
    let mut merged: Vec<Signer> = Vec::new();
    let mut contracting: Vec<String> = Vec::new();
    for row in rows {
        let template = row
            .try_get::<Option<String>, _>("generated_template_id")
            .unwrap_or_default();
        let contract = paying_parent_signs_alone(template.as_deref());
        for signer in suggested(state, auth, row, policy).await? {
            let email = normalized_email(&signer.email);
            if contract && signer.role == "client" && !email.is_empty() {
                contracting.push(email);
            }
            merge_signer(&mut merged, signer);
        }
    }
    lead_with_contracting_clients(&mut merged, &contracting);
    Ok(merged)
}

fn normalized_email(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Adds one document's suggested signer to the package's list: a known e-mail
/// is skipped, a named signer fills an empty placeholder of its role, a new
/// signer joins after the last one of its role (the agency stays last).
fn merge_signer(merged: &mut Vec<Signer>, signer: Signer) {
    let email = normalized_email(&signer.email);
    if email.is_empty() {
        if !merged.iter().any(|known| known.role == signer.role) {
            let at = insertion_point(merged, &signer.role);
            merged.insert(at, signer);
        }
        return;
    }
    if merged
        .iter()
        .any(|known| normalized_email(&known.email) == email)
    {
        return;
    }
    if let Some(placeholder) = merged
        .iter_mut()
        .find(|known| known.role == signer.role && known.email.trim().is_empty())
    {
        *placeholder = signer;
        return;
    }
    let at = insertion_point(merged, &signer.role);
    merged.insert(at, signer);
}

fn insertion_point(merged: &[Signer], role: &str) -> usize {
    if let Some(last) = merged.iter().rposition(|known| known.role == role) {
        return last + 1;
    }
    if role != "agency"
        && let Some(agency) = merged.iter().position(|known| known.role == "agency")
    {
        return agency;
    }
    merged.len()
}

/// Moves the client signers who sign a contract document ahead of the other
/// client signers, keeping every other position and order.
fn lead_with_contracting_clients(merged: &mut [Signer], contracting: &[String]) {
    if contracting.is_empty() {
        return;
    }
    let positions: Vec<usize> = merged
        .iter()
        .enumerate()
        .filter(|(_, signer)| signer.role == "client")
        .map(|(index, _)| index)
        .collect();
    let mut clients: Vec<Signer> = positions.iter().map(|&i| merged[i].clone()).collect();
    clients.sort_by_key(|signer| !contracting.contains(&normalized_email(&signer.email)));
    for (index, signer) in positions.into_iter().zip(clients) {
        merged[index] = signer;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_allow_clearing_but_never_a_global_client_or_duplicate_recipient() {
        assert!(normalize_defaults(vec![]).unwrap().is_empty());
        let agency = Signer {
            first_name: " Max ".into(),
            last_name: " Muster ".into(),
            email: " MAX@EXAMPLE.ORG ".into(),
            role: "agency".into(),
            positions: Vec::new(),
        };
        assert_eq!(
            normalize_defaults(vec![agency.clone()]).unwrap()[0].email,
            "max@example.org"
        );
        assert!(normalize_defaults(vec![agency.clone(), agency.clone()]).is_err());
        assert!(normalize_defaults(vec![agency.clone(); 6]).is_err());
        assert!(
            normalize_defaults(vec![Signer {
                role: "client".into(),
                positions: Vec::new(),
                ..agency
            }])
            .is_err()
        );
    }

    #[test]
    fn guardian_is_used_as_the_minor_document_signer() {
        let signer = guardian_signer(&json!([{
            "name": "Anna Beispiel",
            "email": "ANNA@example.org",
            "relation": "parent"
        }]))
        .unwrap();
        assert_eq!(signer.first_name, "Anna");
        assert_eq!(signer.last_name, "Beispiel");
        assert_eq!(signer.email, "anna@example.org");
        assert_eq!(signer.role, "client");
    }

    fn lead_parent(
        slot: Option<&'static str>,
        first: &str,
        email: Option<&str>,
    ) -> crate::routes::lead_representatives::Representative {
        crate::routes::lead_representatives::Representative {
            id: Uuid::new_v4(),
            slot,
            role: "legal_representative",
            relation: Some("parent".into()),
            first_name: first.into(),
            last_name: "Muster".into(),
            date_of_birth: None,
            email: email.map(str::to_string),
            phone: None,
            login_user_ids: Vec::new(),
            has_data: true,
            extras: Default::default(),
        }
    }

    #[test]
    fn a_minor_leads_signers_follow_the_custody() {
        use crate::routes::lead_representatives::Representation;
        // Joint custody: both places sign.
        let joint = Representation {
            minor: true,
            answers: Default::default(),
            representatives: vec![
                lead_parent(Some("rep1"), "Ioann", Some("IOANN@example.org")),
                lead_parent(Some("rep2"), "Maria", Some("maria@example.org")),
            ],
        };
        let emails = |signers: Vec<Signer>| {
            signers
                .into_iter()
                .map(|signer| signer.email)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            emails(lead_contracting_signers(&joint)),
            vec!["ioann@example.org", "maria@example.org"]
        );
        // Sole custody: the second parent on file has no place and does not sign.
        let sole = Representation {
            representatives: vec![
                lead_parent(Some("rep1"), "Ioann", Some("ioann@example.org")),
                lead_parent(None, "Maria", Some("maria@example.org")),
            ],
            ..joint.clone()
        };
        assert_eq!(
            emails(lead_contracting_signers(&sole)),
            vec!["ioann@example.org"]
        );
        // Without an e-mail address nobody can be invited.
        let no_email = Representation {
            representatives: vec![lead_parent(Some("rep1"), "Ioann", None)],
            ..joint.clone()
        };
        assert!(lead_contracting_signers(&no_email).is_empty());
        // The contract documents: the paying parent signs alone (map 94); the
        // consents and every document of another kind keep both.
        let maria = joint.representatives[1].id;
        let contract_only = Representation {
            representatives: crate::routes::documents::only_paying_parent(
                joint.representatives.clone(),
                Some(maria),
                |person| Some(person.id),
            ),
            ..joint.clone()
        };
        assert_eq!(
            emails(lead_contracting_signers(&contract_only)),
            vec!["maria@example.org"]
        );
        assert!(paying_parent_signs_alone(Some("framework_contract")));
        assert!(paying_parent_signs_alone(Some("single_order")));
        assert!(!paying_parent_signs_alone(Some("privacy_consents")));
        assert!(!paying_parent_signs_alone(None));
    }

    #[test]
    fn a_package_suggests_the_union_of_its_documents_signers() {
        let signer = |email: &str, role: &str| Signer {
            first_name: String::new(),
            last_name: String::new(),
            email: email.into(),
            role: role.into(),
            positions: Vec::new(),
        };
        // Started from the consent: both parents, the father chose first.
        let mut merged = Vec::new();
        for s in [
            signer("bernd@example.org", "client"),
            signer("anna@example.org", "client"),
            signer("", "agency"),
        ] {
            merge_signer(&mut merged, s);
        }
        // The contract: the paying mother alone; the agency is now named.
        for s in [
            signer("Anna@Example.org ", "client"),
            signer("max@example.org", "agency"),
        ] {
            merge_signer(&mut merged, s);
        }
        // A cost coverage declaration adds its payer before the agency.
        merge_signer(&mut merged, signer("payer@example.org", "payer"));
        lead_with_contracting_clients(&mut merged, &["anna@example.org".into()]);
        let listed: Vec<(&str, &str)> = merged
            .iter()
            .map(|s| (s.email.as_str(), s.role.as_str()))
            .collect();
        assert_eq!(
            listed,
            [
                ("anna@example.org", "client"),
                ("bernd@example.org", "client"),
                ("payer@example.org", "payer"),
                ("max@example.org", "agency"),
            ]
        );
    }

    #[test]
    fn a_minor_patients_signers_are_the_stored_contracting_parents() {
        use crate::services::contracting_party::Representative;
        let signers = patient_contracting_signers(&[
            Representative {
                name: "Ioann Muster".into(),
                first_name: Some("Ioann".into()),
                last_name: Some("Muster".into()),
                email: Some("Ioann@example.org".into()),
                ..Default::default()
            },
            Representative {
                name: "Maria von Muster".into(),
                email: Some("maria@example.org".into()),
                ..Default::default()
            },
            Representative {
                name: "Ohne Adresse".into(),
                ..Default::default()
            },
        ]);
        assert_eq!(signers.len(), 2);
        assert_eq!(signers[0].first_name, "Ioann");
        assert_eq!(signers[0].email, "ioann@example.org");
        assert_eq!(signers[1].first_name, "Maria von");
        assert_eq!(signers[1].last_name, "Muster");
        assert!(signers.iter().all(|signer| signer.role == "client"));
    }

    #[test]
    fn both_guardians_are_suggested_under_joint_custody() {
        let signers = guardian_signers(&json!([
            { "name": "Anna Beispiel", "email": "anna@example.org", "relation": "parent" },
            { "name": "Oma Beispiel", "email": "oma@example.org", "relation": "relative" },
            { "name": "Ben Beispiel", "email": "ben@example.org", "relation": "guardian" },
            { "name": "Anna Beispiel", "email": "ANNA@example.org", "relation": "mother" }
        ]));
        assert_eq!(
            signers
                .iter()
                .map(|signer| signer.email.as_str())
                .collect::<Vec<_>>(),
            vec!["anna@example.org", "ben@example.org"]
        );
        assert!(signers.iter().all(|signer| signer.role == "client"));
    }
}
