//! The payer's own link (owner spec "Patientenformular (Lead-Link)", section
//! 10, phase 3a, 2026-10-06).
//!
//! A third-party payer states itself what the GwG asks of it — identity,
//! identity document, relationship to the patient, source of the funds, the
//! payment route (section 8) and the legal questions — through a one-time link
//! without an account:
//!
//! 1. Staff send the link (`POST /leads/{id}/payer-link`, `leads.edit`) once
//!    the lead sent the request, named a third party and agreed that GMED
//!    contacts it. The invitation carries the short Art. 14 DSGVO notice and
//!    records that the payer was informed. One active link per lead; a resend
//!    revokes the previous one; the link works 30 days.
//! 2. The page reads the token from the URL fragment and sends it in the
//!    header `X-Payer-Link`. Opening shows the patient's name and the masked
//!    address only; a six-digit code mailed to the link's address yields a
//!    session secret (header `X-Payer-Session`, 60 minutes, renewed by every
//!    call). Only SHA-256 hashes of token, code and session are stored, no
//!    route takes them in a path or query, and none of them is logged.
//!    Wrong codes are counted in the database (5 per code, 10 per link lock
//!    it); opening, sending and checking codes sit behind a tight per-IP
//!    limiter of their own (`lib.rs`).
//! 3. The payer acknowledges the privacy notice, answers (stored in
//!    `lead_payer_statements`; the declaration is untouched while the payer
//!    drafts, reads show the statement's value or else the declaration's),
//!    uploads its identity document and — at check level 2 — the proof of
//!    funds, and submits: the answers are completed and frozen, and the
//!    payer's identity is adopted into the declaration.
//!
//! A paying parent with a cabinet login gets no link: the same questions are
//! a section of that parent's cabinet (`/me/lead-requests/{id}/payer-
//! questionnaire`), with the person and identity data of the parent's
//! representative row and the payment route of the cabinet's billing section.
//!
//! The payer sees the patient's name and its own data only — no lead id,
//! nothing medical, no staff names, neither the check reasons nor the
//! expected total. A change of the payer revokes the link and clears the
//! answers ([`payer_changed_in_tx`]); conversion revokes the link and keeps
//! the statement; the purge of an unconverted lead deletes both. Every payer
//! write is audited in its transaction (field names, never values or
//! secrets) and published as `lead.portal_updated` with `change =
//! "payer_link"`. See docs/architecture/lead-payer-declaration_ua.md and
//! lead-patient-portal_ua.md.

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, SubsecRound, Utc};
use rand::RngExt;
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::tokens::hash_token;
use crate::mail::connection::current_mailer;
use crate::mail::templates::{self, MailLanguage, PayerCodeEmail, PayerInvitationEmail};
use crate::mail::{MailError, OutgoingEmail, error_response};
use crate::routes::documents::{MAX_FILE_SIZE, NewStoredDocument, persist_document_file};
use crate::routes::invoices::payer::is_plausible_email;
use crate::routes::lead_enhanced_check::{self, EnhancedCheck};
use crate::routes::lead_payer::{
    self, Declaration, PaymentRouteBy, PortalBillingError, PortalBillingPatch,
};
use crate::routes::lead_portal_intake::{
    self as intake, FieldError, PORTAL_LEAD_SQL, UploadKind, coded, field_error,
};
use crate::routes::lead_representatives::{self, Representative};
use crate::services::citizenships::{normalize_citizenships, normalize_country_code};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// Header of the link token (64 hex characters from the URL fragment).
pub const HEADER_LINK: &str = "x-payer-link";
/// Header of the session secret a verified code yields.
pub const HEADER_SESSION: &str = "x-payer-session";

/// Random bytes of a token and of a session secret (hex: twice as many
/// characters).
const SECRET_BYTES: usize = 32;
/// Owner defaults (contract 8.1): link 30 days, code 15 minutes, session 60
/// minutes idle, 60 seconds between codes, at most five codes an hour.
const LINK_VALID_DAYS: i64 = 30;
const CODE_VALID_MINUTES: i64 = 15;
const SESSION_IDLE_MINUTES: i64 = 60;
const CODE_RESEND_SECONDS: i64 = 60;
const CODES_PER_HOUR: usize = 5;
/// Wrong tries of one code before it is void, and of all codes before the
/// link is locked for good.
const CODE_ATTEMPTS: i32 = 5;
const LOCK_AFTER_FAILED: i32 = 10;
/// Version of the privacy notice the payer acknowledges.
pub(crate) const PRIVACY_TEXT_VERSION: &str = "payer-privacy-2026-10-06";
/// Active payer uploads per lead.
const MAX_PAYER_UPLOADS: usize = 10;
const MAX_BENEFICIAL_OWNERS: usize = 10;
/// `numeric(12, 2)`: at most 9 999 999 999.99.
const MAX_TOTAL_CENTS: i64 = 999_999_999_999;
/// 100 %, in hundredths.
const FULL_SHARE: i64 = 10_000;

const LANGUAGES: [&str; 4] = ["de", "en", "ru", "uk"];
const SALUTATIONS: [&str; 3] = ["mr", "ms", "none"];
const CONTACT_CHANNELS: [&str; 3] = ["email", "phone", "messenger"];
const STATEMENT_TEXT_MAX: usize = 2000;

/// What the payer answers (API keys = columns of `lead_payer_statements`), in
/// column order.
const ANSWER_KEYS: [&str; 46] = [
    "salutation",
    "first_name",
    "last_name",
    "former_names",
    "date_of_birth",
    "birth_place",
    "birth_country",
    "citizenships",
    "street",
    "city",
    "zip",
    "country",
    "habitual_residence_country",
    "phone",
    "language",
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_issued_on",
    "id_valid_until",
    "organisation_name",
    "register_court",
    "register_number",
    "representative_first_name",
    "representative_last_name",
    "representative_role",
    "beneficial_owners",
    "beneficial_owners_none",
    "relationship_kind",
    "relationship",
    "occupation",
    "industry",
    "funds_sources",
    "funds_description",
    "pep_self",
    "pep_self_details",
    "pep_related",
    "pep_related_details",
    "high_risk_country",
    "high_risk_country_code",
    "sanctions_links",
    "sanctions_links_details",
    "legal_form",
    "vat_id",
    "payment_reason",
];

/// Keys only a natural person answers.
const PERSON_KEYS: [&str; 10] = [
    "salutation",
    "first_name",
    "last_name",
    "former_names",
    "date_of_birth",
    "birth_place",
    "birth_country",
    "citizenships",
    "habitual_residence_country",
    "occupation",
];

/// Keys only a company, an organisation or an insurer answers.
const ORGANISATION_KEYS: [&str; 12] = [
    "organisation_name",
    "legal_form",
    "vat_id",
    "payment_reason",
    "register_court",
    "register_number",
    "representative_first_name",
    "representative_last_name",
    "representative_role",
    "beneficial_owners",
    "beneficial_owners_none",
    "industry",
];

/// What a paying parent answers in the cabinet section; the person and the
/// identity document are the representative's (edited there), the payment
/// route is the billing section's.
const CABINET_KEYS: [&str; 15] = [
    "salutation",
    "former_names",
    "habitual_residence_country",
    "language",
    "occupation",
    "funds_sources",
    "funds_description",
    "pep_self",
    "pep_self_details",
    "pep_related",
    "pep_related_details",
    "high_risk_country",
    "high_risk_country_code",
    "sanctions_links",
    "sanctions_links_details",
];

/// Section 8 of the form, written to the declaration.
const PAYMENT_ROUTE_KEYS: [&str; 7] = [
    "payment_method",
    "payment_method_details",
    "account_country",
    "account_holder",
    "bank_name",
    "via_third_party",
    "via_third_party_details",
];

/// The fields of one beneficial owner.
const OWNER_KEYS: [&str; 9] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "birth_place",
    "street",
    "zip",
    "city",
    "country",
    "share_percent",
];

/// Sources of funds of a company, an organisation or an insurer (QA
/// 2026-10-06, C7-b), in form order; a person chooses from the declaration's
/// list ([`lead_payer::SOURCE_OF_FUNDS`]). The questionnaire shows the list of
/// its payer type as `funds_source_options`.
const ORGANISATION_FUNDS_SOURCES: [&str; 6] = [
    "business_revenue",
    "equity",
    "loan",
    "insurance_benefit",
    "donation",
    "other",
];

/// The sources of funds the payer type chooses from, in form order.
fn funds_source_options(organisation: bool) -> &'static [&'static str] {
    if organisation {
        &ORGANISATION_FUNDS_SOURCES
    } else {
        lead_payer::SOURCE_OF_FUNDS
    }
}

// ----------------------------------------------------------------------------
// Routers
// ----------------------------------------------------------------------------

/// Opening the link, sending a code, checking it (behind the tight limiter).
pub fn public_tight_router() -> Router<AppState> {
    Router::new()
        .route("/public/payer-link", get(open_link))
        .route("/public/payer-link/code", post(send_code))
        .route("/public/payer-link/verify", post(verify_code))
        .layer(middleware::from_fn(payer_link_guard))
}

/// The questionnaire under a verified session (behind the general limiter).
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route(
            "/public/payer-link/questionnaire",
            get(get_questionnaire).post(patch_questionnaire),
        )
        .route("/public/payer-link/consent", post(give_consent))
        .route(
            "/public/payer-link/identity-document",
            post(upload_identity_document)
                .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        .route(
            "/public/payer-link/funds-proof",
            post(upload_funds_proof).layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        .route(
            "/public/payer-link/documents/{document_id}",
            delete(withdraw_upload),
        )
        .route("/public/payer-link/submit", post(submit))
        .layer(middleware::from_fn(payer_link_guard))
}

/// Staff (send, revoke, the expected total, the answers) and the paying
/// parent's section of the lead cabinet.
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/leads/{lead_id}/payer-link",
            get(staff_get).post(staff_send),
        )
        .route("/leads/{lead_id}/payer-link/revoke", post(staff_revoke))
        .route(
            "/leads/{lead_id}/payer-link/estimated-total",
            post(staff_estimated_total),
        )
        .route(
            "/me/lead-requests/{lead_id}/payer-questionnaire",
            get(cabinet_get).post(cabinet_patch),
        )
        .route(
            "/me/lead-requests/{lead_id}/payer-questionnaire/consent",
            post(cabinet_consent),
        )
        .route(
            "/me/lead-requests/{lead_id}/payer-questionnaire/funds-proof",
            post(cabinet_funds_proof).layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        .route(
            "/me/lead-requests/{lead_id}/payer-questionnaire/submit",
            post(cabinet_submit),
        )
}

/// The token and the session travel only in headers: a payer route asked
/// with a query string answers like an unknown route, so a link with the
/// token in its query never works. Answers are never cached.
async fn payer_link_guard(request: axum::extract::Request, next: middleware::Next) -> Response {
    if request.uri().query().is_some() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "not_found", "message": "API route not found" })),
        )
            .into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

// ----------------------------------------------------------------------------
// Secrets
// ----------------------------------------------------------------------------

/// 32 random bytes from the thread's CSPRNG, hex (as the refresh tokens).
fn new_secret() -> String {
    let mut bytes = [0u8; SECRET_BYTES];
    rand::rng().fill(&mut bytes);
    hex::encode(bytes)
}

/// Six random digits.
fn new_code() -> String {
    format!("{:06}", rand::rng().random_range(0..1_000_000u32))
}

/// A token or a session as issued: 64 lower-case hex characters.
fn is_secret(value: &str) -> bool {
    value.len() == SECRET_BYTES * 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// The stored hash of a code: bound to its link.
fn code_hash(link_id: Uuid, code: &str) -> String {
    hash_token(&format!("{link_id}:{code}"))
}

/// Compares two hashes without stopping at the first difference.
fn same_hash(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

/// The client IP as the login derives it (first `X-Forwarded-For` entry,
/// else `X-Real-IP`), only when it is an IP address.
fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(',').next().unwrap_or(value).trim())
        .filter(|ip| ip.parse::<std::net::IpAddr>().is_ok())
        .map(str::to_string)
}

fn normalized_email(value: Option<&str>) -> Option<String> {
    value
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

/// `v***r@example.com`: first and last character of the local part.
fn mask_email(email: &str) -> String {
    let email = email.trim();
    let Some((local, domain)) = email.rsplit_once('@') else {
        return "***".to_string();
    };
    let characters = local.chars().collect::<Vec<_>>();
    let masked = match characters.as_slice() {
        [] => "***".to_string(),
        [only] => format!("{only}***"),
        [first, .., last] => format!("{first}***{last}"),
    };
    format!("{masked}@{domain}")
}

// ----------------------------------------------------------------------------
// Amounts
// ----------------------------------------------------------------------------

/// Hundredths of a decimal with at most two decimals (`.` or `,`), at most
/// `max`; `None` for anything else.
fn parse_cents(text: &str, max: i64) -> Option<i64> {
    let text = text.trim().replace(',', ".");
    let (whole, fraction) = text.split_once('.').unwrap_or((text.as_str(), ""));
    if whole.is_empty()
        || whole.len() > 12
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let whole: i64 = whole.parse().ok()?;
    let fraction: i64 = format!("{fraction:0<2}").parse().ok()?;
    let cents = whole.checked_mul(100)?.checked_add(fraction)?;
    (cents <= max).then_some(cents)
}

/// A JSON number or numeric text as hundredths.
fn cents_of(value: &Value, max: i64) -> Option<i64> {
    match value {
        Value::Number(number) => parse_cents(&number.to_string(), max),
        Value::String(text) => parse_cents(text, max),
        _ => None,
    }
}

fn cents_text(cents: i64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

fn share_value(cents: i64) -> Value {
    serde_json::Number::from_f64(cents as f64 / 100.0)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn date_text(date: Option<NaiveDate>) -> Option<String> {
    date.map(|date| date.format("%Y-%m-%d").to_string())
}

// ----------------------------------------------------------------------------
// The payer's answers
// ----------------------------------------------------------------------------

/// One beneficial owner of a company.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Owner {
    first_name: String,
    last_name: String,
    date_of_birth: Option<NaiveDate>,
    birth_place: Option<String>,
    street: Option<String>,
    zip: Option<String>,
    city: Option<String>,
    country: Option<String>,
    /// Share in hundredths of a percent.
    share_cents: i64,
}

impl Owner {
    fn to_json(&self) -> Value {
        json!({
            "first_name": self.first_name,
            "last_name": self.last_name,
            "date_of_birth": date_text(self.date_of_birth),
            "birth_place": self.birth_place,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "share_percent": share_value(self.share_cents),
        })
    }

    /// An owner as stored (written by [`owners_of`]).
    fn from_stored(value: &Value) -> Option<Self> {
        let text = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        Some(Owner {
            first_name: text("first_name")?,
            last_name: text("last_name")?,
            date_of_birth: text("date_of_birth")
                .and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok()),
            birth_place: text("birth_place"),
            street: text("street"),
            zip: text("zip"),
            city: text("city"),
            country: text("country"),
            share_cents: value
                .get("share_percent")
                .and_then(|share| cents_of(share, FULL_SHARE))
                .unwrap_or(0),
        })
    }
}

/// What the payer states about itself (section 10 of the form), as stored or
/// — completed from the declaration or the representative — as effective.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Answers {
    salutation: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    former_names: Option<String>,
    date_of_birth: Option<NaiveDate>,
    birth_place: Option<String>,
    birth_country: Option<String>,
    citizenships: Vec<String>,
    street: Option<String>,
    city: Option<String>,
    zip: Option<String>,
    country: Option<String>,
    habitual_residence_country: Option<String>,
    phone: Option<String>,
    language: Option<String>,
    id_document_type: Option<String>,
    id_document_number: Option<String>,
    id_issuing_authority: Option<String>,
    id_issuing_country: Option<String>,
    id_issued_on: Option<NaiveDate>,
    id_valid_until: Option<NaiveDate>,
    organisation_name: Option<String>,
    register_court: Option<String>,
    register_number: Option<String>,
    representative_first_name: Option<String>,
    representative_last_name: Option<String>,
    representative_role: Option<String>,
    beneficial_owners: Vec<Owner>,
    beneficial_owners_none: Option<bool>,
    relationship_kind: Option<String>,
    relationship: Option<String>,
    occupation: Option<String>,
    industry: Option<String>,
    funds_sources: Vec<String>,
    funds_description: Option<String>,
    pep_self: Option<bool>,
    pep_self_details: Option<String>,
    pep_related: Option<bool>,
    pep_related_details: Option<String>,
    high_risk_country: Option<bool>,
    high_risk_country_code: Option<String>,
    sanctions_links: Option<bool>,
    sanctions_links_details: Option<String>,
    /// Block E of the risk assessment (an organisation): legal form, VAT id
    /// and why the organisation pays.
    legal_form: Option<String>,
    vat_id: Option<String>,
    payment_reason: Option<String>,
}

impl Answers {
    /// The value of one answer key as the API shows it.
    fn value(&self, key: &str) -> Value {
        match key {
            "salutation" => json!(self.salutation),
            "first_name" => json!(self.first_name),
            "last_name" => json!(self.last_name),
            "former_names" => json!(self.former_names),
            "date_of_birth" => json!(date_text(self.date_of_birth)),
            "birth_place" => json!(self.birth_place),
            "birth_country" => json!(self.birth_country),
            "citizenships" => json!(self.citizenships),
            "street" => json!(self.street),
            "city" => json!(self.city),
            "zip" => json!(self.zip),
            "country" => json!(self.country),
            "habitual_residence_country" => json!(self.habitual_residence_country),
            "phone" => json!(self.phone),
            "language" => json!(self.language),
            "id_document_type" => json!(self.id_document_type),
            "id_document_number" => json!(self.id_document_number),
            "id_issuing_authority" => json!(self.id_issuing_authority),
            "id_issuing_country" => json!(self.id_issuing_country),
            "id_issued_on" => json!(date_text(self.id_issued_on)),
            "id_valid_until" => json!(date_text(self.id_valid_until)),
            "organisation_name" => json!(self.organisation_name),
            "register_court" => json!(self.register_court),
            "register_number" => json!(self.register_number),
            "representative_first_name" => json!(self.representative_first_name),
            "representative_last_name" => json!(self.representative_last_name),
            "representative_role" => json!(self.representative_role),
            "beneficial_owners" => {
                Value::Array(self.beneficial_owners.iter().map(Owner::to_json).collect())
            }
            "beneficial_owners_none" => json!(self.beneficial_owners_none),
            "relationship_kind" => json!(self.relationship_kind),
            "relationship" => json!(self.relationship),
            "occupation" => json!(self.occupation),
            "industry" => json!(self.industry),
            "funds_sources" => json!(self.funds_sources),
            "funds_description" => json!(self.funds_description),
            "pep_self" => json!(self.pep_self),
            "pep_self_details" => json!(self.pep_self_details),
            "pep_related" => json!(self.pep_related),
            "pep_related_details" => json!(self.pep_related_details),
            "high_risk_country" => json!(self.high_risk_country),
            "high_risk_country_code" => json!(self.high_risk_country_code),
            "sanctions_links" => json!(self.sanctions_links),
            "sanctions_links_details" => json!(self.sanctions_links_details),
            "legal_form" => json!(self.legal_form),
            "vat_id" => json!(self.vat_id),
            "payment_reason" => json!(self.payment_reason),
            _ => Value::Null,
        }
    }

    /// Every answer key; the keys of the other payer type are `null`.
    fn to_json(&self, organisation: bool) -> Value {
        Value::Object(
            ANSWER_KEYS
                .iter()
                .map(|key| {
                    let value = if applies(key, organisation) {
                        self.value(key)
                    } else {
                        Value::Null
                    };
                    (key.to_string(), value)
                })
                .collect(),
        )
    }

    /// The payer's name: the organisation, or first and last name.
    fn display_name(&self, organisation: bool) -> Option<String> {
        let name = if organisation {
            self.organisation_name.clone().unwrap_or_default()
        } else {
            [self.first_name.as_deref(), self.last_name.as_deref()]
                .into_iter()
                .flatten()
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        };
        let name = name.trim().to_string();
        (!name.is_empty()).then_some(name)
    }
}

/// Whether an answer key belongs to the payer type.
fn applies(key: &str, organisation: bool) -> bool {
    if organisation {
        !PERSON_KEYS.contains(&key)
    } else {
        !ORGANISATION_KEYS.contains(&key)
    }
}

/// The row of `lead_payer_statements`.
#[derive(Clone, Debug, Default)]
struct Statement {
    link_id: Option<Uuid>,
    privacy_ack_at: Option<DateTime<Utc>>,
    privacy_text_version: Option<String>,
    privacy_ip: Option<String>,
    contact_channels: Vec<String>,
    confirmed_email: Option<String>,
    email_confirmed_at: Option<DateTime<Utc>>,
    answers: Answers,
    estimated_total_cents: Option<i64>,
    declared_correct_at: Option<DateTime<Utc>>,
    submitted_at: Option<DateTime<Utc>>,
    adopted_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
}

const STATEMENT_COLUMNS: &str = "link_id, privacy_ack_at, privacy_text_version, privacy_ip, \
     contact_channels, confirmed_email, email_confirmed_at, salutation, first_name, last_name, \
     former_names, date_of_birth, birth_place, birth_country, citizenships, street, city, zip, \
     country, habitual_residence_country, phone, language, id_document_type, id_document_number, \
     id_issuing_authority, id_issuing_country, id_issued_on, id_valid_until, organisation_name, \
     register_court, register_number, representative_first_name, representative_last_name, \
     representative_role, beneficial_owners, beneficial_owners_none, relationship_kind, \
     relationship, occupation, industry, funds_sources, funds_description, pep_self, \
     pep_self_details, pep_related, pep_related_details, high_risk_country, \
     high_risk_country_code, sanctions_links, sanctions_links_details, legal_form, vat_id, \
     payment_reason, estimated_total_eur::text AS estimated_total_eur, declared_correct_at, submitted_at, \
     adopted_at, updated_at";

impl Statement {
    fn from_row(row: &PgRow) -> Self {
        let text = |column: &str| {
            row.try_get::<Option<String>, _>(column)
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty())
        };
        let date = |column: &str| row.try_get::<Option<NaiveDate>, _>(column).ok().flatten();
        let time = |column: &str| {
            row.try_get::<Option<DateTime<Utc>>, _>(column)
                .ok()
                .flatten()
        };
        let answer = |column: &str| row.try_get::<Option<bool>, _>(column).ok().flatten();
        let list = |column: &str| row.try_get::<Vec<String>, _>(column).unwrap_or_default();
        let owners = row
            .try_get::<Value, _>("beneficial_owners")
            .ok()
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(Owner::from_stored)
            .collect();
        Statement {
            link_id: row.try_get("link_id").ok().flatten(),
            privacy_ack_at: time("privacy_ack_at"),
            privacy_text_version: text("privacy_text_version"),
            privacy_ip: text("privacy_ip"),
            contact_channels: list("contact_channels"),
            confirmed_email: text("confirmed_email"),
            email_confirmed_at: time("email_confirmed_at"),
            answers: Answers {
                salutation: text("salutation"),
                first_name: text("first_name"),
                last_name: text("last_name"),
                former_names: text("former_names"),
                date_of_birth: date("date_of_birth"),
                birth_place: text("birth_place"),
                birth_country: text("birth_country"),
                citizenships: list("citizenships"),
                street: text("street"),
                city: text("city"),
                zip: text("zip"),
                country: text("country"),
                habitual_residence_country: text("habitual_residence_country"),
                phone: text("phone"),
                language: text("language"),
                id_document_type: text("id_document_type"),
                id_document_number: text("id_document_number"),
                id_issuing_authority: text("id_issuing_authority"),
                id_issuing_country: text("id_issuing_country"),
                id_issued_on: date("id_issued_on"),
                id_valid_until: date("id_valid_until"),
                organisation_name: text("organisation_name"),
                register_court: text("register_court"),
                register_number: text("register_number"),
                representative_first_name: text("representative_first_name"),
                representative_last_name: text("representative_last_name"),
                representative_role: text("representative_role"),
                beneficial_owners: owners,
                beneficial_owners_none: answer("beneficial_owners_none"),
                relationship_kind: text("relationship_kind"),
                relationship: text("relationship"),
                occupation: text("occupation"),
                industry: text("industry"),
                funds_sources: list("funds_sources"),
                funds_description: text("funds_description"),
                pep_self: answer("pep_self"),
                pep_self_details: text("pep_self_details"),
                pep_related: answer("pep_related"),
                pep_related_details: text("pep_related_details"),
                high_risk_country: answer("high_risk_country"),
                high_risk_country_code: text("high_risk_country_code"),
                sanctions_links: answer("sanctions_links"),
                sanctions_links_details: text("sanctions_links_details"),
                legal_form: text("legal_form"),
                vat_id: text("vat_id"),
                payment_reason: text("payment_reason"),
            },
            estimated_total_cents: text("estimated_total_eur")
                .and_then(|value| parse_cents(&value, MAX_TOTAL_CENTS)),
            declared_correct_at: time("declared_correct_at"),
            submitted_at: time("submitted_at"),
            adopted_at: time("adopted_at"),
            updated_at: time("updated_at"),
        }
    }
}

async fn load_statement(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Statement>, sqlx::Error> {
    Ok(sqlx::query(&format!(
        "SELECT {STATEMENT_COLUMNS} FROM lead_payer_statements WHERE lead_id = $1"
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    .as_ref()
    .map(Statement::from_row))
}

/// Writes every answer of the statement row (the row exists).
async fn store_answers(
    conn: &mut PgConnection,
    lead_id: Uuid,
    answers: &Answers,
    answered_by: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let owners = Value::Array(
        answers
            .beneficial_owners
            .iter()
            .map(Owner::to_json)
            .collect(),
    );
    sqlx::query(
        r#"UPDATE lead_payer_statements SET
               salutation = $2, first_name = $3, last_name = $4, former_names = $5,
               date_of_birth = $6, birth_place = $7, birth_country = $8, citizenships = $9,
               street = $10, city = $11, zip = $12, country = $13,
               habitual_residence_country = $14, phone = $15, language = $16,
               id_document_type = $17, id_document_number = $18, id_issuing_authority = $19,
               id_issuing_country = $20, id_issued_on = $21, id_valid_until = $22,
               organisation_name = $23, register_court = $24, register_number = $25,
               representative_first_name = $26, representative_last_name = $27,
               representative_role = $28, beneficial_owners = $29,
               beneficial_owners_none = $30, relationship_kind = $31, relationship = $32,
               occupation = $33, industry = $34, funds_sources = $35, funds_description = $36,
               pep_self = $37, pep_self_details = $38, pep_related = $39,
               pep_related_details = $40, high_risk_country = $41,
               high_risk_country_code = $42, sanctions_links = $43,
               sanctions_links_details = $44, legal_form = $45, vat_id = $46,
               payment_reason = $47, answered_by_user = $48, updated_at = now()
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(&answers.salutation)
    .bind(&answers.first_name)
    .bind(&answers.last_name)
    .bind(&answers.former_names)
    .bind(answers.date_of_birth)
    .bind(&answers.birth_place)
    .bind(&answers.birth_country)
    .bind(&answers.citizenships)
    .bind(&answers.street)
    .bind(&answers.city)
    .bind(&answers.zip)
    .bind(&answers.country)
    .bind(&answers.habitual_residence_country)
    .bind(&answers.phone)
    .bind(&answers.language)
    .bind(&answers.id_document_type)
    .bind(&answers.id_document_number)
    .bind(&answers.id_issuing_authority)
    .bind(&answers.id_issuing_country)
    .bind(answers.id_issued_on)
    .bind(answers.id_valid_until)
    .bind(&answers.organisation_name)
    .bind(&answers.register_court)
    .bind(&answers.register_number)
    .bind(&answers.representative_first_name)
    .bind(&answers.representative_last_name)
    .bind(&answers.representative_role)
    .bind(owners)
    .bind(answers.beneficial_owners_none)
    .bind(&answers.relationship_kind)
    .bind(&answers.relationship)
    .bind(&answers.occupation)
    .bind(&answers.industry)
    .bind(&answers.funds_sources)
    .bind(&answers.funds_description)
    .bind(answers.pep_self)
    .bind(&answers.pep_self_details)
    .bind(answers.pep_related)
    .bind(&answers.pep_related_details)
    .bind(answers.high_risk_country)
    .bind(&answers.high_risk_country_code)
    .bind(answers.sanctions_links)
    .bind(&answers.sanctions_links_details)
    .bind(&answers.legal_form)
    .bind(&answers.vat_id)
    .bind(&answers.payment_reason)
    .bind(answered_by)
    .execute(&mut *conn)
    .await
    .map(|_| ())
}

// ----------------------------------------------------------------------------
// Effective values, check level and what is missing
// ----------------------------------------------------------------------------

/// `target` keeps its value; without one it takes `fallback` while that fits
/// the statement's limit (a longer declaration value is asked again).
fn fill(target: &mut Option<String>, fallback: Option<&String>, max: usize) {
    if target.is_none() {
        *target = fallback
            .filter(|value| !value.trim().is_empty() && value.chars().count() <= max)
            .cloned();
    }
}

/// The answers as the payer sees and submits them (D2): the statement's
/// value, otherwise — through the link — only the name, the payer type and
/// the relationship the lead entered in the declaration; for a paying parent
/// the person and the identity document are the representative's (phase
/// 1b-2), whatever the statement holds for them.
///
/// Data minimisation (QA 2026-10-06): the link never shows the payer what
/// the lead entered about it beyond the name — no date or place of birth, no
/// address, citizenship, phone or identity document. The payer states those
/// itself; whoever opens the link learns nothing the lead said about the
/// payer.
fn effective_answers(
    stored: &Answers,
    declaration: &Declaration,
    parent: Option<&Representative>,
) -> Answers {
    let mut answers = stored.clone();
    if let Some(parent) = parent {
        let extras = &parent.extras;
        let own = |value: &str| {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        };
        answers.first_name = own(&parent.first_name);
        answers.last_name = own(&parent.last_name);
        answers.date_of_birth = parent.date_of_birth.or(declaration.date_of_birth);
        answers.birth_place = extras.birth_place.clone();
        answers.birth_country = extras.birth_country.clone();
        answers.citizenships = if extras.citizenships.is_empty() {
            declaration.citizenships.clone()
        } else {
            extras.citizenships.clone()
        };
        answers.street = extras.street.clone();
        answers.zip = extras.zip.clone();
        answers.city = extras.city.clone();
        answers.country = extras.country.clone();
        answers.phone = parent.phone.clone();
        answers.id_document_type = extras.id_document_type.clone();
        answers.id_document_number = extras.id_document_number.clone();
        answers.id_issuing_authority = extras.id_issuing_authority.clone();
        answers.id_issuing_country = extras.id_issuing_country.clone();
        answers.id_issued_on = extras.id_issued_on;
        answers.id_valid_until = extras.id_valid_until;
        for (target, fallback, max) in [
            (
                &mut answers.first_name,
                declaration.first_name.as_ref(),
                100,
            ),
            (&mut answers.last_name, declaration.last_name.as_ref(), 100),
            (
                &mut answers.birth_place,
                declaration.place_of_birth.as_ref(),
                200,
            ),
            (&mut answers.street, declaration.street.as_ref(), 200),
            (&mut answers.zip, declaration.zip.as_ref(), 20),
            (&mut answers.city, declaration.city.as_ref(), 200),
            (&mut answers.country, declaration.country.as_ref(), 2),
            (&mut answers.phone, declaration.phone.as_ref(), 200),
        ] {
            fill(target, fallback, max);
        }
        answers.relationship_kind = declaration.relationship_kind.clone();
        answers.relationship = declaration.relationship.clone();
        // A parent is a person: nothing of an organisation.
        answers.organisation_name = None;
        answers.register_court = None;
        answers.register_number = None;
        answers.representative_first_name = None;
        answers.representative_last_name = None;
        answers.representative_role = None;
        answers.beneficial_owners = Vec::new();
        answers.beneficial_owners_none = None;
        answers.industry = None;
        answers.legal_form = None;
        answers.vat_id = None;
        answers.payment_reason = None;
        return answers;
    }
    for (target, fallback, max) in [
        (
            &mut answers.first_name,
            declaration.first_name.as_ref(),
            100,
        ),
        (&mut answers.last_name, declaration.last_name.as_ref(), 100),
        (
            &mut answers.organisation_name,
            declaration.organisation_name.as_ref(),
            200,
        ),
        (
            &mut answers.relationship,
            declaration.relationship.as_ref(),
            200,
        ),
    ] {
        fill(target, fallback, max);
    }
    if answers.relationship_kind.is_none() {
        answers.relationship_kind = declaration.relationship_kind.clone();
    }
    // The words describe the kind `other` only.
    if answers.relationship_kind.as_deref() != Some("other") {
        answers.relationship = None;
    }
    answers
}

/// The check level of the payer (D4, computed, never stored): level 2 when
/// the enhanced check of the lead is required by the owner's rule of
/// 2026-10-07 ([`lead_enhanced_check`]: a black-list residence or
/// citizenship of the patient or of the payer, or a confirmed sanctions match
/// of either), else level 1. Level 2 asks for the proof of funds. The reasons
/// are the rule's keys, `sanctions_review_pending` among them as information
/// on either level. A PEP, a country of the longer high-risk list, cash or
/// crypto and staff's expected total are information for staff and never
/// raise the level.
fn check_level(check: &EnhancedCheck) -> (u8, Vec<&'static str>) {
    (1 + u8::from(check.required), check.reasons.clone())
}

/// What the submit needs besides the answers.
struct Requirements<'a> {
    privacy_acknowledged: bool,
    payer_type: &'a str,
    id_uploaded: bool,
    funds_proof_required: bool,
    funds_proof_uploaded: bool,
    /// Section 8 as stored, when this questionnaire asks it (the link; a
    /// paying parent answers it in the billing section).
    payment_route: Option<&'a Declaration>,
    /// Block E of the risk assessment is open: an organisation states its
    /// legal form and why it pays.
    organisation_follow_up: bool,
    today: NaiveDate,
}

/// What is still missing before the payer can submit, in form order
/// (contract 3.5). An identity document that has expired counts as missing.
fn missing_for_submit(answers: &Answers, required: &Requirements<'_>) -> Vec<&'static str> {
    let filled = |value: &Option<String>| {
        value
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    };
    let organisation = required.payer_type != lead_payer::PAYER_TYPE_PERSON;
    let company = required.payer_type == "company";
    let id_valid = answers
        .id_valid_until
        .is_some_and(|date| date >= required.today);
    let relationship_described =
        answers.relationship_kind.as_deref() != Some("other") || filled(&answers.relationship);
    let identity_document = [
        ("id_document_type", answers.id_document_type.is_some()),
        ("id_document_number", filled(&answers.id_document_number)),
        (
            "id_issuing_authority",
            filled(&answers.id_issuing_authority),
        ),
        ("id_issuing_country", answers.id_issuing_country.is_some()),
        ("id_valid_until", id_valid),
        ("id_document_upload", required.id_uploaded),
    ];
    let address = [
        ("street", filled(&answers.street)),
        ("zip", filled(&answers.zip)),
        ("city", filled(&answers.city)),
        ("country", answers.country.is_some()),
    ];
    let mut checks: Vec<(&'static str, bool)> =
        vec![("privacy_ack", required.privacy_acknowledged)];
    if organisation {
        checks.push(("organisation_name", filled(&answers.organisation_name)));
        if required.organisation_follow_up {
            checks.push(("legal_form", filled(&answers.legal_form)));
        }
        checks.extend(address);
        if company {
            checks.push(("register_court", filled(&answers.register_court)));
            checks.push(("register_number", filled(&answers.register_number)));
        }
        checks.push((
            "representative_first_name",
            filled(&answers.representative_first_name),
        ));
        checks.push((
            "representative_last_name",
            filled(&answers.representative_last_name),
        ));
        checks.extend(identity_document);
        if company {
            checks.push((
                "beneficial_owners",
                answers.beneficial_owners_none == Some(true)
                    || !answers.beneficial_owners.is_empty(),
            ));
        }
        checks.push(("relationship_kind", answers.relationship_kind.is_some()));
        checks.push(("relationship", relationship_described));
        if required.organisation_follow_up {
            checks.push(("payment_reason", filled(&answers.payment_reason)));
        }
        checks.push(("industry", filled(&answers.industry)));
    } else {
        checks.extend([
            ("first_name", filled(&answers.first_name)),
            ("last_name", filled(&answers.last_name)),
            ("date_of_birth", answers.date_of_birth.is_some()),
            ("birth_place", filled(&answers.birth_place)),
            ("birth_country", answers.birth_country.is_some()),
            ("citizenships", !answers.citizenships.is_empty()),
        ]);
        checks.extend(address);
        checks.extend(identity_document);
        checks.push(("relationship_kind", answers.relationship_kind.is_some()));
        checks.push(("relationship", relationship_described));
        checks.push(("occupation", filled(&answers.occupation)));
    }
    checks.push(("funds_sources", !answers.funds_sources.is_empty()));
    checks.push((
        "funds_description",
        !answers.funds_sources.iter().any(|source| source == "other")
            || filled(&answers.funds_description),
    ));
    checks.push((
        "funds_proof_upload",
        !required.funds_proof_required || required.funds_proof_uploaded,
    ));
    let mut missing: Vec<&'static str> = checks
        .into_iter()
        .filter(|(_, filled)| !filled)
        .map(|(key, _)| key)
        .collect();
    if let Some(route) = required.payment_route {
        missing.extend(
            lead_payer::portal_missing_billing(Some(route), PaymentRouteBy::Patient)
                .into_iter()
                .filter(|key| !key.starts_with("invoice_")),
        );
    }
    for (question, answer, details, has_details) in [
        (
            "pep_self",
            answers.pep_self,
            "pep_self_details",
            filled(&answers.pep_self_details),
        ),
        (
            "pep_related",
            answers.pep_related,
            "pep_related_details",
            filled(&answers.pep_related_details),
        ),
        (
            "high_risk_country",
            answers.high_risk_country,
            "high_risk_country_code",
            answers.high_risk_country_code.is_some(),
        ),
        (
            "sanctions_links",
            answers.sanctions_links,
            "sanctions_links_details",
            filled(&answers.sanctions_links_details),
        ),
    ] {
        match answer {
            None => missing.push(question),
            Some(true) if !has_details => missing.push(details),
            Some(_) => {}
        }
    }
    missing
}

// ----------------------------------------------------------------------------
// Patches
// ----------------------------------------------------------------------------

fn invalid_field(field: &str, message: &str) -> Response {
    coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_field",
        message,
        json!({ "field": field }),
    )
}

/// Which keys a writer may send.
#[derive(Clone, Copy)]
struct PatchScope {
    organisation: bool,
    cabinet: bool,
}

/// A body split into the answer keys and the keys of section 8.
type SplitPatch = (Map<String, Value>, Map<String, Value>);

/// Splits a body into answers and section 8. An unknown key — section 7 and
/// the staff fields included —, a key of the other payer type and, in the
/// cabinet, a key the parent edits elsewhere are refused with the key.
fn split_patch(body: &[u8], scope: PatchScope) -> Result<SplitPatch, Response> {
    let value: Value = if body.iter().all(u8::is_ascii_whitespace) {
        json!({})
    } else {
        serde_json::from_slice(body)
            .map_err(|_| invalid_field("body", "A JSON object is expected"))?
    };
    let Value::Object(object) = value else {
        return Err(invalid_field("body", "A JSON object is expected"));
    };
    let (mut answers, mut route) = (Map::new(), Map::new());
    for (key, value) in object {
        let name = key.as_str();
        if PAYMENT_ROUTE_KEYS.contains(&name) {
            if scope.cabinet {
                return Err(invalid_field(
                    name,
                    "The payment route is answered in the billing section",
                ));
            }
            route.insert(key, value);
        } else if ANSWER_KEYS.contains(&name) {
            if !applies(name, scope.organisation) {
                return Err(invalid_field(
                    name,
                    "This field does not apply to the payer type",
                ));
            }
            if scope.cabinet && !CABINET_KEYS.contains(&name) {
                return Err(invalid_field(
                    name,
                    "This field is edited in the representatives section",
                ));
            }
            answers.insert(key, value);
        } else {
            return Err(invalid_field(name, "Unknown field"));
        }
    }
    Ok((answers, route))
}

/// `null` clears like an empty text.
fn text_of<'a>(value: &'a Value, field: &'static str) -> Result<&'a str, FieldError> {
    match value {
        Value::Null => Ok(""),
        Value::String(text) => Ok(text),
        _ => Err(field_error(field, "A text is expected")),
    }
}

fn bool_of(value: &Value, field: &'static str) -> Result<Option<bool>, FieldError> {
    match value {
        Value::Null => Ok(None),
        Value::Bool(answer) => Ok(Some(*answer)),
        _ => Err(field_error(field, "true, false or null is expected")),
    }
}

fn list_of(value: &Value, field: &'static str) -> Result<Vec<String>, FieldError> {
    match value {
        Value::Null => Ok(Vec::new()),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| field_error(field, "A list of texts is expected"))
            })
            .collect(),
        _ => Err(field_error(field, "A list is expected")),
    }
}

fn country_of(value: &str, field: &'static str) -> Result<Option<String>, FieldError> {
    normalize_country_code(Some(value))
        .map_err(|_| field_error(field, "Use an ISO 3166-1 alpha-2 country code"))
}

/// A date that has happened: not in the future, not before 1900.
fn past_date(
    value: &str,
    field: &'static str,
    today: NaiveDate,
) -> Result<Option<NaiveDate>, FieldError> {
    let date = intake::optional_date(value, field)?;
    if date.is_some_and(|date| date > today) {
        return Err(field_error(field, "The date is in the future"));
    }
    if date
        .is_some_and(|date| NaiveDate::from_ymd_opt(1900, 1, 1).is_some_and(|first| date < first))
    {
        return Err(field_error(field, "The date is too early"));
    }
    Ok(date)
}

/// A free text over several lines: only the ends are trimmed.
fn long_text(value: &str, field: &'static str) -> Result<Option<String>, FieldError> {
    let value = value.replace("\r\n", "\n").replace('\r', "\n");
    let value = value.trim();
    if value.chars().count() > STATEMENT_TEXT_MAX {
        return Err(field_error(field, "Too long"));
    }
    if value
        .chars()
        .any(|character| character.is_control() && character != '\n' && character != '\t')
    {
        return Err(field_error(field, "Invalid characters"));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

/// The beneficial owners: at most ten, each named, with a share above 0 and
/// at most 100 % with two decimals; together at most 100 %.
fn owners_of(value: &Value, today: NaiveDate) -> Result<Vec<Owner>, FieldError> {
    const FIELD: &str = "beneficial_owners";
    let invalid = |message: &'static str| field_error(FIELD, message);
    let items = match value {
        Value::Null => return Ok(Vec::new()),
        Value::Array(items) => items,
        _ => return Err(invalid("A list is expected")),
    };
    if items.len() > MAX_BENEFICIAL_OWNERS {
        return Err(invalid("At most 10 beneficial owners"));
    }
    let mut owners = Vec::with_capacity(items.len());
    let mut total = 0;
    for item in items {
        let Value::Object(item) = item else {
            return Err(invalid("Each beneficial owner is an object"));
        };
        if item.keys().any(|key| !OWNER_KEYS.contains(&key.as_str())) {
            return Err(invalid("Unknown field of a beneficial owner"));
        }
        let text = |key: &str, max: usize| -> Result<Option<String>, FieldError> {
            match item.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(value)) => intake::clean_text(value, FIELD, max),
                Some(_) => Err(invalid("A text is expected")),
            }
        };
        let first_name = text("first_name", 100)?.ok_or_else(|| invalid("The name is required"))?;
        let last_name = text("last_name", 100)?.ok_or_else(|| invalid("The name is required"))?;
        let date_of_birth = match text("date_of_birth", 10)? {
            None => None,
            Some(value) => past_date(&value, FIELD, today)?,
        };
        let country = match text("country", 10)? {
            None => None,
            Some(value) => country_of(&value, FIELD)?,
        };
        let share_cents = item
            .get("share_percent")
            .and_then(|share| cents_of(share, FULL_SHARE))
            .filter(|share| *share > 0)
            .ok_or_else(|| {
                invalid("The share is above 0 and at most 100 percent with two decimals")
            })?;
        total += share_cents;
        owners.push(Owner {
            first_name,
            last_name,
            date_of_birth,
            birth_place: text("birth_place", 200)?,
            street: text("street", 200)?,
            zip: text("zip", 20)?,
            city: text("city", 200)?,
            country,
            share_cents,
        });
    }
    if total > FULL_SHARE {
        return Err(invalid("The shares add up to more than 100 percent"));
    }
    Ok(owners)
}

/// Applies the sent answer keys to the stored answers; the result is what
/// gets stored. Details belong to a "yes", "nobody over 25 %" clears the
/// list; the sources of funds are those of the payer type
/// (`organisation`); the rules that look at the declaration too are applied
/// by the caller ([`save_patch`]).
fn apply_answers_patch(
    current: &Answers,
    patch: &Map<String, Value>,
    organisation: bool,
    today: NaiveDate,
) -> Result<Answers, FieldError> {
    let mut next = current.clone();
    for key in ANSWER_KEYS {
        let Some(value) = patch.get(key) else {
            continue;
        };
        match key {
            "salutation" => {
                next.salutation = intake::one_of(text_of(value, key)?, key, &SALUTATIONS)?
            }
            "first_name" => next.first_name = intake::clean_text(text_of(value, key)?, key, 100)?,
            "last_name" => next.last_name = intake::clean_text(text_of(value, key)?, key, 100)?,
            "former_names" => {
                next.former_names = intake::clean_text(text_of(value, key)?, key, 200)?;
            }
            "date_of_birth" => next.date_of_birth = past_date(text_of(value, key)?, key, today)?,
            "birth_place" => next.birth_place = intake::clean_text(text_of(value, key)?, key, 200)?,
            "birth_country" => next.birth_country = country_of(text_of(value, key)?, key)?,
            "citizenships" => {
                next.citizenships = normalize_citizenships(&list_of(value, key)?)
                    .map_err(|_| field_error(key, "Use ISO 3166-1 alpha-2 country codes"))?;
            }
            "street" => next.street = intake::clean_text(text_of(value, key)?, key, 200)?,
            "city" => next.city = intake::clean_text(text_of(value, key)?, key, 200)?,
            "zip" => next.zip = intake::clean_text(text_of(value, key)?, key, 20)?,
            "country" => next.country = country_of(text_of(value, key)?, key)?,
            "habitual_residence_country" => {
                next.habitual_residence_country = country_of(text_of(value, key)?, key)?;
            }
            "phone" => next.phone = intake::clean_text(text_of(value, key)?, key, 200)?,
            "language" => next.language = intake::one_of(text_of(value, key)?, key, &LANGUAGES)?,
            "id_document_type" => {
                next.id_document_type =
                    intake::one_of(text_of(value, key)?, key, &intake::ID_DOCUMENT_TYPE_VALUES)?;
            }
            "id_document_number" => {
                next.id_document_number = intake::clean_text(text_of(value, key)?, key, 60)?;
            }
            "id_issuing_authority" => {
                next.id_issuing_authority = intake::clean_text(text_of(value, key)?, key, 200)?;
            }
            "id_issuing_country" => {
                next.id_issuing_country = country_of(text_of(value, key)?, key)?;
            }
            "id_issued_on" => next.id_issued_on = past_date(text_of(value, key)?, key, today)?,
            "id_valid_until" => {
                let valid_until = intake::optional_date(text_of(value, key)?, key)?;
                // The last day of validity still counts.
                if valid_until.is_some_and(|date| date < today) {
                    return Err(FieldError {
                        code: "id_document_expired",
                        field: key,
                        message: "The identity document has expired",
                    });
                }
                next.id_valid_until = valid_until;
            }
            "organisation_name" => {
                next.organisation_name = intake::clean_text(text_of(value, key)?, key, 200)?;
            }
            "register_court" => {
                next.register_court = intake::clean_text(text_of(value, key)?, key, 200)?;
            }
            "register_number" => {
                next.register_number = intake::clean_text(text_of(value, key)?, key, 60)?;
            }
            "representative_first_name" => {
                next.representative_first_name =
                    intake::clean_text(text_of(value, key)?, key, 100)?;
            }
            "representative_last_name" => {
                next.representative_last_name = intake::clean_text(text_of(value, key)?, key, 100)?;
            }
            "representative_role" => {
                next.representative_role = intake::clean_text(text_of(value, key)?, key, 100)?;
            }
            "beneficial_owners" => next.beneficial_owners = owners_of(value, today)?,
            "beneficial_owners_none" => next.beneficial_owners_none = bool_of(value, key)?,
            "relationship_kind" => {
                next.relationship_kind =
                    intake::one_of(text_of(value, key)?, key, lead_payer::RELATIONSHIP_KINDS)?;
            }
            "relationship" => {
                next.relationship = intake::clean_text(text_of(value, key)?, key, 200)?
            }
            "occupation" => next.occupation = intake::clean_text(text_of(value, key)?, key, 200)?,
            "industry" => next.industry = intake::clean_text(text_of(value, key)?, key, 200)?,
            "legal_form" => next.legal_form = intake::clean_text(text_of(value, key)?, key, 100)?,
            "vat_id" => next.vat_id = intake::clean_text(text_of(value, key)?, key, 20)?,
            "payment_reason" => next.payment_reason = long_text(text_of(value, key)?, key)?,
            "funds_sources" => {
                let options = funds_source_options(organisation);
                let chosen = list_of(value, key)?;
                if chosen
                    .iter()
                    .any(|source| !options.contains(&source.trim()))
                {
                    return Err(field_error(key, "Not one of the sources of funds"));
                }
                next.funds_sources = options
                    .iter()
                    .filter(|source| chosen.iter().any(|value| value.trim() == **source))
                    .map(|source| source.to_string())
                    .collect();
            }
            "funds_description" => next.funds_description = long_text(text_of(value, key)?, key)?,
            "pep_self" => next.pep_self = bool_of(value, key)?,
            "pep_self_details" => next.pep_self_details = long_text(text_of(value, key)?, key)?,
            "pep_related" => next.pep_related = bool_of(value, key)?,
            "pep_related_details" => {
                next.pep_related_details = long_text(text_of(value, key)?, key)?;
            }
            "high_risk_country" => next.high_risk_country = bool_of(value, key)?,
            "high_risk_country_code" => {
                next.high_risk_country_code = country_of(text_of(value, key)?, key)?;
            }
            "sanctions_links" => next.sanctions_links = bool_of(value, key)?,
            "sanctions_links_details" => {
                next.sanctions_links_details = long_text(text_of(value, key)?, key)?;
            }
            _ => {}
        }
    }
    if next.pep_self != Some(true) {
        next.pep_self_details = None;
    }
    if next.pep_related != Some(true) {
        next.pep_related_details = None;
    }
    if next.high_risk_country != Some(true) {
        next.high_risk_country_code = None;
    }
    if next.sanctions_links != Some(true) {
        next.sanctions_links_details = None;
    }
    if next.beneficial_owners_none == Some(true) {
        next.beneficial_owners.clear();
    }
    Ok(next)
}

// ----------------------------------------------------------------------------
// The lead, its payer and the statement
// ----------------------------------------------------------------------------

/// A file of the payer (`lead_portal_uploads` of a payer kind).
#[derive(Clone, Debug)]
struct PayerUpload {
    document_id: Uuid,
    kind: String,
    access_kind: String,
    uploaded_by: Option<Uuid>,
    uploaded_at: Option<DateTime<Utc>>,
    file_name: Option<String>,
    size_bytes: Option<i64>,
    mime_type: Option<String>,
    reviewed: bool,
    /// Staff use the file: reviewed, signed, shared, in a review, moved.
    locked: bool,
}

async fn load_payer_uploads(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Vec<PayerUpload>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT u.document_id, u.kind, u.access_kind, u.uploaded_by, u.created_at,
                  u.reviewed_at, d.original_filename, d.auto_name, d.file_size, d.mime_type,
                  d.patient_id, d.signed_at,
                  EXISTS(SELECT 1 FROM document_shares s WHERE s.document_id = d.id) AS shared,
                  EXISTS(SELECT 1 FROM document_review_events r WHERE r.document_id = d.id)
                      AS in_review
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1
             AND u.kind IN ('payer_identity', 'payer_funds_proof')
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           ORDER BY u.created_at, u.document_id"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let reviewed = intake::upload_taken_over(row);
            let moved = row
                .try_get::<Option<Uuid>, _>("patient_id")
                .ok()
                .flatten()
                .is_some();
            Some(PayerUpload {
                document_id: row.try_get("document_id").ok()?,
                kind: row.try_get("kind").ok()?,
                access_kind: row.try_get("access_kind").ok()?,
                uploaded_by: row.try_get::<Option<Uuid>, _>("uploaded_by").ok().flatten(),
                uploaded_at: row.try_get::<DateTime<Utc>, _>("created_at").ok(),
                file_name: intake::upload_file_name(row),
                size_bytes: row.try_get::<Option<i64>, _>("file_size").ok().flatten(),
                mime_type: row.try_get::<Option<String>, _>("mime_type").ok().flatten(),
                reviewed,
                locked: reviewed
                    || moved
                    || row.try_get::<bool, _>("shared").unwrap_or(true)
                    || row.try_get::<bool, _>("in_review").unwrap_or(true),
            })
        })
        .collect())
}

/// How the payer answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// The payer's own link.
    Link,
    /// A paying parent with a cabinet login, in the cabinet (D5).
    Cabinet,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Link => "link",
            Mode::Cabinet => "cabinet",
        }
    }
}

/// Who looks at the questionnaire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Viewer {
    Payer,
    Parent(Uuid),
    Staff,
}

/// Everything about the lead the link and the questionnaire need.
struct LeadContext {
    patient_name: String,
    primary_language: Option<String>,
    converted: bool,
    /// Served by the portal: neither deleted nor converted.
    open: bool,
    request_submitted: bool,
    declaration: Option<Declaration>,
    loaded: lead_representatives::Loaded,
    statement: Option<Statement>,
    uploads: Vec<PayerUpload>,
}

async fn load_context(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<LeadContext>, sqlx::Error> {
    let Some(lead) = sqlx::query(&format!(
        r#"SELECT l.first_name, l.last_name, l.primary_language, l.portal_submitted_at,
                  l.converted_patient_id, ({PORTAL_LEAD_SQL}) AS open
           FROM leads l
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let patient_name = ["first_name", "last_name"]
        .iter()
        .filter_map(|column| lead.try_get::<Option<String>, _>(*column).ok().flatten())
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let declaration = lead_payer::load_declaration(conn, lead_id).await?;
    let loaded = lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    let statement = load_statement(conn, lead_id).await?;
    let uploads = load_payer_uploads(conn, lead_id).await?;
    Ok(Some(LeadContext {
        patient_name,
        primary_language: lead
            .try_get::<Option<String>, _>("primary_language")
            .ok()
            .flatten(),
        converted: lead
            .try_get::<Option<Uuid>, _>("converted_patient_id")
            .ok()
            .flatten()
            .is_some(),
        open: lead.try_get::<bool, _>("open").unwrap_or(false),
        request_submitted: lead
            .try_get::<Option<DateTime<Utc>>, _>("portal_submitted_at")
            .ok()
            .flatten()
            .is_some(),
        declaration,
        loaded,
        statement,
        uploads,
    }))
}

impl LeadContext {
    fn third_party(&self) -> Option<&Declaration> {
        self.declaration
            .as_ref()
            .filter(|declaration| declaration.is_third_party())
    }

    /// The minor's representative who is the payer, if any.
    fn paying_parent(&self) -> Option<&Representative> {
        let declaration = self.third_party()?;
        let id = lead_representatives::payer_same_person(
            &self.loaded.representation,
            Some(declaration),
        )?;
        self.loaded.representation.find(id)
    }

    /// How the payer answers; `None` without a third party.
    fn mode(&self) -> Option<Mode> {
        self.third_party()?;
        Some(match self.paying_parent() {
            Some(parent) if parent.has_login() => Mode::Cabinet,
            _ => Mode::Link,
        })
    }

    /// Why staff may not send the link (D3), in check order.
    fn blocked_reason(&self) -> Option<&'static str> {
        if self.converted {
            return Some("lead_converted");
        }
        if !self.open {
            return Some("lead_deleted");
        }
        if !self.request_submitted {
            return Some("request_not_submitted");
        }
        let Some(declaration) = self.third_party() else {
            return Some("no_third_party");
        };
        if self.mode() == Some(Mode::Cabinet) {
            return Some("payer_has_cabinet_login");
        }
        if declaration.contact_consent_at.is_none() {
            return Some("contact_consent_missing");
        }
        if !declaration.email.as_deref().is_some_and(is_plausible_email) {
            return Some("payer_email_missing");
        }
        None
    }

    fn submitted_at(&self) -> Option<DateTime<Utc>> {
        self.statement
            .as_ref()
            .and_then(|statement| statement.submitted_at)
    }

    /// The newest proof of funds, for the declaration's evidence document.
    fn newest_funds_proof(&self) -> Option<Uuid> {
        self.uploads
            .iter()
            .filter(|upload| upload.kind == UploadKind::PayerFundsProof.as_str())
            .max_by_key(|upload| upload.uploaded_at)
            .map(|upload| upload.document_id)
    }
}

/// One file in the questionnaire.
struct DocumentItem {
    id: Uuid,
    file_name: Option<String>,
    size_bytes: Option<i64>,
    mime_type: Option<String>,
    uploaded_at: Option<DateTime<Utc>>,
    reviewed: bool,
    can_delete: bool,
}

impl DocumentItem {
    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "file_name": self.file_name,
            "size_bytes": self.size_bytes,
            "mime_type": self.mime_type,
            "uploaded_at": self.uploaded_at,
            "reviewed": self.reviewed,
            "can_delete": self.can_delete,
        })
    }
}

/// The questionnaire as the payer, a paying parent or staff see it.
struct Questionnaire {
    patient_name: String,
    mode: Mode,
    payer_type: String,
    organisation: bool,
    email: Option<String>,
    statement: Statement,
    answers: Answers,
    route: Declaration,
    asked: bool,
    identity_documents: Vec<DocumentItem>,
    funds_proof_documents: Vec<DocumentItem>,
    level: u8,
    reasons: Vec<&'static str>,
    missing: Vec<&'static str>,
}

/// `check` is the lead's enhanced check ([`lead_enhanced_check`]) as stored
/// when the questionnaire is read; it sets the check level.
fn questionnaire(
    context: &LeadContext,
    viewer: Viewer,
    check: &EnhancedCheck,
    today: NaiveDate,
) -> Questionnaire {
    let declaration = context.declaration.clone().unwrap_or_default();
    let parent = match context.mode() {
        Some(Mode::Cabinet) => context.paying_parent(),
        _ => None,
    };
    let mode = if parent.is_some() {
        Mode::Cabinet
    } else {
        Mode::Link
    };
    let statement = context.statement.clone().unwrap_or_default();
    let organisation = declaration.is_organisation();
    let payer_type = declaration
        .payer_type
        .clone()
        .unwrap_or_else(|| lead_payer::PAYER_TYPE_PERSON.to_string());
    let answers = effective_answers(&statement.answers, &declaration, parent);
    let submitted = statement.submitted_at.is_some();
    let may_delete = |access_kind: &str, uploaded_by: Option<Uuid>, locked: bool| {
        !locked
            && !submitted
            && match viewer {
                Viewer::Payer => access_kind == "payer",
                Viewer::Parent(user) => uploaded_by == Some(user),
                Viewer::Staff => false,
            }
    };
    let item = |upload: &PayerUpload| DocumentItem {
        id: upload.document_id,
        file_name: upload.file_name.clone(),
        size_bytes: upload.size_bytes,
        mime_type: upload.mime_type.clone(),
        uploaded_at: upload.uploaded_at,
        reviewed: upload.reviewed,
        can_delete: may_delete(&upload.access_kind, upload.uploaded_by, upload.locked),
    };
    let identity_documents: Vec<DocumentItem> = match parent {
        // The parent's identity document is the representative's copy.
        Some(parent) => context
            .loaded
            .uploads
            .iter()
            .filter(|upload| {
                upload.representative_id == parent.id
                    && upload.kind == lead_representatives::UPLOAD_IDENTITY
            })
            .map(|upload| DocumentItem {
                id: upload.document_id,
                file_name: upload.file_name.clone(),
                size_bytes: upload.size_bytes,
                mime_type: upload.mime_type.clone(),
                uploaded_at: upload.uploaded_at,
                reviewed: upload.reviewed,
                can_delete: may_delete("guardian", upload.uploaded_by, upload.locked),
            })
            .collect(),
        None => context
            .uploads
            .iter()
            .filter(|upload| upload.kind == UploadKind::PayerIdentity.as_str())
            .map(&item)
            .collect(),
    };
    let funds_proof_documents: Vec<DocumentItem> = context
        .uploads
        .iter()
        .filter(|upload| upload.kind == UploadKind::PayerFundsProof.as_str())
        .map(&item)
        .collect();
    let (level, reasons) = check_level(check);
    let asked = mode == Mode::Link;
    let mut missing = missing_for_submit(
        &answers,
        &Requirements {
            privacy_acknowledged: statement.privacy_ack_at.is_some(),
            payer_type: &payer_type,
            id_uploaded: !identity_documents.is_empty(),
            funds_proof_required: level == 2,
            funds_proof_uploaded: !funds_proof_documents.is_empty(),
            payment_route: asked.then_some(&declaration),
            organisation_follow_up: check.organisation_follow_up,
            today,
        },
    );
    // A paying parent's identity document data are staff's (like the lead's own,
    // contract 3.1): the cabinet section has no fields for them, so they never
    // hold its sending (QA 2026-10-10, the parent could not send).
    if mode == Mode::Cabinet {
        missing.retain(|key| {
            !matches!(
                *key,
                "id_document_type"
                    | "id_document_number"
                    | "id_issuing_authority"
                    | "id_issuing_country"
                    | "id_issued_on"
                    | "id_valid_until"
            )
        });
    }
    let email = statement
        .confirmed_email
        .clone()
        .or_else(|| declaration.email.clone());
    Questionnaire {
        patient_name: context.patient_name.clone(),
        mode,
        payer_type,
        organisation,
        email,
        statement,
        answers,
        route: declaration,
        asked,
        identity_documents,
        funds_proof_documents,
        level,
        reasons,
        missing,
    }
}

impl Questionnaire {
    /// The object of contract 3.5.
    fn to_payer_json(&self) -> Value {
        let route = &self.route;
        json!({
            "patient_name": self.patient_name,
            "source": self.mode.as_str(),
            "payer_type": self.payer_type,
            "state": if self.statement.submitted_at.is_some() { "submitted" } else { "draft" },
            "email": self.email,
            "email_confirmed_at": self.statement.email_confirmed_at,
            "privacy": {
                "acknowledged_at": self.statement.privacy_ack_at,
                "text_version": self
                    .statement
                    .privacy_text_version
                    .as_deref()
                    .unwrap_or(PRIVACY_TEXT_VERSION),
                "contact_channels": self.statement.contact_channels,
            },
            "answers": self.answers.to_json(self.organisation),
            // The sources of funds of the payer type, in form order.
            "funds_source_options": funds_source_options(self.organisation),
            "payment_route": {
                "payment_method": route.payment_method,
                "payment_method_details": route.payment_method_details,
                "account_country": route.account_country,
                "account_holder": route.account_holder,
                "bank_name": route.bank_name,
                "via_third_party": route.via_third_party,
                "via_third_party_details": route.via_third_party_details,
                "account_holder_suggestion": self.answers.display_name(self.organisation),
                "asked": self.asked,
            },
            "identity_documents": self
                .identity_documents
                .iter()
                .map(DocumentItem::to_json)
                .collect::<Vec<_>>(),
            "funds_proof_documents": self
                .funds_proof_documents
                .iter()
                .map(DocumentItem::to_json)
                .collect::<Vec<_>>(),
            "funds_proof_required": self.level == 2,
            "missing_for_submit": self.missing,
            "declared_correct_at": self.statement.declared_correct_at,
            "submitted_at": self.statement.submitted_at,
        })
    }

    /// For staff: with the check level and its reasons, the IP of the
    /// privacy acknowledgement and when the answers changed and were adopted.
    fn to_staff_json(&self) -> Value {
        let mut value = self.to_payer_json();
        value["check_level"] = json!(self.level);
        value["check_reasons"] = json!(self.reasons);
        value["privacy"]["ip"] = json!(self.statement.privacy_ip);
        value["updated_at"] = json!(self.statement.updated_at);
        value["adopted_at"] = json!(self.statement.adopted_at);
        value
    }
}

async fn questionnaire_json(
    state: &AppState,
    lead_id: Uuid,
    viewer: Viewer,
) -> Result<Value, sqlx::Error> {
    let mut conn = state.db.acquire().await?;
    let Some(context) = load_context(&mut conn, lead_id).await? else {
        return Ok(Value::Null);
    };
    let check = lead_enhanced_check::enhanced_check_triggers(&mut conn, lead_id).await?;
    let built = questionnaire(&context, viewer, &check, crate::app_time::today());
    Ok(match viewer {
        Viewer::Staff => built.to_staff_json(),
        Viewer::Payer | Viewer::Parent(_) => {
            // The payer's own view of its signature package (phase 3b): a
            // status and two dates, nothing else.
            let mut value = built.to_payer_json();
            value["signature_package"] = crate::routes::lead_payer_package::payer_view(
                &mut conn,
                lead_id,
                built.statement.confirmed_email.as_deref(),
            )
            .await?;
            value
        }
    })
}

async fn questionnaire_response(
    state: &AppState,
    lead_id: Uuid,
    viewer: Viewer,
    status: StatusCode,
) -> Response {
    match questionnaire_json(state, lead_id, viewer).await {
        Ok(value) => (status, Json(value)).into_response(),
        Err(error) => intake::internal(error, "load payer questionnaire"),
    }
}

async fn publish(state: &AppState, actor: Option<Uuid>, lead_id: Uuid, access_kind: Option<&str>) {
    let mut payload = json!({ "change": "payer_link" });
    if let Some(access_kind) = access_kind {
        payload["access_kind"] = json!(access_kind);
    }
    crate::realtime::publish_lead_event(state, actor, "lead.portal_updated", lead_id, payload)
        .await;
}

// ----------------------------------------------------------------------------
// Links
// ----------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Link {
    id: Uuid,
    lead_id: Uuid,
    email: String,
    language: String,
    payer_key: Value,
    sent_by: Uuid,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    opened_at: Option<DateTime<Utc>>,
    verified_at: Option<DateTime<Utc>>,
    code_hash: Option<String>,
    code_sent_at: Option<DateTime<Utc>>,
    code_expires_at: Option<DateTime<Utc>>,
    code_attempts: i32,
    failed_attempts: i32,
    locked_at: Option<DateTime<Utc>>,
    session_hash: Option<String>,
    session_expires_at: Option<DateTime<Utc>>,
    revoked_at: Option<DateTime<Utc>>,
    revoked_reason: Option<String>,
}

const LINK_COLUMNS: &str = "k.id, k.lead_id, k.email, k.language, k.payer_key, k.sent_by, \
     k.created_at, k.expires_at, k.opened_at, k.verified_at, k.code_hash, k.code_sent_at, \
     k.code_expires_at, k.code_attempts, k.failed_attempts, k.locked_at, k.session_hash, \
     k.session_expires_at, k.revoked_at, k.revoked_reason";

impl Link {
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        Ok(Link {
            id: row.try_get("id")?,
            lead_id: row.try_get("lead_id")?,
            email: row.try_get("email")?,
            language: row.try_get("language")?,
            payer_key: row.try_get("payer_key")?,
            sent_by: row.try_get("sent_by")?,
            created_at: row.try_get("created_at")?,
            expires_at: row.try_get("expires_at")?,
            opened_at: row.try_get("opened_at")?,
            verified_at: row.try_get("verified_at")?,
            code_hash: row.try_get("code_hash")?,
            code_sent_at: row.try_get("code_sent_at")?,
            code_expires_at: row.try_get("code_expires_at")?,
            code_attempts: row.try_get("code_attempts")?,
            failed_attempts: row.try_get("failed_attempts")?,
            locked_at: row.try_get("locked_at")?,
            session_hash: row.try_get("session_hash")?,
            session_expires_at: row.try_get("session_expires_at")?,
            revoked_at: row.try_get("revoked_at")?,
            revoked_reason: row.try_get("revoked_reason")?,
        })
    }

    /// The status staff see.
    fn status(&self, statement: Option<&Statement>, now: DateTime<Utc>) -> &'static str {
        if self.revoked_at.is_some() {
            "revoked"
        } else if statement.is_some_and(|statement| {
            statement.submitted_at.is_some() && statement.link_id == Some(self.id)
        }) {
            "submitted"
        } else if self.locked_at.is_some() {
            "locked"
        } else if self.expires_at <= now {
            "expired"
        } else if self.verified_at.is_some() {
            "verified"
        } else if self.opened_at.is_some() {
            "opened"
        } else {
            "sent"
        }
    }
}

/// Why a call of the payer's link is refused.
enum Refusal {
    LinkInvalid,
    LinkRevoked,
    LinkExpired,
    LinkLocked,
    SessionRequired,
    SessionExpired,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for Refusal {
    fn from(error: sqlx::Error) -> Self {
        Refusal::Database(error)
    }
}

impl Refusal {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Refusal::LinkInvalid => (
                StatusCode::UNAUTHORIZED,
                "link_invalid",
                "This link is not valid",
            ),
            Refusal::LinkRevoked => (
                StatusCode::GONE,
                "link_revoked",
                "This link is no longer valid",
            ),
            Refusal::LinkExpired => (StatusCode::GONE, "link_expired", "This link has expired"),
            Refusal::LinkLocked => (
                StatusCode::LOCKED,
                "link_locked",
                "This link is locked after too many wrong codes",
            ),
            Refusal::SessionRequired => (
                StatusCode::UNAUTHORIZED,
                "session_required",
                "Please confirm the code first",
            ),
            Refusal::SessionExpired => (
                StatusCode::UNAUTHORIZED,
                "session_expired",
                "The session has ended; please confirm a new code",
            ),
            Refusal::Database(error) => return intake::internal(error, "payer link"),
        };
        coded(status, code, message, json!({}))
    }
}

/// Resolves the token of the `X-Payer-Link` header and locks the lead row,
/// then the link row — the order of the cabinet's and staff's writes, which
/// lock the lead before they touch its links, so a payer's write and a
/// change of the payer never interleave. Unknown → `link_invalid`; revoked,
/// lead gone (deleted, converted, closed), the declaration no longer names a
/// third party or names another payer or another address than the link was
/// sent for → `link_revoked`; past its time → `link_expired`; locked →
/// `link_locked`.
async fn resolve_link(conn: &mut PgConnection, headers: &HeaderMap) -> Result<Link, Refusal> {
    let Some(token) = headers
        .get(HEADER_LINK)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| is_secret(value))
    else {
        return Err(Refusal::LinkInvalid);
    };
    let token_hash = hash_token(token);
    let Some(lead_id) =
        sqlx::query_scalar::<_, Uuid>("SELECT lead_id FROM lead_payer_links WHERE token_hash = $1")
            .bind(&token_hash)
            .fetch_optional(&mut *conn)
            .await?
    else {
        return Err(Refusal::LinkInvalid);
    };
    sqlx::query("SELECT 1 FROM leads WHERE id = $1 FOR UPDATE")
        .bind(lead_id)
        .execute(&mut *conn)
        .await?;
    let Some(row) = sqlx::query(&format!(
        r#"SELECT {LINK_COLUMNS}, ({PORTAL_LEAD_SQL}) AS lead_open
           FROM lead_payer_links k
           JOIN leads l ON l.id = k.lead_id
           WHERE k.token_hash = $1
           FOR UPDATE OF k"#
    ))
    .bind(token_hash)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Err(Refusal::LinkInvalid);
    };
    let link = Link::from_row(&row)?;
    if link.revoked_at.is_some() || !row.try_get::<bool, _>("lead_open").unwrap_or(false) {
        return Err(Refusal::LinkRevoked);
    }
    let declaration = lead_payer::load_declaration(conn, link.lead_id).await?;
    let current = declaration.filter(|declaration| {
        declaration.is_third_party()
            && declaration.payer_key() == link.payer_key
            && normalized_email(declaration.email.as_deref()) == normalized_email(Some(&link.email))
    });
    if current.is_none() {
        return Err(Refusal::LinkRevoked);
    }
    if link.expires_at <= Utc::now() {
        return Err(Refusal::LinkExpired);
    }
    if link.locked_at.is_some() {
        return Err(Refusal::LinkLocked);
    }
    Ok(link)
}

/// The `X-Payer-Session` header against the link's current session.
fn check_session(link: &Link, headers: &HeaderMap, now: DateTime<Utc>) -> Result<(), Refusal> {
    let Some(raw) = headers.get(HEADER_SESSION) else {
        return Err(Refusal::SessionRequired);
    };
    let Some(session) = raw
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|value| is_secret(value))
    else {
        return Err(Refusal::SessionExpired);
    };
    match (&link.session_hash, link.session_expires_at) {
        (Some(stored), Some(until)) if until > now && same_hash(&hash_token(session), stored) => {
            Ok(())
        }
        _ => Err(Refusal::SessionExpired),
    }
}

/// A call under a verified session: the link locked, the session checked
/// and renewed (sliding), in the returned transaction.
async fn payer_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(Transaction<'static, Postgres>, Link), Response> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| intake::internal(error, "begin payer call"))?;
    let link = resolve_link(&mut tx, headers)
        .await
        .map_err(Refusal::into_response)?;
    let now = Utc::now();
    check_session(&link, headers, now).map_err(Refusal::into_response)?;
    sqlx::query(
        "UPDATE lead_payer_links SET session_expires_at = $2, last_seen_at = $3 WHERE id = $1",
    )
    .bind(link.id)
    .bind(now + Duration::minutes(SESSION_IDLE_MINUTES))
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|error| intake::internal(error, "renew payer session"))?;
    Ok((tx, link))
}

/// Ends a refused call: only the session renewal was written, so it is kept.
async fn refuse(tx: Transaction<'static, Postgres>, response: Response) -> Response {
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer session");
    }
    response
}

/// Revokes the active link of a lead, audited per link.
async fn revoke_active(
    conn: &mut PgConnection,
    lead_id: Uuid,
    reason: &str,
    actor: Option<Uuid>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let revoked: Vec<Uuid> = sqlx::query_scalar(
        r#"UPDATE lead_payer_links
           SET revoked_at = now(), revoked_by = $3, revoked_reason = $2,
               session_hash = NULL, session_expires_at = NULL,
               code_hash = NULL, code_expires_at = NULL
           WHERE lead_id = $1 AND revoked_at IS NULL
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(reason)
    .bind(actor)
    .fetch_all(&mut *conn)
    .await?;
    for link_id in &revoked {
        audit::write_in_transaction(
            conn,
            &audit::domain_event(
                "payer_link_revoked",
                actor,
                "lead",
                Some(lead_id),
                json!({ "link_id": link_id, "reason": reason }),
            ),
        )
        .await?;
    }
    Ok(revoked)
}

/// Who writes the payer's answers: the payer through its link (no login,
/// the hashed client IP on the audit row) or a paying parent in the cabinet.
enum Writer {
    Link {
        link_id: Uuid,
        ip_hash: Option<String>,
    },
    Parent {
        user_id: Uuid,
    },
}

impl Writer {
    fn actor(&self) -> Option<Uuid> {
        match self {
            Writer::Link { .. } => None,
            Writer::Parent { user_id } => Some(*user_id),
        }
    }

    fn link_id(&self) -> Option<Uuid> {
        match self {
            Writer::Link { link_id, .. } => Some(*link_id),
            Writer::Parent { .. } => None,
        }
    }

    fn access_kind(&self) -> &'static str {
        match self {
            Writer::Link { .. } => "payer",
            Writer::Parent { .. } => "guardian",
        }
    }

    /// A domain event of this writer: the link or the access kind in the
    /// context, never a value or a secret.
    fn event(
        &self,
        action: &str,
        entity_type: &str,
        entity_id: Uuid,
        mut context: Value,
    ) -> audit::AuditEvent {
        match self {
            Writer::Link { link_id, .. } => context["link_id"] = json!(link_id),
            Writer::Parent { .. } => context["access_kind"] = json!("guardian"),
        }
        let mut event =
            audit::domain_event(action, self.actor(), entity_type, Some(entity_id), context);
        if let Writer::Link { ip_hash, .. } = self {
            event.ip_hash = ip_hash.clone();
        }
        event
    }
}

fn consent_required() -> Response {
    coded(
        StatusCode::FORBIDDEN,
        "payer_consent_required",
        "Please read and acknowledge the privacy notice first",
        json!({}),
    )
}

fn already_submitted() -> Response {
    coded(
        StatusCode::CONFLICT,
        "payer_submitted",
        "The answers are sent; GMED reopens them for corrections",
        json!({}),
    )
}

fn database(error: sqlx::Error) -> Response {
    intake::internal(error, "payer questionnaire")
}

fn billing_error(error: PortalBillingError) -> Response {
    match error {
        PortalBillingError::Invalid { field, message } => invalid_field(&field, message),
        PortalBillingError::Database(error) => database(error),
        PortalBillingError::RouteByPayer | PortalBillingError::NotDeclared => {
            invalid_field("payment_method", "The payment route cannot be saved")
        }
    }
}

// ----------------------------------------------------------------------------
// Writes shared by the link and the cabinet
// ----------------------------------------------------------------------------

/// The acknowledgement of the privacy notice (D7): the first one keeps its
/// time, text version, language and IP; the contact channels follow the
/// latest answer. Nothing else is writable before it. `payer_informed` is
/// what the paying parent's acknowledgement recorded on the declaration
/// (`None` for the link, whose invitation records it).
#[allow(clippy::too_many_arguments)]
async fn record_consent(
    conn: &mut PgConnection,
    context: &LeadContext,
    writer: &Writer,
    lead_id: Uuid,
    body: &[u8],
    ip: Option<&str>,
    default_language: Option<&str>,
    payer_informed: Option<bool>,
) -> Result<(), Response> {
    if context.submitted_at().is_some() {
        return Err(already_submitted());
    }
    let value: Value = serde_json::from_slice(body)
        .map_err(|_| invalid_field("body", "A JSON object is expected"))?;
    if value.get("acknowledged") != Some(&Value::Bool(true)) {
        return Err(invalid_field(
            "acknowledged",
            "Please acknowledge the privacy notice",
        ));
    }
    let stored = context.statement.as_ref();
    let channels = match value.get("contact_channels") {
        None => stored
            .map(|statement| statement.contact_channels.clone())
            .unwrap_or_default(),
        Some(channels) => {
            let chosen =
                list_of(channels, "contact_channels").map_err(FieldError::into_response)?;
            if chosen
                .iter()
                .any(|channel| !CONTACT_CHANNELS.contains(&channel.trim()))
            {
                return Err(invalid_field("contact_channels", "Not one of the channels"));
            }
            CONTACT_CHANNELS
                .iter()
                .filter(|channel| chosen.iter().any(|value| value.trim() == **channel))
                .map(|channel| channel.to_string())
                .collect()
        }
    };
    let language = match value.get("language") {
        None | Some(Value::Null) => default_language.map(str::to_string),
        Some(Value::String(language)) if LANGUAGES.contains(&language.trim()) => {
            Some(language.trim().to_string())
        }
        Some(_) => return Err(invalid_field("language", "Not one of the languages")),
    };
    let first = stored.is_none_or(|statement| statement.privacy_ack_at.is_none());
    sqlx::query(
        r#"UPDATE lead_payer_statements
           SET privacy_ack_at = COALESCE(privacy_ack_at, now()),
               privacy_text_version = CASE WHEN privacy_ack_at IS NULL THEN $2
                                           ELSE privacy_text_version END,
               privacy_language = CASE WHEN privacy_ack_at IS NULL THEN $3
                                       ELSE privacy_language END,
               privacy_ip = CASE WHEN privacy_ack_at IS NULL THEN $4 ELSE privacy_ip END,
               contact_channels = $5,
               updated_at = now()
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(PRIVACY_TEXT_VERSION)
    .bind(language)
    .bind(ip)
    .bind(channels)
    .execute(&mut *conn)
    .await
    .map_err(database)?;
    let mut audit_context = json!({ "first": first, "text_version": PRIVACY_TEXT_VERSION });
    if let Some(recorded) = payer_informed {
        audit_context["payer_informed_recorded"] = json!(recorded);
    }
    audit::write_in_transaction(
        conn,
        &writer.event(
            "payer_questionnaire_consent",
            "lead",
            lead_id,
            audit_context,
        ),
    )
    .await
    .map_err(database)
}

/// Saves the changed answer keys and, through the link, section 8 of the
/// declaration (phase 2's validation and dependent clearing). Returns
/// whether anything changed.
async fn save_patch(
    conn: &mut PgConnection,
    context: &LeadContext,
    writer: &Writer,
    lead_id: Uuid,
    body: &[u8],
    today: NaiveDate,
) -> Result<bool, Response> {
    let Some(statement) = context
        .statement
        .as_ref()
        .filter(|statement| statement.privacy_ack_at.is_some())
    else {
        return Err(consent_required());
    };
    if statement.submitted_at.is_some() {
        return Err(already_submitted());
    }
    let declaration = context.declaration.clone().unwrap_or_default();
    let parent = match writer {
        Writer::Parent { .. } => context.paying_parent(),
        Writer::Link { .. } => None,
    };
    let organisation = declaration.is_organisation();
    let (answers_patch, route_patch) = split_patch(
        body,
        PatchScope {
            organisation,
            cabinet: matches!(writer, Writer::Parent { .. }),
        },
    )?;
    let mut next = apply_answers_patch(&statement.answers, &answers_patch, organisation, today)
        .map_err(FieldError::into_response)?;
    // The rules that look at what the payer sees: the words describe the
    // kind `other`; a habitual residence is asked only when it differs.
    let effective = effective_answers(&next, &declaration, parent);
    if effective.relationship_kind.as_deref() != Some("other") {
        next.relationship = None;
    }
    if effective.habitual_residence_country.is_some()
        && effective.habitual_residence_country == effective.country
    {
        next.habitual_residence_country = None;
    }
    let route = if route_patch.is_empty() {
        None
    } else {
        let patch =
            PortalBillingPatch::parse(&Value::Object(route_patch)).map_err(billing_error)?;
        Some(lead_payer::apply_payment_route_patch(&declaration, &patch).map_err(billing_error)?)
    };
    let mut changed: Vec<&'static str> = ANSWER_KEYS
        .iter()
        .copied()
        .filter(|key| statement.answers.value(key) != next.value(key))
        .collect();
    if let Some((_, route_changed)) = &route {
        changed.extend(route_changed.iter().copied());
    }
    if changed.is_empty() {
        return Ok(false);
    }
    if next != statement.answers {
        store_answers(conn, lead_id, &next, writer.actor())
            .await
            .map_err(database)?;
    }
    if let Some((declaration, route_changed)) = &route
        && !route_changed.is_empty()
    {
        lead_payer::store_payment_route(conn, lead_id, declaration)
            .await
            .map_err(database)?;
    }
    audit::write_in_transaction(
        conn,
        &writer.event(
            "payer_questionnaire_update",
            "lead",
            lead_id,
            json!({ "fields": changed }),
        ),
    )
    .await
    .map_err(database)?;
    // The payer's answers count for the risk assessment at once (P3).
    crate::risk::store::reassess(conn, lead_id, crate::risk::store::Cause::PayerLink, None)
        .await
        .map_err(database)?;
    Ok(true)
}

/// Why no upload is taken now.
fn upload_refusal(context: &LeadContext) -> Option<Response> {
    let statement = context
        .statement
        .as_ref()
        .filter(|statement| statement.privacy_ack_at.is_some());
    match statement {
        None => Some(consent_required()),
        Some(statement) if statement.submitted_at.is_some() => Some(already_submitted()),
        Some(_) if context.uploads.len() >= MAX_PAYER_UPLOADS => Some(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "too_many_documents",
            "Too many documents of the payer",
            json!({ "max_documents": MAX_PAYER_UPLOADS }),
        )),
        Some(_) => None,
    }
}

/// A stored payer file, not yet registered.
struct StoredFile {
    document_id: Uuid,
    file_size: i64,
    storage_key: String,
    mime_type: String,
}

/// Reads, checks (type, content, malware scan) and stores a payer file as a
/// document of the lead (D6): not medical, internal, named after the payer.
/// `uploaded_by` is the staff member who sent the link (the document needs a
/// user) or the paying parent.
async fn store_payer_file(
    state: &AppState,
    lead_id: Uuid,
    kind: UploadKind,
    payer_name: &str,
    uploaded_by: Uuid,
    ursprung: &str,
    multipart: &mut Multipart,
) -> Result<StoredFile, Response> {
    let (file_name, content_type, data) = intake::read_upload_file(multipart).await?;
    let mime_type =
        crate::routes::leads::validate_lead_attachment(&file_name, content_type.as_deref(), &data)
            .await?;
    if !intake::IDENTITY_DOCUMENT_MIME_TYPES.contains(&mime_type.as_str()) {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported_file_type",
            "Upload the document as PDF, JPG or PNG",
            json!({}),
        ));
    }
    let (auto_name, category) = match kind {
        UploadKind::PayerIdentity => (
            format!("Identity document – payer {payer_name}"),
            "identity",
        ),
        _ => (
            format!("Proof of source of funds – {payer_name}"),
            "administrative",
        ),
    };
    let input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id: None,
        lead_id: Some(lead_id),
        order_id: None,
        appointment_id: None,
        auto_name: &auto_name,
        original_filename: &file_name,
        art: kind.as_str(),
        category: Some(category),
        status: "active",
        visibility: "internal",
        is_medical: false,
        mime_type: &mime_type,
        klinik: None,
        ursprung: Some(ursprung),
        notes: None,
        document_direction: Some("incoming"),
        document_variant: Some("original"),
        document_language: None,
        access_category: Some("internal"),
        document_date: Some(crate::app_time::today()),
        source_person: Some("payer"),
        source_institution: None,
        addressee_person: None,
        addressee_institution: Some("GMED"),
        financial_status: None,
        payment_due_date: None,
        payment_date: None,
        payment_method: None,
        generated_template_id: None,
        generated_bindings: None,
        generated_manual_text: None,
        version_root_document_id: None,
        replaces_document_id: None,
        version_number: 1,
        uploaded_by,
    };
    let (document_id, file_size, _, storage_key) =
        persist_document_file(state, &data, &input).await?;
    Ok(StoredFile {
        document_id,
        file_size,
        storage_key,
        mime_type,
    })
}

/// Registers a stored payer file in `lead_portal_uploads`, audited.
async fn register_payer_file(
    conn: &mut PgConnection,
    lead_id: Uuid,
    kind: UploadKind,
    writer: &Writer,
    file: &StoredFile,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_portal_uploads
               (document_id, lead_id, uploaded_by, access_kind, consent_record_id, kind,
                payer_link_id)
           VALUES ($1, $2, $3, $4, NULL, $5, $6)"#,
    )
    .bind(file.document_id)
    .bind(lead_id)
    .bind(writer.actor())
    .bind(writer.access_kind())
    .bind(kind.as_str())
    .bind(writer.link_id())
    .execute(&mut *conn)
    .await?;
    audit::write_in_transaction(
        conn,
        &writer.event(
            "payer_questionnaire_upload",
            "document",
            file.document_id,
            json!({
                "lead_id": lead_id,
                "kind": kind.as_str(),
                "mime_type": file.mime_type,
                "file_size": file.file_size,
            }),
        ),
    )
    .await
}

/// The payer's own identity adopted into the declaration (D8).
fn adopted_declaration(
    current: &Declaration,
    answers: &Answers,
    funds_document: Option<Uuid>,
) -> Declaration {
    fn set(target: &mut Option<String>, value: &Option<String>) {
        if value.is_some() {
            target.clone_from(value);
        }
    }
    let mut next = current.clone();
    if next.is_organisation() {
        set(&mut next.organisation_name, &answers.organisation_name);
    } else {
        set(&mut next.first_name, &answers.first_name);
        set(&mut next.last_name, &answers.last_name);
        if answers.date_of_birth.is_some() {
            next.date_of_birth = answers.date_of_birth;
        }
        set(&mut next.place_of_birth, &answers.birth_place);
        if !answers.citizenships.is_empty() {
            next.citizenships.clone_from(&answers.citizenships);
        }
    }
    set(&mut next.street, &answers.street);
    set(&mut next.zip, &answers.zip);
    set(&mut next.city, &answers.city);
    set(&mut next.country, &answers.country);
    set(&mut next.phone, &answers.phone);
    if let Some(kind) = &answers.relationship_kind {
        next.relationship_kind = Some(kind.clone());
        next.relationship = if kind == "other" {
            answers.relationship.clone()
        } else {
            None
        };
    }
    // The source of funds only while nobody stated it: one source the
    // declaration knows is it; several, or one of an organisation without a
    // match in the declaration's list, are "other" with the payer's words.
    if next.source_of_funds.is_none() {
        let matched = match answers.funds_sources.as_slice() {
            [single] => declaration_source_of_funds(single),
            _ => None,
        };
        match (answers.funds_sources.as_slice(), matched) {
            ([], _) => {}
            ([_], Some(source)) => {
                next.source_of_funds = Some(source.to_string());
                if next.source_of_funds_description.is_none() {
                    next.source_of_funds_description = answers.funds_description.clone();
                }
            }
            (several, _) => {
                next.source_of_funds = Some("other".to_string());
                if next.source_of_funds_description.is_none() {
                    let labels = several
                        .iter()
                        .map(|source| funds_source_label(source))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let mut description = format!("Angaben des Zahlers: {labels}");
                    if let Some(text) = &answers.funds_description {
                        description.push_str(" – ");
                        description.push_str(text);
                    }
                    next.source_of_funds_description =
                        Some(description.chars().take(STATEMENT_TEXT_MAX).collect());
                }
            }
        }
    }
    if next.source_of_funds_document_id.is_none() {
        next.source_of_funds_document_id = funds_document;
    }
    next
}

/// The declaration's source of funds ([`lead_payer::SOURCE_OF_FUNDS`]) for
/// one source the payer stated: a person's sources are that list; of an
/// organisation's ([`ORGANISATION_FUNDS_SOURCES`]) the business revenue is
/// the declaration's business income and "other" is "other", the rest has no
/// match.
fn declaration_source_of_funds(source: &str) -> Option<&'static str> {
    match source {
        "business_revenue" => Some("business_income"),
        source => lead_payer::SOURCE_OF_FUNDS
            .iter()
            .copied()
            .find(|known| *known == source),
    }
}

/// The German label of a source of funds, as the wizard and the payer page
/// show it.
fn funds_source_label(source: &str) -> &str {
    match source {
        "employment" => "Gehalt / nichtselbständige Arbeit",
        "business_income" => "Einkünfte aus Unternehmen / selbständiger Tätigkeit",
        "savings" => "Ersparnisse",
        "asset_sale" => "Verkauf von Vermögenswerten",
        "inheritance_gift" => "Erbschaft / Schenkung",
        "business_revenue" => "Geschäftstätigkeit / Umsatz",
        "equity" => "Eigenkapital",
        "loan" => "Darlehen / Kredit",
        "insurance_benefit" => "Versicherungsleistung",
        "donation" => "Spende / Zuwendung",
        "other" => "Sonstiges",
        other => other,
    }
}

/// "Submit" (D8): everything answered and confirmed → the effective answers
/// are frozen into the statement, the payer's identity is adopted into the
/// declaration (with the order payer), the payer-key snapshots of the active
/// link and of the statement follow it. Returns the check level.
async fn submit_in_tx(
    conn: &mut PgConnection,
    context: &LeadContext,
    writer: &Writer,
    viewer: Viewer,
    lead_id: Uuid,
    declared_correct: bool,
) -> Result<u8, Response> {
    if context.submitted_at().is_some() {
        return Err(already_submitted());
    }
    // The answers are stored as they are typed, so the rule reads the
    // payer's countries of this submit.
    let check = lead_enhanced_check::enhanced_check_triggers(conn, lead_id)
        .await
        .map_err(database)?;
    let built = questionnaire(context, viewer, &check, crate::app_time::today());
    if !built.missing.is_empty() {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "questionnaire_incomplete",
            "Please complete the questionnaire first",
            json!({ "missing": built.missing }),
        ));
    }
    if !declared_correct {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "declaration_required",
            "Please confirm that your details are complete and correct",
            json!({}),
        ));
    }
    store_answers(conn, lead_id, &built.answers, writer.actor())
        .await
        .map_err(database)?;
    sqlx::query(
        r#"UPDATE lead_payer_statements
           SET declared_correct_at = now(), submitted_at = now(), adopted_at = now()
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await
    .map_err(database)?;
    let adopted = adopted_declaration(&built.route, &built.answers, context.newest_funds_proof());
    lead_payer::adopt_payer_identity(conn, lead_id, &adopted, writer.actor(), writer.link_id())
        .await
        .map_err(database)?;
    let payer_key = adopted.payer_key();
    sqlx::query(
        "UPDATE lead_payer_links SET payer_key = $2 WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(lead_id)
    .bind(&payer_key)
    .execute(&mut *conn)
    .await
    .map_err(database)?;
    sqlx::query("UPDATE lead_payer_statements SET payer_key = $2 WHERE lead_id = $1")
        .bind(lead_id)
        .bind(payer_key)
        .execute(&mut *conn)
        .await
        .map_err(database)?;
    audit::write_in_transaction(
        conn,
        &writer.event(
            "payer_questionnaire_submitted",
            "lead",
            lead_id,
            json!({ "check_level": built.level, "check_reasons": built.reasons }),
        ),
    )
    .await
    .map_err(database)?;
    crate::risk::store::reassess(conn, lead_id, crate::risk::store::Cause::PayerLink, None)
        .await
        .map_err(database)?;
    Ok(built.level)
}

async fn notify_submitted(state: &AppState, lead_id: Uuid, level: u8) {
    intake::notify_lead_staff(
        state,
        lead_id,
        "lead_payer_submitted",
        "Payer sent the cost coverage details",
        &format!(
            "The payer's details are in the lead wizard under \"Angaben des Zahlers\" (check level {level})."
        ),
    )
    .await;
}

fn declared_correct(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value.get("declared_correct").and_then(Value::as_bool))
        .unwrap_or(false)
}

// ----------------------------------------------------------------------------
// Public handlers (the payer)
// ----------------------------------------------------------------------------

/// `GET /public/payer-link` (3.1): what the opened link shows before the code.
async fn open_link(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin payer link"),
    };
    let link = match resolve_link(&mut tx, &headers).await {
        Ok(link) => link,
        Err(refusal) => return refusal.into_response(),
    };
    let now = Utc::now();
    let session_valid = check_session(&link, &headers, now).is_ok();
    if let Err(error) = sqlx::query(
        r#"UPDATE lead_payer_links
           SET opened_at = COALESCE(opened_at, $2), last_seen_at = $2,
               session_expires_at = CASE WHEN $3 THEN $4 ELSE session_expires_at END
           WHERE id = $1"#,
    )
    .bind(link.id)
    .bind(now)
    .bind(session_valid)
    .bind(now + Duration::minutes(SESSION_IDLE_MINUTES))
    .execute(&mut *tx)
    .await
    {
        return intake::internal(error, "open payer link");
    }
    let context = match load_context(&mut tx, link.lead_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return Refusal::LinkRevoked.into_response(),
        Err(error) => return intake::internal(error, "load payer link lead"),
    };
    // The payer's signature package (phase 3b): sent or signed, for the
    // address this link confirmed; no titles, ids or request data.
    let signature_package = match crate::routes::lead_payer_package::payer_view(
        &mut tx,
        link.lead_id,
        context
            .statement
            .as_ref()
            .and_then(|statement| statement.confirmed_email.as_deref()),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => return intake::internal(error, "load payer signature package"),
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer link");
    }
    if link.opened_at.is_none() {
        publish(&state, None, link.lead_id, Some("payer")).await;
    }
    let state_name = if context.submitted_at().is_some() {
        "submitted"
    } else if session_valid {
        "active"
    } else {
        "code_required"
    };
    let payer_type = context
        .declaration
        .as_ref()
        .and_then(|declaration| declaration.payer_type.clone())
        .unwrap_or_else(|| lead_payer::PAYER_TYPE_PERSON.to_string());
    Json(json!({
        "state": state_name,
        "patient_name": context.patient_name,
        "payer_type": payer_type,
        "email_masked": mask_email(&link.email),
        "language": link.language,
        "expires_at": link.expires_at,
        "code_sent_at": link.code_sent_at,
        "session_valid": session_valid,
        "signature_package": signature_package,
    }))
    .into_response()
}

fn mail_unavailable(code: &str) -> Response {
    crate::mail::coded(
        StatusCode::SERVICE_UNAVAILABLE,
        code,
        "Mail connection unavailable",
    )
}

/// `POST /public/payer-link/code` (3.2): mails a new six-digit code to the
/// link's address. At most one a minute and five an hour.
async fn send_code(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let mailer = match current_mailer(&state).await {
        Ok(mailer) => mailer,
        Err(code) => return mail_unavailable(code),
    };
    let Some(console_url) = mailer.console_url().map(str::to_string) else {
        return error_response(&MailError::NotConfigured);
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin payer code"),
    };
    let link = match resolve_link(&mut tx, &headers).await {
        Ok(link) => link,
        Err(refusal) => return refusal.into_response(),
    };
    let now = Utc::now().trunc_subsecs(6);
    let rate_limited = |wait: i64| {
        coded(
            StatusCode::TOO_MANY_REQUESTS,
            "code_rate_limited",
            "Please wait before asking for another code",
            json!({ "retry_after_seconds": wait.max(1) }),
        )
    };
    if let Some(sent_at) = link.code_sent_at {
        let wait = CODE_RESEND_SECONDS - (now - sent_at).num_seconds();
        if wait > 0 {
            return rate_limited(wait);
        }
    }
    let recent: Vec<DateTime<Utc>> = match sqlx::query_scalar(
        r#"SELECT created_at FROM lead_payer_link_emails
           WHERE link_id = $1 AND kind = 'code' AND created_at > $2
           ORDER BY created_at"#,
    )
    .bind(link.id)
    .bind(now - Duration::hours(1))
    .fetch_all(&mut *tx)
    .await
    {
        Ok(recent) => recent,
        Err(error) => return intake::internal(error, "count payer codes"),
    };
    if recent.len() >= CODES_PER_HOUR {
        let oldest = recent.first().copied().unwrap_or(now);
        return rate_limited((oldest + Duration::hours(1) - now).num_seconds());
    }
    let code = new_code();
    if let Err(error) = sqlx::query(
        r#"UPDATE lead_payer_links
           SET code_hash = $2, code_sent_at = $3, code_expires_at = $4, code_attempts = 0
           WHERE id = $1"#,
    )
    .bind(link.id)
    .bind(code_hash(link.id, &code))
    .bind(now)
    .bind(now + Duration::minutes(CODE_VALID_MINUTES))
    .execute(&mut *tx)
    .await
    {
        return intake::internal(error, "store payer code");
    }
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer code");
    }

    let agency = crate::mail::agency_identity(&state.db).await;
    let logo_url = templates::logo_url(&console_url);
    let language = MailLanguage::from_code(Some(&link.language));
    let rendered = templates::payer_code(&PayerCodeEmail {
        language,
        code: &code,
        agency: &agency,
        logo_url: Some(&logo_url),
    });
    let outgoing = OutgoingEmail {
        to: link.email.clone(),
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotency_key: format!(
            "payer-code:{}:{}",
            link.id,
            now.to_rfc3339_opts(SecondsFormat::Micros, true)
        ),
    };
    let result = mailer.send(&outgoing).await;
    let ip_hash = client_ip(&headers).and_then(|ip| state.audit_sender.hash_ip_from_str(&ip));
    let logged = async {
        let mut tx = state.db.begin().await?;
        log_email(&mut tx, &link, "code", &result, None).await?;
        if result.is_err() {
            // An undelivered code does not hold back the next one.
            sqlx::query(
                r#"UPDATE lead_payer_links
                   SET code_hash = NULL, code_sent_at = NULL, code_expires_at = NULL
                   WHERE id = $1 AND code_sent_at = $2"#,
            )
            .bind(link.id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        let writer = Writer::Link {
            link_id: link.id,
            ip_hash,
        };
        let context = match &result {
            Ok(_) => json!({}),
            Err(error) => json!({ "error_code": error.code() }),
        };
        audit::write_in_transaction(
            &mut tx,
            &writer.event(
                if result.is_ok() {
                    "payer_link_code_sent"
                } else {
                    "payer_link_code_failed"
                },
                "lead",
                link.lead_id,
                context,
            ),
        )
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(error) = logged {
        // The code may be on its way; the log row is what failed.
        tracing::error!(%error, lead_id = %link.lead_id, "log payer code e-mail");
    }
    publish(&state, None, link.lead_id, Some("payer")).await;
    match result {
        Ok(_) => (
            StatusCode::ACCEPTED,
            Json(json!({ "sent_at": now, "resend_after_seconds": CODE_RESEND_SECONDS })),
        )
            .into_response(),
        Err(error) => error_response(&error),
    }
}

/// Logs an e-mail of a link (metadata only).
async fn log_email(
    conn: &mut PgConnection,
    link: &Link,
    kind: &str,
    result: &Result<crate::mail::SentEmail, MailError>,
    sent_by: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let (status, message_id, error_code) = match result {
        Ok(sent) => ("sent", Some(sent.message_id.clone()), None),
        Err(error) => ("failed", None, Some(error.code())),
    };
    sqlx::query(
        r#"INSERT INTO lead_payer_link_emails
               (lead_id, link_id, kind, recipient, language, status, provider_message_id,
                error_code, sent_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
    )
    .bind(link.lead_id)
    .bind(link.id)
    .bind(kind)
    .bind(&link.email)
    .bind(&link.language)
    .bind(status)
    .bind(message_id)
    .bind(error_code)
    .bind(sent_by)
    .execute(&mut *conn)
    .await
    .map(|_| ())
}

/// 422 `code_expired`: no valid code. `reason` says why — `too_many_attempts`
/// when wrong tries used the code up, `expired` otherwise (none was sent, its
/// time passed, or it was used).
fn code_expired(too_many_attempts: bool) -> Response {
    let (reason, message) = if too_many_attempts {
        (
            "too_many_attempts",
            "Too many wrong tries; please ask for a new code",
        )
    } else {
        ("expired", "Please ask for a new code")
    };
    coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "code_expired",
        message,
        json!({ "reason": reason }),
    )
}

/// `POST /public/payer-link/verify` (3.3): checks the code; a right one
/// yields the session (a new one replaces the old), a wrong one counts.
async fn verify_code(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let code = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("code")
                .and_then(Value::as_str)
                .map(|code| code.trim().to_string())
        })
        .filter(|code| !code.is_empty());
    let Some(code) = code else {
        return invalid_field("code", "The code is missing");
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin payer verify"),
    };
    let link = match resolve_link(&mut tx, &headers).await {
        Ok(link) => link,
        Err(refusal) => return refusal.into_response(),
    };
    let now = Utc::now();
    let Some(expected) = link
        .code_hash
        .as_deref()
        .filter(|_| link.code_expires_at.is_some_and(|until| until > now))
    else {
        // A code used up by wrong tries keeps its count until the next code
        // (QA 2026-10-06: the page says why, not "expired").
        let used_up = link.code_hash.is_none() && link.code_attempts >= CODE_ATTEMPTS;
        return code_expired(used_up);
    };
    let writer = Writer::Link {
        link_id: link.id,
        ip_hash: client_ip(&headers).and_then(|ip| state.audit_sender.hash_ip_from_str(&ip)),
    };
    let right = code.len() == 6
        && code.bytes().all(|byte| byte.is_ascii_digit())
        && same_hash(&code_hash(link.id, &code), expected);
    if !right {
        let attempts = link.code_attempts + 1;
        let failed = link.failed_attempts + 1;
        let lock = failed >= LOCK_AFTER_FAILED;
        let void = lock || attempts >= CODE_ATTEMPTS;
        let counted = async {
            sqlx::query(
                r#"UPDATE lead_payer_links
                   SET code_attempts = $2, failed_attempts = $3,
                       code_hash = CASE WHEN $4 THEN NULL ELSE code_hash END,
                       code_expires_at = CASE WHEN $4 THEN NULL ELSE code_expires_at END,
                       locked_at = CASE WHEN $5 THEN $6 ELSE locked_at END,
                       session_hash = CASE WHEN $5 THEN NULL ELSE session_hash END,
                       session_expires_at = CASE WHEN $5 THEN NULL ELSE session_expires_at END
                   WHERE id = $1"#,
            )
            .bind(link.id)
            .bind(attempts)
            .bind(failed)
            .bind(void)
            .bind(lock)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            if lock {
                audit::write_in_transaction(
                    &mut tx,
                    &writer.event(
                        "payer_link_locked",
                        "lead",
                        link.lead_id,
                        json!({ "failed_attempts": failed }),
                    ),
                )
                .await?;
            }
            tx.commit().await
        }
        .await;
        if let Err(error) = counted {
            return intake::internal(error, "count wrong payer code");
        }
        if lock {
            publish(&state, None, link.lead_id, Some("payer")).await;
            return Refusal::LinkLocked.into_response();
        }
        if void {
            return code_expired(true);
        }
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "code_invalid",
            "The code is not correct",
            json!({ "attempts_left": CODE_ATTEMPTS - attempts }),
        );
    }
    let session = new_secret();
    let session_expires_at = now + Duration::minutes(SESSION_IDLE_MINUTES);
    let verified = async {
        sqlx::query(
            r#"UPDATE lead_payer_links
               SET code_hash = NULL, code_expires_at = NULL, code_attempts = 0,
                   session_hash = $2, session_expires_at = $3,
                   verified_at = COALESCE(verified_at, $4), last_seen_at = $4
               WHERE id = $1"#,
        )
        .bind(link.id)
        .bind(hash_token(&session))
        .bind(session_expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        // The statement belongs to this payer: the address the code went
        // to is confirmed.
        sqlx::query(
            r#"INSERT INTO lead_payer_statements
                   (lead_id, source, link_id, payer_key, confirmed_email, email_confirmed_at)
               VALUES ($1, 'link', $2, $3, $4, $5)
               ON CONFLICT (lead_id) DO UPDATE SET
                   source = 'link',
                   link_id = EXCLUDED.link_id,
                   payer_key = EXCLUDED.payer_key,
                   email_confirmed_at = CASE
                       WHEN lead_payer_statements.confirmed_email
                                IS DISTINCT FROM EXCLUDED.confirmed_email
                            OR lead_payer_statements.email_confirmed_at IS NULL
                           THEN EXCLUDED.email_confirmed_at
                       ELSE lead_payer_statements.email_confirmed_at
                   END,
                   confirmed_email = EXCLUDED.confirmed_email"#,
        )
        .bind(link.lead_id)
        .bind(link.id)
        .bind(&link.payer_key)
        .bind(&link.email)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &writer.event(
                "payer_link_verified",
                "lead",
                link.lead_id,
                json!({ "first": link.verified_at.is_none() }),
            ),
        )
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(error) = verified {
        return intake::internal(error, "verify payer code");
    }
    publish(&state, None, link.lead_id, Some("payer")).await;
    match questionnaire_json(&state, link.lead_id, Viewer::Payer).await {
        Ok(questionnaire) => Json(json!({
            "session": session,
            "session_expires_at": session_expires_at,
            "questionnaire": questionnaire,
        }))
        .into_response(),
        Err(error) => intake::internal(error, "load payer questionnaire"),
    }
}

/// `GET /public/payer-link/questionnaire`.
async fn get_questionnaire(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let (tx, link) = match payer_session(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer session");
    }
    questionnaire_response(&state, link.lead_id, Viewer::Payer, StatusCode::OK).await
}

fn link_writer(state: &AppState, link: &Link, headers: &HeaderMap) -> Writer {
    Writer::Link {
        link_id: link.id,
        ip_hash: client_ip(headers).and_then(|ip| state.audit_sender.hash_ip_from_str(&ip)),
    }
}

/// `POST /public/payer-link/consent`.
async fn give_consent(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let (mut tx, link) = match payer_session(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let context = match load_context(&mut tx, link.lead_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return Refusal::LinkRevoked.into_response(),
        Err(error) => return intake::internal(error, "load payer link lead"),
    };
    if context.statement.is_none()
        && let Err(error) = sqlx::query(
            r#"INSERT INTO lead_payer_statements
                   (lead_id, source, link_id, payer_key, confirmed_email, email_confirmed_at)
               VALUES ($1, 'link', $2, $3, $4, now())
               ON CONFLICT (lead_id) DO NOTHING"#,
        )
        .bind(link.lead_id)
        .bind(link.id)
        .bind(&link.payer_key)
        .bind(&link.email)
        .execute(&mut *tx)
        .await
    {
        return intake::internal(error, "create payer statement");
    }
    let writer = link_writer(&state, &link, &headers);
    let ip = client_ip(&headers);
    if let Err(response) = record_consent(
        &mut tx,
        &context,
        &writer,
        link.lead_id,
        &body,
        ip.as_deref(),
        Some(&link.language),
        None,
    )
    .await
    {
        return refuse(tx, response).await;
    }
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer consent");
    }
    publish(&state, None, link.lead_id, Some("payer")).await;
    questionnaire_response(&state, link.lead_id, Viewer::Payer, StatusCode::OK).await
}

/// `POST /public/payer-link/questionnaire`: autosave of the changed keys.
async fn patch_questionnaire(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let (mut tx, link) = match payer_session(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let context = match load_context(&mut tx, link.lead_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return Refusal::LinkRevoked.into_response(),
        Err(error) => return intake::internal(error, "load payer link lead"),
    };
    let writer = link_writer(&state, &link, &headers);
    let changed = match save_patch(
        &mut tx,
        &context,
        &writer,
        link.lead_id,
        &body,
        crate::app_time::today(),
    )
    .await
    {
        Ok(changed) => changed,
        Err(response) => return refuse(tx, response).await,
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer answers");
    }
    if changed {
        publish(&state, None, link.lead_id, Some("payer")).await;
    }
    questionnaire_response(&state, link.lead_id, Viewer::Payer, StatusCode::OK).await
}

async fn upload_identity_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Response {
    link_upload(state, headers, multipart, UploadKind::PayerIdentity).await
}

async fn upload_funds_proof(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Response {
    link_upload(state, headers, multipart, UploadKind::PayerFundsProof).await
}

/// `POST /public/payer-link/identity-document` and `…/funds-proof`: checked
/// under the session before the file is read, stored, and registered after
/// the same checks again (the stored file goes when they fail meanwhile).
async fn link_upload(
    state: AppState,
    headers: HeaderMap,
    mut multipart: Multipart,
    kind: UploadKind,
) -> Response {
    let (mut tx, link) = match payer_session(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let context = match load_context(&mut tx, link.lead_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return Refusal::LinkRevoked.into_response(),
        Err(error) => return intake::internal(error, "load payer link lead"),
    };
    if let Some(response) = upload_refusal(&context) {
        return refuse(tx, response).await;
    }
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer session");
    }
    // Only the payer's name is read here, which the check level does not touch.
    let built = questionnaire(
        &context,
        Viewer::Payer,
        &EnhancedCheck::default(),
        crate::app_time::today(),
    );
    let payer_name = built
        .answers
        .display_name(built.organisation)
        .unwrap_or_else(|| "payer".to_string());
    let file = match store_payer_file(
        &state,
        link.lead_id,
        kind,
        &payer_name,
        link.sent_by,
        "payer_link",
        &mut multipart,
    )
    .await
    {
        Ok(file) => file,
        Err(response) => return response,
    };
    let registered = async {
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|error| intake::internal(error, "begin payer upload"))?;
        let current = resolve_link(&mut tx, &headers)
            .await
            .map_err(Refusal::into_response)?;
        check_session(&current, &headers, Utc::now()).map_err(Refusal::into_response)?;
        let context = load_context(&mut tx, current.lead_id)
            .await
            .map_err(database)?
            .ok_or_else(|| Refusal::LinkRevoked.into_response())?;
        if let Some(response) = upload_refusal(&context) {
            return Err(response);
        }
        let writer = link_writer(&state, &current, &headers);
        register_payer_file(&mut tx, current.lead_id, kind, &writer, &file)
            .await
            .map_err(database)?;
        tx.commit().await.map_err(database)
    }
    .await;
    if let Err(response) = registered {
        intake::discard_stored_document(&state, file.document_id, &file.storage_key).await;
        return response;
    }
    publish(&state, None, link.lead_id, Some("payer")).await;
    questionnaire_response(&state, link.lead_id, Viewer::Payer, StatusCode::CREATED).await
}

/// `DELETE /public/payer-link/documents/{document_id}`: a file of the payer's
/// link that staff have not taken over, before the submit.
async fn withdraw_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(document_id): Path<Uuid>,
) -> Response {
    let (mut tx, link) = match payer_session(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    match payer_submitted_at(&mut tx, link.lead_id).await {
        Ok(None) => {}
        Ok(Some(_)) => return refuse(tx, already_submitted()).await,
        Err(error) => return intake::internal(error, "load payer statement"),
    }
    let upload = match sqlx::query(
        r#"SELECT u.reviewed_at, u.kind, d.storage_key, d.patient_id, d.lead_id, d.signed_at,
                  EXISTS(SELECT 1 FROM document_shares s WHERE s.document_id = d.id) AS shared,
                  EXISTS(SELECT 1 FROM document_review_events r WHERE r.document_id = d.id)
                      AS in_review
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.document_id = $1
             AND u.lead_id = $2
             AND u.access_kind = 'payer'
             AND u.kind IN ('payer_identity', 'payer_funds_proof')
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           FOR UPDATE OF u, d"#,
    )
    .bind(document_id)
    .bind(link.lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return refuse(
                tx,
                coded(
                    StatusCode::NOT_FOUND,
                    "not_found",
                    "Document not found",
                    json!({}),
                ),
            )
            .await;
        }
        Err(error) => return intake::internal(error, "lock payer upload"),
    };
    let in_use = intake::upload_taken_over(&upload)
        || upload
            .try_get::<Option<Uuid>, _>("patient_id")
            .ok()
            .flatten()
            .is_some()
        || upload.try_get::<Option<Uuid>, _>("lead_id").ok().flatten() != Some(link.lead_id)
        || upload.try_get::<bool, _>("shared").unwrap_or(true)
        || upload.try_get::<bool, _>("in_review").unwrap_or(true);
    if in_use {
        return refuse(
            tx,
            coded(
                StatusCode::CONFLICT,
                "upload_reviewed",
                "GMED has already taken over this document; ask GMED to remove it",
                json!({}),
            ),
        )
        .await;
    }
    let storage_key: Option<String> = upload.try_get("storage_key").ok().flatten();
    let kind: String = upload.try_get("kind").unwrap_or_default();
    let staged =
        match crate::routes::documents::stage_document_file_delete(storage_key.as_deref()).await {
            Ok(staged) => staged,
            Err(response) => return response,
        };
    let writer = link_writer(&state, &link, &headers);
    let result = async {
        sqlx::query(
            r#"UPDATE documents
               SET status = 'archived',
                   visibility = 'internal',
                   storage_key = NULL,
                   file_deleted_at = now(),
                   file_deleted_by = NULL,
                   file_delete_reason = 'Removed by the payer through the payer link before review'
               WHERE id = $1"#,
        )
        .bind(document_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE lead_portal_uploads SET withdrawn_at = now() WHERE document_id = $1")
            .bind(document_id)
            .execute(&mut *tx)
            .await?;
        audit::write_in_transaction(
            &mut tx,
            &writer.event(
                "payer_questionnaire_withdraw_upload",
                "document",
                document_id,
                json!({
                    "lead_id": link.lead_id,
                    "kind": kind,
                    "file_removed_from_disk": staged.is_some(),
                }),
            ),
        )
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(error) = result {
        if let Some(staged) = staged.as_ref() {
            crate::routes::documents::rollback_staged_document_delete(staged).await;
        }
        return intake::internal(error, "withdraw payer upload");
    }
    if let Some(staged) = staged.as_ref() {
        crate::routes::documents::finalize_staged_document_delete(staged).await;
    }
    publish(&state, None, link.lead_id, Some("payer")).await;
    questionnaire_response(&state, link.lead_id, Viewer::Payer, StatusCode::OK).await
}

/// `POST /public/payer-link/submit`.
async fn submit(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let (mut tx, link) = match payer_session(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let context = match load_context(&mut tx, link.lead_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return Refusal::LinkRevoked.into_response(),
        Err(error) => return intake::internal(error, "load payer link lead"),
    };
    let writer = link_writer(&state, &link, &headers);
    let level = match submit_in_tx(
        &mut tx,
        &context,
        &writer,
        Viewer::Payer,
        link.lead_id,
        declared_correct(&body),
    )
    .await
    {
        Ok(level) => level,
        Err(response) => return refuse(tx, response).await,
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer submit");
    }
    notify_submitted(&state, link.lead_id, level).await;
    publish(&state, None, link.lead_id, Some("payer")).await;
    questionnaire_response(&state, link.lead_id, Viewer::Payer, StatusCode::OK).await
}

// ----------------------------------------------------------------------------
// The paying parent's section of the lead cabinet (5.2)
// ----------------------------------------------------------------------------

/// The lead's context when `user_id` is the paying parent with a cabinet
/// login (`payment_route_by = guardian`); `None` otherwise (404).
fn parent_context(context: LeadContext, user_id: Uuid) -> Option<LeadContext> {
    let route_by = intake::payment_route_by(
        context.declaration.as_ref(),
        &context.loaded.representation,
        Some(user_id),
    );
    (context.open && route_by == PaymentRouteBy::Guardian).then_some(context)
}

/// `GET /me/lead-requests/{lead_id}/payer-questionnaire`.
async fn cabinet_get(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let found = async {
        let mut conn = state.db.acquire().await?;
        Ok::<_, sqlx::Error>(
            load_context(&mut conn, lead_id)
                .await?
                .and_then(|context| parent_context(context, auth.user_id))
                .is_some(),
        )
    }
    .await;
    match found {
        Ok(true) => {
            questionnaire_response(
                &state,
                lead_id,
                Viewer::Parent(auth.user_id),
                StatusCode::OK,
            )
            .await
        }
        Ok(false) => intake::not_found(),
        Err(error) => intake::internal(error, "load payer questionnaire"),
    }
}

/// Locks the caller's lead and returns its context while the caller is the
/// paying parent.
async fn lock_parent(
    tx: &mut Transaction<'static, Postgres>,
    lead_id: Uuid,
    user_id: Uuid,
) -> Result<LeadContext, Response> {
    match intake::lock_my_lead(tx, lead_id, user_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return Err(intake::not_found()),
        Err(error) => return Err(intake::internal(error, "lock request")),
    }
    let context = load_context(tx, lead_id)
        .await
        .map_err(|error| intake::internal(error, "load payer questionnaire"))?
        .ok_or_else(intake::not_found)?;
    parent_context(context, user_id).ok_or_else(intake::not_found)
}

/// `POST /me/lead-requests/{lead_id}/payer-questionnaire`.
async fn cabinet_patch(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    body: Bytes,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let context = match lock_parent(&mut tx, lead_id, auth.user_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    let writer = Writer::Parent {
        user_id: auth.user_id,
    };
    let changed = match save_patch(
        &mut tx,
        &context,
        &writer,
        lead_id,
        &body,
        crate::app_time::today(),
    )
    .await
    {
        Ok(changed) => changed,
        Err(response) => return response,
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer answers");
    }
    if changed {
        publish(&state, Some(auth.user_id), lead_id, Some("guardian")).await;
    }
    questionnaire_response(
        &state,
        lead_id,
        Viewer::Parent(auth.user_id),
        StatusCode::OK,
    )
    .await
}

/// `POST /me/lead-requests/{lead_id}/payer-questionnaire/consent`: the
/// paying parent acknowledges the payer's privacy notice once more (owner
/// default 8.12); the confirmed address is the declaration's, else the
/// login's.
async fn cabinet_consent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let context = match lock_parent(&mut tx, lead_id, auth.user_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    let declaration = context.declaration.clone().unwrap_or_default();
    let login_email: Option<String> =
        match sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(auth.user_id)
            .fetch_optional(&mut *tx)
            .await
        {
            Ok(email) => email,
            Err(error) => return intake::internal(error, "load login e-mail"),
        };
    let confirmed_email = declaration
        .email
        .clone()
        .filter(|email| is_plausible_email(email))
        .or(login_email);
    if let Err(error) = sqlx::query(
        r#"INSERT INTO lead_payer_statements
               (lead_id, source, payer_key, confirmed_email, email_confirmed_at, answered_by_user)
           VALUES ($1, 'cabinet', $2, $3, now(), $4)
           ON CONFLICT (lead_id) DO UPDATE SET
               source = 'cabinet',
               payer_key = EXCLUDED.payer_key,
               confirmed_email = COALESCE(lead_payer_statements.confirmed_email,
                                          EXCLUDED.confirmed_email),
               email_confirmed_at = COALESCE(lead_payer_statements.email_confirmed_at,
                                             EXCLUDED.email_confirmed_at)"#,
    )
    .bind(lead_id)
    .bind(declaration.payer_key())
    .bind(confirmed_email)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return intake::internal(error, "create payer statement");
    }
    // The paying parent read the payer's notice: the payer is informed
    // (Art. 13/14 DSGVO), recorded once like the link's invitation does —
    // by the parent's login. Rolled back with the consent if that fails.
    let informed = match sqlx::query(
        r#"UPDATE lead_payer_declarations
           SET payer_informed_at = now(), payer_informed_by = $2, updated_at = now()
           WHERE lead_id = $1 AND payer_informed_at IS NULL"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        Ok(done) => done.rows_affected() > 0,
        Err(error) => return intake::internal(error, "record payer informed"),
    };
    let writer = Writer::Parent {
        user_id: auth.user_id,
    };
    let ip = client_ip(&headers);
    if let Err(response) = record_consent(
        &mut tx,
        &context,
        &writer,
        lead_id,
        &body,
        ip.as_deref(),
        None,
        Some(informed),
    )
    .await
    {
        return response;
    }
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer consent");
    }
    publish(&state, Some(auth.user_id), lead_id, Some("guardian")).await;
    questionnaire_response(
        &state,
        lead_id,
        Viewer::Parent(auth.user_id),
        StatusCode::OK,
    )
    .await
}

/// `POST /me/lead-requests/{lead_id}/payer-questionnaire/funds-proof`: the
/// paying parent's proof of funds. Withdrawn through the cabinet's DELETE.
async fn cabinet_funds_proof(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let checked = async {
        let mut conn = state.db.acquire().await.map_err(database)?;
        let context = load_context(&mut conn, lead_id)
            .await
            .map_err(database)?
            .and_then(|context| parent_context(context, auth.user_id))
            .ok_or_else(intake::not_found)?;
        if let Some(response) = upload_refusal(&context) {
            return Err(response);
        }
        Ok(context)
    }
    .await;
    let context = match checked {
        Ok(context) => context,
        Err(response) => return response,
    };
    // Only the parent's name is read here, which the check level does not touch.
    let built = questionnaire(
        &context,
        Viewer::Parent(auth.user_id),
        &EnhancedCheck::default(),
        crate::app_time::today(),
    );
    let payer_name = built
        .answers
        .display_name(false)
        .unwrap_or_else(|| "payer".to_string());
    let kind = UploadKind::PayerFundsProof;
    let file = match store_payer_file(
        &state,
        lead_id,
        kind,
        &payer_name,
        auth.user_id,
        "lead_portal",
        &mut multipart,
    )
    .await
    {
        Ok(file) => file,
        Err(response) => return response,
    };
    let registered = async {
        let mut tx = state.db.begin().await.map_err(database)?;
        let context = lock_parent(&mut tx, lead_id, auth.user_id).await?;
        if let Some(response) = upload_refusal(&context) {
            return Err(response);
        }
        let writer = Writer::Parent {
            user_id: auth.user_id,
        };
        register_payer_file(&mut tx, lead_id, kind, &writer, &file)
            .await
            .map_err(database)?;
        tx.commit().await.map_err(database)
    }
    .await;
    if let Err(response) = registered {
        intake::discard_stored_document(&state, file.document_id, &file.storage_key).await;
        return response;
    }
    publish(&state, Some(auth.user_id), lead_id, Some("guardian")).await;
    questionnaire_response(
        &state,
        lead_id,
        Viewer::Parent(auth.user_id),
        StatusCode::CREATED,
    )
    .await
}

/// `POST /me/lead-requests/{lead_id}/payer-questionnaire/submit`.
async fn cabinet_submit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    body: Bytes,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let context = match lock_parent(&mut tx, lead_id, auth.user_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    let writer = Writer::Parent {
        user_id: auth.user_id,
    };
    let level = match submit_in_tx(
        &mut tx,
        &context,
        &writer,
        Viewer::Parent(auth.user_id),
        lead_id,
        declared_correct(&body),
    )
    .await
    {
        Ok(level) => level,
        Err(response) => return response,
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer submit");
    }
    notify_submitted(&state, lead_id, level).await;
    publish(&state, Some(auth.user_id), lead_id, Some("guardian")).await;
    questionnaire_response(
        &state,
        lead_id,
        Viewer::Parent(auth.user_id),
        StatusCode::OK,
    )
    .await
}

// ----------------------------------------------------------------------------
// Staff
// ----------------------------------------------------------------------------

async fn mail_available(state: &AppState) -> bool {
    current_mailer(state)
        .await
        .is_ok_and(|mailer| mailer.capability().available && mailer.console_url().is_some())
}

/// The newest link of a lead (revoked or not), who sent it and how its last
/// invitation went.
async fn newest_link(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<(Link, Option<String>, Option<String>)>, sqlx::Error> {
    let Some(row) = sqlx::query(&format!(
        r#"SELECT {LINK_COLUMNS}, u.name AS sent_by_name,
                  (SELECT e.status FROM lead_payer_link_emails e
                   WHERE e.link_id = k.id AND e.kind = 'invitation'
                   ORDER BY e.created_at DESC LIMIT 1) AS last_email_status
           FROM lead_payer_links k
           LEFT JOIN users u ON u.id = k.sent_by
           WHERE k.lead_id = $1
           ORDER BY k.created_at DESC, k.id DESC
           LIMIT 1"#
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    Ok(Some((
        Link::from_row(&row)?,
        row.try_get::<Option<String>, _>("sent_by_name")
            .ok()
            .flatten(),
        row.try_get::<Option<String>, _>("last_email_status")
            .ok()
            .flatten(),
    )))
}

/// `GET /leads/{id}/payer-link` (4.2).
async fn staff_payload(state: &AppState, auth: &AuthUser, lead_id: Uuid) -> Response {
    let loaded = async {
        let mut conn = state.db.acquire().await?;
        let Some(context) = load_context(&mut conn, lead_id).await? else {
            return Ok(None);
        };
        let link = newest_link(&mut conn, lead_id).await?;
        let check = lead_enhanced_check::enhanced_check_triggers(&mut conn, lead_id).await?;
        Ok::<_, sqlx::Error>(Some((context, link, check)))
    }
    .await;
    let (context, link, check) = match loaded {
        Ok(Some(found)) => found,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "load payer link"),
    };
    let mail_available = mail_available(state).await;
    let blocked_reason = context.blocked_reason();
    let now = Utc::now();
    let link_json = link.map(|(link, sent_by_name, last_email_status)| {
        json!({
            "status": link.status(context.statement.as_ref(), now),
            "email": link.email,
            "language": link.language,
            "sent_at": link.created_at,
            "sent_by_name": sent_by_name,
            "expires_at": link.expires_at,
            "opened_at": link.opened_at,
            "verified_at": link.verified_at,
            "revoked_at": link.revoked_at,
            "revoked_reason": link.revoked_reason,
            "last_email_status": last_email_status,
        })
    });
    let questionnaire_value = context.statement.as_ref().map(|_| {
        questionnaire(&context, Viewer::Staff, &check, crate::app_time::today()).to_staff_json()
    });
    Json(json!({
        "mode": context.mode().map(Mode::as_str),
        "can_send": blocked_reason.is_none() && mail_available && auth.can(Capability::LeadsEdit),
        "blocked_reason": blocked_reason,
        "mail_available": mail_available,
        "link": link_json,
        // Information for staff only: the expected total never asks for
        // the proof of funds (owner rule 2026-10-07).
        "estimated_total_eur": context
            .statement
            .as_ref()
            .and_then(|statement| statement.estimated_total_cents)
            .map(cents_text),
        "questionnaire": questionnaire_value,
    }))
    .into_response()
}

async fn staff_get(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !lead_payer::may_view(&auth) {
        return intake::err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    staff_payload(&state, &auth, lead_id).await
}

/// Locks the lead row for a staff write; `None` for an unknown lead.
async fn lock_lead(conn: &mut PgConnection, lead_id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM leads WHERE id = $1 FOR UPDATE")
            .bind(lead_id)
            .fetch_optional(&mut *conn)
            .await?
            .is_some(),
    )
}

/// `POST /leads/{id}/payer-link` (4.2): sends or resends the link. The
/// previous link is revoked, a new one is stored and mailed; a failed
/// e-mail revokes it again (`email_failed`). A sent invitation records that
/// the payer was informed (Art. 14 notice) unless that is recorded already.
async fn staff_send(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    body: Bytes,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let body: Value = if body.iter().all(u8::is_ascii_whitespace) {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(_) => return invalid_field("body", "A JSON object is expected"),
        }
    };
    let language = match body.get("language") {
        None | Some(Value::Null) => None,
        Some(Value::String(language)) if LANGUAGES.contains(&language.trim()) => {
            Some(language.trim().to_string())
        }
        Some(_) => return invalid_field("language", "Not one of the languages"),
    };
    let reopen = body.get("reopen").and_then(Value::as_bool).unwrap_or(false);
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin payer link"),
    };
    match lock_lead(&mut tx, lead_id).await {
        Ok(true) => {}
        Ok(false) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "lock lead"),
    }
    let context = match load_context(&mut tx, lead_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "load payer link"),
    };
    if let Some(reason) = context.blocked_reason() {
        return coded(
            StatusCode::CONFLICT,
            reason,
            "The payer link cannot be sent now",
            json!({}),
        );
    }
    let Some(declaration) = context.third_party().cloned() else {
        return coded(
            StatusCode::CONFLICT,
            "no_third_party",
            "No third party pays",
            json!({}),
        );
    };
    if context.submitted_at().is_some() && !reopen {
        return coded(
            StatusCode::CONFLICT,
            "payer_already_submitted",
            "The payer has sent the answers; reopen them to send the link again",
            json!({}),
        );
    }
    // Without a working mailer nothing is revoked or stored (the same answer
    // as the sign-in e-mail gives).
    let mailer = match current_mailer(&state).await {
        Ok(mailer) => mailer,
        Err(code) => return mail_unavailable(code),
    };
    let Some(console_url) = mailer.console_url().map(str::to_string) else {
        return error_response(&MailError::NotConfigured);
    };
    if context.submitted_at().is_some() {
        // Reopened for corrections: the answers stay, the confirmation goes.
        if let Err(error) = sqlx::query(
            r#"UPDATE lead_payer_statements
               SET submitted_at = NULL, declared_correct_at = NULL
               WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .execute(&mut *tx)
        .await
        {
            return intake::internal(error, "reopen payer statement");
        }
    }
    if let Err(error) = revoke_active(&mut tx, lead_id, "resent", Some(auth.user_id)).await {
        return intake::internal(error, "revoke payer link");
    }
    let language = language
        .or_else(|| {
            context
                .statement
                .as_ref()
                .and_then(|statement| statement.answers.language.clone())
        })
        .unwrap_or_else(|| {
            MailLanguage::from_code(context.primary_language.as_deref())
                .code()
                .to_string()
        });
    let token = new_secret();
    let email = declaration
        .email
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();
    let inserted = sqlx::query(&format!(
        r#"INSERT INTO lead_payer_links AS k
               (lead_id, token_hash, email, language, payer_key, sent_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
           RETURNING {LINK_COLUMNS}"#
    ))
    .bind(lead_id)
    .bind(hash_token(&token))
    .bind(email)
    .bind(language)
    .bind(declaration.payer_key())
    .bind(auth.user_id)
    .bind(LINK_VALID_DAYS as i32)
    .fetch_one(&mut *tx)
    .await
    .and_then(|row| Link::from_row(&row));
    let link = match inserted {
        Ok(link) => link,
        Err(error) => return intake::internal(error, "store payer link"),
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer link");
    }

    let agency = crate::mail::agency_identity(&state.db).await;
    let logo_url = templates::logo_url(&console_url);
    let link_url = format!("{console_url}/payer#{token}");
    let privacy_url = format!("{console_url}/legal#privacy");
    let mail_language = MailLanguage::from_code(Some(&link.language));
    let rendered = templates::payer_invitation(&PayerInvitationEmail {
        language: mail_language,
        payer_name: declaration.payer_name().as_deref().unwrap_or_default(),
        organisation: declaration.is_organisation(),
        patient_name: &context.patient_name,
        link_url: &link_url,
        expires_on: crate::app_time::date_of(link.expires_at),
        privacy_url: &privacy_url,
        agency: &agency,
        logo_url: Some(&logo_url),
    });
    let outgoing = OutgoingEmail {
        to: link.email.clone(),
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotency_key: format!("payer-link:{}:{}", link.id, mail_language.code()),
    };
    let result = mailer.send(&outgoing).await;
    let logged = async {
        let mut tx = state.db.begin().await?;
        log_email(&mut tx, &link, "invitation", &result, Some(auth.user_id)).await?;
        match &result {
            Ok(_) => {
                let informed = sqlx::query(
                    r#"UPDATE lead_payer_declarations
                       SET payer_informed_at = now(), payer_informed_by = $2, updated_at = now()
                       WHERE lead_id = $1 AND payer_informed_at IS NULL"#,
                )
                .bind(lead_id)
                .bind(auth.user_id)
                .execute(&mut *tx)
                .await?
                .rows_affected()
                    > 0;
                audit::write_in_transaction(
                    &mut tx,
                    &audit::domain_event(
                        "payer_link_sent",
                        Some(auth.user_id),
                        "lead",
                        Some(lead_id),
                        json!({
                            "link_id": link.id,
                            "language": link.language,
                            "payer_informed_recorded": informed,
                            "reopened": reopen,
                        }),
                    ),
                )
                .await?;
            }
            Err(error) => {
                sqlx::query(
                    r#"UPDATE lead_payer_links
                       SET revoked_at = now(), revoked_by = $2, revoked_reason = 'email_failed'
                       WHERE id = $1 AND revoked_at IS NULL"#,
                )
                .bind(link.id)
                .bind(auth.user_id)
                .execute(&mut *tx)
                .await?;
                audit::write_in_transaction(
                    &mut tx,
                    &audit::domain_event(
                        "payer_link_send_failed",
                        Some(auth.user_id),
                        "lead",
                        Some(lead_id),
                        json!({ "link_id": link.id, "error_code": error.code() }),
                    ),
                )
                .await?;
            }
        }
        tx.commit().await
    }
    .await;
    if let Err(error) = logged {
        tracing::error!(%error, %lead_id, "log payer link e-mail");
        if result.is_err() {
            // The link must not stay live without its e-mail.
            let _ = sqlx::query(
                r#"UPDATE lead_payer_links
                   SET revoked_at = now(), revoked_by = $2, revoked_reason = 'email_failed'
                   WHERE id = $1 AND revoked_at IS NULL"#,
            )
            .bind(link.id)
            .bind(auth.user_id)
            .execute(&state.db)
            .await;
        }
    }
    publish(&state, Some(auth.user_id), lead_id, None).await;
    match result {
        Ok(_) => staff_payload(&state, &auth, lead_id).await,
        Err(error) => error_response(&error),
    }
}

/// `POST /leads/{id}/payer-link/revoke`.
async fn staff_revoke(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin payer link"),
    };
    let context = match lock_lead(&mut tx, lead_id).await {
        Ok(true) => match load_context(&mut tx, lead_id).await {
            Ok(Some(context)) => context,
            Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
            Err(error) => return intake::internal(error, "load payer link"),
        },
        Ok(false) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "lock lead"),
    };
    if context.converted {
        return coded(
            StatusCode::CONFLICT,
            "lead_converted",
            "The lead is converted",
            json!({}),
        );
    }
    let revoked = match revoke_active(&mut tx, lead_id, "staff_revoked", Some(auth.user_id)).await {
        Ok(revoked) => revoked,
        Err(error) => return intake::internal(error, "revoke payer link"),
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit payer link");
    }
    if !revoked.is_empty() {
        publish(&state, Some(auth.user_id), lead_id, None).await;
    }
    staff_payload(&state, &auth, lead_id).await
}

/// `POST /leads/{id}/payer-link/estimated-total`: staff's expected total of
/// the request (EUR, two decimals, or `null`).
async fn staff_estimated_total(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    body: Bytes,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let value: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => return invalid_field("body", "A JSON object is expected"),
    };
    let cents = match value.get("estimated_total_eur") {
        None => return invalid_field("estimated_total_eur", "The expected total is missing"),
        Some(Value::Null) => None,
        Some(Value::String(text)) if text.trim().is_empty() => None,
        Some(total) => match cents_of(total, MAX_TOTAL_CENTS) {
            Some(cents) => Some(cents),
            None => {
                return invalid_field(
                    "estimated_total_eur",
                    "Use an amount in EUR with at most two decimals",
                );
            }
        },
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin payer estimate"),
    };
    let context = match lock_lead(&mut tx, lead_id).await {
        Ok(true) => match load_context(&mut tx, lead_id).await {
            Ok(Some(context)) => context,
            Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
            Err(error) => return intake::internal(error, "load payer link"),
        },
        Ok(false) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "lock lead"),
    };
    if context.converted {
        return coded(
            StatusCode::CONFLICT,
            "lead_converted",
            "The lead is converted",
            json!({}),
        );
    }
    let before = context
        .statement
        .as_ref()
        .and_then(|statement| statement.estimated_total_cents);
    if before != cents {
        let stored = async {
            sqlx::query(
                r#"INSERT INTO lead_payer_statements (lead_id, source, estimated_total_eur)
                   VALUES ($1, 'link', $2::numeric)
                   ON CONFLICT (lead_id) DO UPDATE
                   SET estimated_total_eur = EXCLUDED.estimated_total_eur"#,
            )
            .bind(lead_id)
            .bind(cents.map(cents_text))
            .execute(&mut *tx)
            .await?;
            audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    "payer_estimated_total_updated",
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    json!({ "set": cents.is_some() }),
                ),
            )
            .await?;
            // The lead's value counts for the risk assessment (T10, T11).
            crate::risk::store::reassess(
                &mut tx,
                lead_id,
                crate::risk::store::Cause::Staff,
                Some(auth.user_id),
            )
            .await?;
            tx.commit().await
        }
        .await;
        if let Err(error) = stored {
            return intake::internal(error, "store payer estimate");
        }
        publish(&state, Some(auth.user_id), lead_id, None).await;
    }
    staff_payload(&state, &auth, lead_id).await
}

// ----------------------------------------------------------------------------
// Hooks of the other modules
// ----------------------------------------------------------------------------

/// Whether this payer was informed through its own channel: a link with it
/// was ever mailed successfully for the lead (the invitation carries the
/// notice), or the paying parent acknowledged the payer's notice in the
/// cabinet. The staff save keeps the record either way.
pub(crate) async fn link_sent_for(
    conn: &mut PgConnection,
    lead_id: Uuid,
    payer_key: &Value,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM lead_payer_links k
               JOIN lead_payer_link_emails e
                 ON e.link_id = k.id AND e.kind = 'invitation' AND e.status = 'sent'
               WHERE k.lead_id = $1 AND k.payer_key = $2
           ) OR EXISTS(
               SELECT 1 FROM lead_payer_statements s
               WHERE s.lead_id = $1 AND s.source = 'cabinet'
                 AND s.privacy_ack_at IS NOT NULL AND s.payer_key = $2
           )"#,
    )
    .bind(lead_id)
    .bind(payer_key)
    .fetch_one(&mut *conn)
    .await
}

/// Whether the payer named in `declaration` answered through its own link
/// (QA 2026-10-06): the statement came from the link, was sent — or was
/// adopted and is reopened for corrections — and belongs to this payer. Its
/// identity is then the payer's own statement: the lead's cabinet shows only
/// the name, type and relationship and no longer changes the payer (staff
/// do).
///
/// The declaration's own record of the adoption counts independently of the
/// statement (QA retest 2026-10-06, R2-a): staff changing only the payer's
/// e-mail reset the statement, but the declaration still holds the identity
/// the payer stated, which the lead never entered. Only another payer (staff
/// change the name, the date of birth or the type) lifts the lock.
pub(crate) async fn answered_by_payer(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: Option<&Declaration>,
) -> Result<bool, sqlx::Error> {
    let Some(declaration) = declaration.filter(|declaration| declaration.is_third_party()) else {
        return Ok(false);
    };
    if declaration.identity_adopted_for_current_payer() {
        return Ok(true);
    }
    let payer_key = sqlx::query_scalar::<_, Option<Value>>(
        r#"SELECT payer_key FROM lead_payer_statements
           WHERE lead_id = $1 AND source = 'link'
             AND (submitted_at IS NOT NULL OR adopted_at IS NOT NULL)"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    Ok(payer_key.is_some_and(|key| key == declaration.payer_key()))
}

/// When the payer's answers were sent, if they are.
pub(crate) async fn payer_submitted_at(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT submitted_at FROM lead_payer_statements WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    .flatten())
}

/// Whether staff may send the payer's link now (D3); for the notification
/// after the lead's "send to the manager".
pub(crate) async fn link_can_be_sent(state: &AppState, lead_id: Uuid) -> Result<bool, sqlx::Error> {
    let mut conn = state.db.acquire().await?;
    Ok(load_context(&mut conn, lead_id)
        .await?
        .is_some_and(|context| context.blocked_reason().is_none()))
}

/// D10: the declaration changed (called after it is stored, in the same
/// transaction). Another payer (kind or key): the active link is revoked
/// (`payer_changed`), the statement's answers are cleared — all but staff's
/// expected total — and the payer's files are withdrawn (the documents stay
/// with the lead).
///
/// The same payer at another address: the link is revoked
/// (`email_changed`). When that payer answers through its own link (not a
/// paying parent with a cabinet login), the change counts as another payer
/// as well (QA 2026-10-06): whoever holds the new address must not see what
/// the holder of the old one stated — the answers are cleared and the files
/// withdrawn like above, and section 8 of the declaration, which the payer
/// answered through the link, is cleared too (in `next` and in the stored
/// row, so the caller's audit diff shows it).
pub(crate) async fn payer_changed_in_tx(
    conn: &mut PgConnection,
    lead_id: Uuid,
    previous: Option<&Declaration>,
    next: &mut Declaration,
    actor: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let Some(previous) = previous else {
        return Ok(());
    };
    let payer_changed = previous.payer_kind != next.payer_kind
        || (next.is_third_party() && previous.payer_key() != next.payer_key());
    if payer_changed {
        revoke_active(conn, lead_id, "payer_changed", actor).await?;
        return reset_statement(conn, lead_id, "payer_changed", actor, &[]).await;
    }
    if !next.is_third_party()
        || normalized_email(previous.email.as_deref()) == normalized_email(next.email.as_deref())
    {
        return Ok(());
    }
    revoke_active(conn, lead_id, "email_changed", actor).await?;
    let representation = lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    let route_by = intake::payment_route_by(Some(&*next), &representation.representation, None);
    if route_by != PaymentRouteBy::Payer {
        // A paying parent with a cabinet login answers in the cabinet; no
        // link reaches anybody else.
        return Ok(());
    }
    let route_cleared = next.take_payment_route();
    if !route_cleared.is_empty() {
        sqlx::query(
            r#"UPDATE lead_payer_declarations
               SET payment_method = NULL, payment_method_details = NULL,
                   account_country = NULL, account_holder = NULL, bank_name = NULL,
                   via_third_party = NULL, via_third_party_details = NULL,
                   updated_at = now()
               WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .execute(&mut *conn)
        .await?;
    }
    reset_statement(conn, lead_id, "email_changed", actor, &route_cleared).await
}

/// Clears the payer's answers (all but staff's expected total, with the
/// privacy acknowledgement, the confirmed address and the submit), withdraws
/// the payer's files and audits the reset with the field names of section 8
/// that went with it.
async fn reset_statement(
    conn: &mut PgConnection,
    lead_id: Uuid,
    reason: &str,
    actor: Option<Uuid>,
    payment_route_cleared: &[&'static str],
) -> Result<(), sqlx::Error> {
    let cleared: Option<bool> = sqlx::query_scalar(
        r#"UPDATE lead_payer_statements
               SET answered_by_user = NULL, link_id = NULL, payer_key = NULL,
                   privacy_ack_at = NULL, privacy_text_version = NULL, privacy_language = NULL,
                   privacy_ip = NULL, contact_channels = '{}', confirmed_email = NULL,
                   email_confirmed_at = NULL, salutation = NULL, first_name = NULL,
                   last_name = NULL, former_names = NULL, date_of_birth = NULL,
                   birth_place = NULL, birth_country = NULL, citizenships = '{}',
                   street = NULL, city = NULL, zip = NULL, country = NULL,
                   habitual_residence_country = NULL, phone = NULL, language = NULL,
                   id_document_type = NULL, id_document_number = NULL,
                   id_issuing_authority = NULL, id_issuing_country = NULL,
                   id_issued_on = NULL, id_valid_until = NULL, organisation_name = NULL,
                   register_court = NULL, register_number = NULL,
                   representative_first_name = NULL, representative_last_name = NULL,
                   representative_role = NULL, beneficial_owners = '[]'::jsonb,
                   beneficial_owners_none = NULL, relationship_kind = NULL,
                   relationship = NULL, occupation = NULL, industry = NULL,
                   funds_sources = '{}', funds_description = NULL, pep_self = NULL,
                   pep_self_details = NULL, pep_related = NULL, pep_related_details = NULL,
                   high_risk_country = NULL, high_risk_country_code = NULL,
                   sanctions_links = NULL, sanctions_links_details = NULL,
                   legal_form = NULL, vat_id = NULL, payment_reason = NULL,
                   declared_correct_at = NULL, submitted_at = NULL, adopted_at = NULL,
                   updated_at = now()
               WHERE lead_id = $1
               RETURNING true"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let withdrawn = sqlx::query(
        r#"UPDATE lead_portal_uploads SET withdrawn_at = now()
               WHERE lead_id = $1
                 AND kind IN ('payer_identity', 'payer_funds_proof')
                 AND withdrawn_at IS NULL"#,
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if cleared.is_some() || withdrawn > 0 || !payment_route_cleared.is_empty() {
        audit::write_in_transaction(
            conn,
            &audit::domain_event(
                "payer_questionnaire_reset",
                actor,
                "lead",
                Some(lead_id),
                json!({
                    "reason": reason,
                    "withdrawn_uploads": withdrawn,
                    "payment_route_cleared": payment_route_cleared,
                }),
            ),
        )
        .await?;
    }
    Ok(())
}

/// Conversion: the link ends (`lead_converted`); the statement stays with the
/// lead as GwG evidence.
pub(crate) async fn revoke_for_conversion(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    revoke_active(conn, lead_id, "lead_converted", Some(actor))
        .await
        .map(|_| ())
}

/// The purge of an unconverted lead: the statement, the links with their
/// e-mails and the payer's signature packages (phase 3b; their documents
/// follow the lead's documents). A converted lead keeps them (§ 8 Abs. 4
/// GwG).
pub(crate) async fn purge_in_tx(conn: &mut PgConnection, lead_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM lead_payer_signature_packages payer_package
           USING leads lead
           WHERE payer_package.lead_id = $1
             AND lead.id = payer_package.lead_id
             AND lead.converted_patient_id IS NULL"#,
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        r#"DELETE FROM lead_payer_statements payer_statement
           USING leads lead
           WHERE payer_statement.lead_id = $1
             AND lead.id = payer_statement.lead_id
             AND lead.converted_patient_id IS NULL"#,
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        r#"DELETE FROM lead_payer_links payer_link
           USING leads lead
           WHERE payer_link.lead_id = $1
             AND lead.id = payer_link.lead_id
             AND lead.converted_patient_id IS NULL"#,
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The payer's answers as sent (D9), the start of phase 3b (the
/// Kostenübernahmeerklärung with QES).
#[allow(dead_code)]
pub(crate) struct SubmittedPayer {
    pub email: String,
    pub submitted_at: DateTime<Utc>,
    /// `link` or `cabinet`.
    pub source: String,
    pub link_id: Option<Uuid>,
}

/// The payer of a lead who has sent the answers, if any.
pub(crate) async fn submitted_payer(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<SubmittedPayer>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT confirmed_email, submitted_at, source, link_id
           FROM lead_payer_statements
           WHERE lead_id = $1 AND submitted_at IS NOT NULL"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.and_then(|row| {
        Some(SubmittedPayer {
            email: row
                .try_get::<Option<String>, _>("confirmed_email")
                .ok()
                .flatten()?,
            submitted_at: row.try_get("submitted_at").ok()?,
            source: row.try_get("source").ok()?,
            link_id: row.try_get::<Option<Uuid>, _>("link_id").ok().flatten(),
        })
    }))
}

/// The third-party payer as its signature package sees it (phase 3b): how it
/// answers, whether and when its answers were sent, and who signs — the
/// payer, the paying parent, or the legal representative of an organisation
/// with the organisation it acts for. The e-mail is always the confirmed
/// address of the statement.
pub(crate) struct PackageSubject {
    /// `link` or `cabinet`.
    pub mode: &'static str,
    pub submitted_at: Option<DateTime<Utc>>,
    pub confirmed_email: Option<String>,
    pub signer_first_name: Option<String>,
    pub signer_last_name: Option<String>,
    pub acting_for: Option<String>,
    /// The function of an organisation's legal representative.
    pub signer_role: Option<String>,
    /// The language the payer chose (`de`, `en`, `uk`, `ru`), if any.
    pub language: Option<String>,
}

/// `None` while the declaration names no third party.
pub(crate) async fn package_subject(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<PackageSubject>, sqlx::Error> {
    let Some(context) = load_context(conn, lead_id).await? else {
        return Ok(None);
    };
    let Some(mode) = context.mode() else {
        return Ok(None);
    };
    // Only the answers are needed here, not the check level.
    let built = questionnaire(
        &context,
        Viewer::Staff,
        &EnhancedCheck::default(),
        crate::app_time::today(),
    );
    let answers = &built.answers;
    let (first_name, last_name, acting_for, role) = if built.organisation {
        (
            answers.representative_first_name.clone(),
            answers.representative_last_name.clone(),
            answers.display_name(true).or_else(|| {
                context
                    .declaration
                    .as_ref()
                    .and_then(|declaration| declaration.organisation_name.clone())
            }),
            answers.representative_role.clone(),
        )
    } else {
        (
            answers.first_name.clone(),
            answers.last_name.clone(),
            None,
            None,
        )
    };
    let statement = context.statement.as_ref();
    Ok(Some(PackageSubject {
        mode: mode.as_str(),
        submitted_at: statement.and_then(|statement| statement.submitted_at),
        confirmed_email: statement
            .and_then(|statement| normalized_email(statement.confirmed_email.as_deref())),
        signer_first_name: first_name,
        signer_last_name: last_name,
        acting_for,
        signer_role: role,
        language: answers.language.clone(),
    }))
}

/// One beneficial owner of an organisation as the self-disclosure prints it.
#[derive(Clone, Debug, Default)]
pub(crate) struct PayerOwnerLine {
    pub name: String,
    pub date_of_birth: Option<NaiveDate>,
    pub birth_place: Option<String>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    /// "25.00".
    pub share_percent: String,
}

/// What the payer sent, for its self-disclosure ("Selbstauskunft der
/// zahlenden Person", phase 3b): the effective answers of the submitted
/// statement (a paying parent's person and identity document are the
/// representative's), the payment route of the declaration, whether the
/// copies were sent and the privacy acknowledgement. Never the check level or
/// anything staff assessed.
#[derive(Clone, Debug, Default)]
pub(crate) struct PayerSelfDisclosure {
    /// `link` or `cabinet`.
    pub mode: &'static str,
    pub organisation: bool,
    pub payer_type: String,
    pub submitted_at: DateTime<Utc>,
    pub confirmed_email: Option<String>,
    pub salutation: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub former_names: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub birth_place: Option<String>,
    pub birth_country: Option<String>,
    pub citizenships: Vec<String>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub habitual_residence_country: Option<String>,
    pub phone: Option<String>,
    pub occupation: Option<String>,
    pub organisation_name: Option<String>,
    pub register_court: Option<String>,
    pub register_number: Option<String>,
    pub industry: Option<String>,
    pub representative_first_name: Option<String>,
    pub representative_last_name: Option<String>,
    pub representative_role: Option<String>,
    pub id_document_type: Option<String>,
    pub id_document_number: Option<String>,
    pub id_issuing_authority: Option<String>,
    pub id_issuing_country: Option<String>,
    pub id_issued_on: Option<NaiveDate>,
    pub id_valid_until: Option<NaiveDate>,
    pub id_copy_on_file: bool,
    pub beneficial_owners: Vec<PayerOwnerLine>,
    pub beneficial_owners_none: Option<bool>,
    pub relationship_kind: Option<String>,
    pub relationship: Option<String>,
    /// German labels of the sources of funds.
    pub funds_sources: Vec<String>,
    pub funds_description: Option<String>,
    pub funds_proof_on_file: bool,
    /// Section 8 of the declaration.
    pub payment_route: Declaration,
    pub pep_self: Option<bool>,
    pub pep_self_details: Option<String>,
    pub pep_related: Option<bool>,
    pub pep_related_details: Option<String>,
    pub high_risk_country: Option<bool>,
    pub high_risk_country_code: Option<String>,
    pub sanctions_links: Option<bool>,
    pub sanctions_links_details: Option<String>,
    pub privacy_ack_at: Option<DateTime<Utc>>,
    pub privacy_text_version: Option<String>,
    pub contact_channels: Vec<String>,
}

/// `None` while no third party is named or its answers are not sent.
pub(crate) async fn self_disclosure(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<PayerSelfDisclosure>, sqlx::Error> {
    let Some(context) = load_context(conn, lead_id).await? else {
        return Ok(None);
    };
    let (Some(mode), Some(submitted_at)) = (context.mode(), context.submitted_at()) else {
        return Ok(None);
    };
    // The self-disclosure prints no check level: only the answers count.
    let built = questionnaire(
        &context,
        Viewer::Staff,
        &EnhancedCheck::default(),
        crate::app_time::today(),
    );
    let answers = built.answers.clone();
    let statement = &built.statement;
    let owner = |owner: &Owner| PayerOwnerLine {
        name: format!("{} {}", owner.first_name.trim(), owner.last_name.trim())
            .trim()
            .to_string(),
        date_of_birth: owner.date_of_birth,
        birth_place: owner.birth_place.clone(),
        street: owner.street.clone(),
        zip: owner.zip.clone(),
        city: owner.city.clone(),
        country: owner.country.clone(),
        share_percent: cents_text(owner.share_cents),
    };
    Ok(Some(PayerSelfDisclosure {
        mode: mode.as_str(),
        organisation: built.organisation,
        payer_type: built.payer_type.clone(),
        submitted_at,
        confirmed_email: statement.confirmed_email.clone(),
        beneficial_owners: answers.beneficial_owners.iter().map(owner).collect(),
        funds_sources: answers
            .funds_sources
            .iter()
            .map(|source| funds_source_label(source).to_string())
            .collect(),
        id_copy_on_file: !built.identity_documents.is_empty(),
        funds_proof_on_file: !built.funds_proof_documents.is_empty(),
        payment_route: built.route.clone(),
        privacy_ack_at: statement.privacy_ack_at,
        privacy_text_version: statement.privacy_text_version.clone(),
        contact_channels: statement.contact_channels.clone(),
        salutation: answers.salutation,
        first_name: answers.first_name,
        last_name: answers.last_name,
        former_names: answers.former_names,
        date_of_birth: answers.date_of_birth,
        birth_place: answers.birth_place,
        birth_country: answers.birth_country,
        citizenships: answers.citizenships,
        street: answers.street,
        zip: answers.zip,
        city: answers.city,
        country: answers.country,
        habitual_residence_country: answers.habitual_residence_country,
        phone: answers.phone,
        occupation: answers.occupation,
        organisation_name: answers.organisation_name,
        register_court: answers.register_court,
        register_number: answers.register_number,
        industry: answers.industry,
        representative_first_name: answers.representative_first_name,
        representative_last_name: answers.representative_last_name,
        representative_role: answers.representative_role,
        id_document_type: answers.id_document_type,
        id_document_number: answers.id_document_number,
        id_issuing_authority: answers.id_issuing_authority,
        id_issuing_country: answers.id_issuing_country,
        id_issued_on: answers.id_issued_on,
        id_valid_until: answers.id_valid_until,
        beneficial_owners_none: answers.beneficial_owners_none,
        relationship_kind: answers.relationship_kind,
        relationship: answers.relationship,
        funds_description: answers.funds_description,
        pep_self: answers.pep_self,
        pep_self_details: answers.pep_self_details,
        pep_related: answers.pep_related,
        pep_related_details: answers.pep_related_details,
        high_risk_country: answers.high_risk_country,
        high_risk_country_code: answers.high_risk_country_code,
        sanctions_links: answers.sanctions_links,
        sanctions_links_details: answers.sanctions_links_details,
    }))
}

/// `payer_link` of `GET /leads/{id}/portal-intake`: how far the link is and
/// the check level; `null` while no third party is named and nothing exists.
pub(crate) async fn intake_summary(state: &AppState, lead_id: Uuid) -> Result<Value, sqlx::Error> {
    let mut conn = state.db.acquire().await?;
    let Some(context) = load_context(&mut conn, lead_id).await? else {
        return Ok(Value::Null);
    };
    let link = newest_link(&mut conn, lead_id).await?;
    let submitted = submitted_payer(&mut conn, lead_id).await?;
    let mode = context.mode();
    if mode.is_none() && link.is_none() && context.statement.is_none() {
        return Ok(Value::Null);
    }
    let now = Utc::now();
    let level = match context.statement.as_ref() {
        Some(_) => {
            let check = lead_enhanced_check::enhanced_check_triggers(&mut conn, lead_id).await?;
            Some(questionnaire(&context, Viewer::Staff, &check, crate::app_time::today()).level)
        }
        None => None,
    };
    Ok(json!({
        "mode": mode.map(Mode::as_str),
        "status": link
            .as_ref()
            .map(|(link, _, _)| link.status(context.statement.as_ref(), now)),
        "sent_at": link.as_ref().map(|(link, _, _)| link.created_at),
        "submitted_at": submitted.map(|payer| payer.submitted_at),
        "check_level": level,
    }))
}

/// `payer_questionnaire` of the request object for the paying parent:
/// whether the section is there, when it was sent and how much is missing.
pub(crate) async fn cabinet_summary(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
) -> Result<Value, sqlx::Error> {
    let mut conn = state.db.acquire().await?;
    let Some(context) = load_context(&mut conn, lead_id)
        .await?
        .and_then(|context| parent_context(context, user_id))
    else {
        return Ok(Value::Null);
    };
    let check = lead_enhanced_check::enhanced_check_triggers(&mut conn, lead_id).await?;
    let built = questionnaire(
        &context,
        Viewer::Parent(user_id),
        &check,
        crate::app_time::today(),
    );
    let signature_package = crate::routes::lead_payer_package::payer_view(
        &mut conn,
        lead_id,
        built.statement.confirmed_email.as_deref(),
    )
    .await?;
    Ok(json!({
        "available": true,
        "submitted_at": built.statement.submitted_at,
        "missing_count": built.missing.len(),
        // The parent's own signature package as the payer (phase 3b).
        "signature_package": signature_package,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 6).unwrap()
    }

    fn person_payer() -> Declaration {
        Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.to_string(),
            payer_type: Some("person".into()),
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            date_of_birth: NaiveDate::from_ymd_opt(1970, 5, 1),
            country: Some("AT".into()),
            citizenships: vec!["AT".into()],
            relationship_kind: Some("friend".into()),
            email: Some("viktor.zahler@example.com".into()),
            ..Declaration::default()
        }
    }

    fn patch(body: Value) -> Map<String, Value> {
        body.as_object().cloned().unwrap()
    }

    #[test]
    fn secrets_are_random_hex_and_codes_six_digits() {
        let (first, second) = (new_secret(), new_secret());
        assert!(is_secret(&first) && is_secret(&second));
        assert_ne!(first, second);
        assert!(!is_secret(&first.to_uppercase()));
        assert!(!is_secret(&first[..63]));
        let code = new_code();
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
        let link = Uuid::new_v4();
        assert_ne!(
            code_hash(link, "123456"),
            code_hash(Uuid::new_v4(), "123456")
        );
        assert!(same_hash(
            &code_hash(link, "123456"),
            &code_hash(link, "123456")
        ));
        assert!(!same_hash(
            &code_hash(link, "123456"),
            &code_hash(link, "123457")
        ));
    }

    #[test]
    fn the_address_is_masked_and_amounts_are_hundredths() {
        assert_eq!(mask_email("viktor.zahler@example.com"), "v***r@example.com");
        assert_eq!(mask_email("v@example.com"), "v***@example.com");
        assert_eq!(parse_cents("12000", MAX_TOTAL_CENTS), Some(1_200_000));
        assert_eq!(parse_cents("12000,5", MAX_TOTAL_CENTS), Some(1_200_050));
        assert_eq!(parse_cents("33.33", FULL_SHARE), Some(3333));
        assert_eq!(parse_cents("1.234", MAX_TOTAL_CENTS), None);
        assert_eq!(parse_cents("-1", MAX_TOTAL_CENTS), None);
        assert_eq!(parse_cents("100.01", FULL_SHARE), None);
        assert_eq!(cents_of(&json!(25.5), FULL_SHARE), Some(2550));
        assert_eq!(cents_text(1_200_000), "12000.00");
        assert_eq!(share_value(3333), json!(33.33));
    }

    #[test]
    fn the_answers_patch_validates_each_key_and_clears_what_depends() {
        let stored = Answers::default();
        let next = apply_answers_patch(
            &stored,
            &patch(json!({
                "salutation": "MR",
                "citizenships": ["at", "DE", "AT"],
                "funds_sources": ["savings", "employment"],
                "pep_self": false,
                "pep_self_details": "stray",
                "high_risk_country": true,
                "high_risk_country_code": "ir",
                "id_valid_until": "2030-01-01"
            })),
            false,
            today(),
        )
        .unwrap();
        assert_eq!(next.salutation.as_deref(), Some("mr"));
        assert_eq!(next.citizenships, ["AT", "DE"]);
        assert_eq!(next.funds_sources, ["employment", "savings"], "form order");
        assert!(next.pep_self_details.is_none());
        assert_eq!(next.high_risk_country_code.as_deref(), Some("IR"));
        for (body, field) in [
            (json!({ "salutation": "dr" }), "salutation"),
            (json!({ "country": "Austria" }), "country"),
            (json!({ "date_of_birth": "2999-01-01" }), "date_of_birth"),
            (json!({ "funds_sources": ["lottery"] }), "funds_sources"),
            (json!({ "pep_self": "yes" }), "pep_self"),
            (json!({ "first_name": "x".repeat(101) }), "first_name"),
            (
                json!({ "relationship_kind": "neighbour" }),
                "relationship_kind",
            ),
        ] {
            let error = apply_answers_patch(&stored, &patch(body), false, today()).unwrap_err();
            assert_eq!(error.field, field);
            assert_eq!(error.code, "invalid_field");
        }
        let expired = apply_answers_patch(
            &stored,
            &patch(json!({ "id_valid_until": "2026-10-05" })),
            false,
            today(),
        )
        .unwrap_err();
        assert_eq!(expired.code, "id_document_expired");
    }

    /// An organisation chooses from its own sources of funds; the person's
    /// list and the organisation's share only "other" (QA 2026-10-06, C7-b).
    #[test]
    fn an_organisation_states_its_own_sources_of_funds() {
        let stored = Answers::default();
        let next = apply_answers_patch(
            &stored,
            &patch(json!({ "funds_sources": ["loan", "other", "business_revenue"] })),
            true,
            today(),
        )
        .unwrap();
        assert_eq!(
            next.funds_sources,
            ["business_revenue", "loan", "other"],
            "form order"
        );
        for (sources, organisation) in [
            (json!(["employment"]), true),
            (json!(["inheritance_gift", "equity"]), true),
            (json!(["equity"]), false),
            (json!(["donation"]), false),
        ] {
            let error = apply_answers_patch(
                &stored,
                &patch(json!({ "funds_sources": sources })),
                organisation,
                today(),
            )
            .unwrap_err();
            assert_eq!(
                (error.code, error.field),
                ("invalid_field", "funds_sources")
            );
        }
        assert_eq!(funds_source_options(true), ORGANISATION_FUNDS_SOURCES);
        assert_eq!(funds_source_options(false), lead_payer::SOURCE_OF_FUNDS);
    }

    #[test]
    fn beneficial_owners_need_names_and_shares_up_to_a_hundred_percent() {
        let owner = |share: Value| json!({ "first_name": "Anna", "last_name": "Muster", "country": "de", "share_percent": share });
        let owners = owners_of(&json!([owner(json!(60)), owner(json!("40.00"))]), today()).unwrap();
        assert_eq!(owners.len(), 2);
        assert_eq!(owners[0].country.as_deref(), Some("DE"));
        assert_eq!(owners[1].share_cents, 4000);
        for invalid in [
            json!([owner(json!(60)), owner(json!(40.01))]),
            json!([owner(json!(0))]),
            json!([owner(json!(12.345))]),
            json!([{ "first_name": "Anna", "share_percent": 10 }]),
            json!([{ "first_name": "Anna", "last_name": "Muster", "share_percent": 10, "email": "x" }]),
            Value::Array((0..11).map(|_| owner(json!(1))).collect()),
        ] {
            assert_eq!(
                owners_of(&invalid, today()).unwrap_err().field,
                "beneficial_owners"
            );
        }
        let cleared = apply_answers_patch(
            &Answers {
                beneficial_owners: owners,
                ..Answers::default()
            },
            &patch(json!({ "beneficial_owners_none": true })),
            true,
            today(),
        )
        .unwrap();
        assert!(cleared.beneficial_owners.is_empty());
    }

    #[test]
    fn the_patch_takes_only_the_keys_of_the_payer_type_and_writer() {
        let person = PatchScope {
            organisation: false,
            cabinet: false,
        };
        let refused = |body: Value, scope: PatchScope| {
            split_patch(body.to_string().as_bytes(), scope).is_err()
        };
        assert!(refused(
            json!({ "organisation_name": "Beispiel GmbH" }),
            person
        ));
        assert!(refused(json!({ "invoice_to": "payer" }), person));
        assert!(refused(json!({ "email": "x@example.com" }), person));
        let (answers, route) = split_patch(
            json!({ "first_name": "Viktor", "payment_method": "card" })
                .to_string()
                .as_bytes(),
            person,
        )
        .unwrap();
        assert!(answers.contains_key("first_name"));
        assert!(route.contains_key("payment_method"));
        let organisation = PatchScope {
            organisation: true,
            cabinet: false,
        };
        assert!(refused(json!({ "first_name": "Viktor" }), organisation));
        let cabinet = PatchScope {
            organisation: false,
            cabinet: true,
        };
        assert!(refused(json!({ "first_name": "Anna" }), cabinet));
        assert!(refused(json!({ "payment_method": "card" }), cabinet));
        assert!(!refused(
            json!({ "occupation": "Lehrerin", "pep_self": false }),
            cabinet
        ));
    }

    #[test]
    fn the_link_takes_only_the_name_and_the_relationship_from_the_declaration() {
        // Everything the lead may have entered about the payer.
        let declaration = Declaration {
            place_of_birth: Some("Graz".into()),
            street: Some("Ringstraße 9".into()),
            zip: Some("1010".into()),
            city: Some("Wien".into()),
            phone: Some("+43 1 000000".into()),
            relationship_kind: Some("other".into()),
            relationship: Some("Onkel".into()),
            ..person_payer()
        };
        let stored = Answers {
            first_name: Some("Viktor Paul".into()),
            ..Answers::default()
        };
        let answers = effective_answers(&stored, &declaration, None);
        assert_eq!(answers.first_name.as_deref(), Some("Viktor Paul"));
        assert_eq!(answers.last_name.as_deref(), Some("Zahler"));
        assert_eq!(answers.relationship_kind.as_deref(), Some("other"));
        assert_eq!(answers.relationship.as_deref(), Some("Onkel"));
        // Data minimisation (QA 2026-10-06): the payer states birth data,
        // address, citizenships and phone itself.
        assert_eq!(answers.date_of_birth, None);
        assert_eq!(answers.birth_place, None);
        assert!(answers.citizenships.is_empty());
        assert_eq!(
            (
                &answers.street,
                &answers.zip,
                &answers.city,
                &answers.country,
                &answers.phone
            ),
            (&None, &None, &None, &None, &None)
        );
        assert_eq!(answers.id_document_number, None);
        // What the payer states is the effective value.
        let stated = Answers {
            date_of_birth: NaiveDate::from_ymd_opt(1962, 4, 12),
            citizenships: vec!["DE".into()],
            street: Some("Zahlerstraße 5".into()),
            ..Answers::default()
        };
        let answers = effective_answers(&stated, &declaration, None);
        assert_eq!(answers.date_of_birth, NaiveDate::from_ymd_opt(1962, 4, 12));
        assert_eq!(answers.citizenships, ["DE"]);
        assert_eq!(answers.street.as_deref(), Some("Zahlerstraße 5"));
        assert_eq!(answers.first_name.as_deref(), Some("Viktor"));
        // A declaration name over the statement's limit is asked again.
        let long = Declaration {
            last_name: Some("Z".repeat(101)),
            ..person_payer()
        };
        assert!(
            effective_answers(&Answers::default(), &long, None)
                .last_name
                .is_none()
        );
    }

    #[test]
    fn the_check_level_follows_the_enhanced_check() {
        use crate::routes::lead_enhanced_check::{Screening, Subjects, evaluate};

        // Nothing on the black list: level 1, whatever else the payer says.
        assert_eq!(check_level(&EnhancedCheck::default()), (1, vec![]));
        let russia = evaluate(&Subjects {
            patient_citizenships: vec!["RU".into()],
            payer_residence: vec!["RU".into()],
            ..Subjects::default()
        });
        assert_eq!(check_level(&russia), (1, vec![]), "the high-risk list");
        // A black-list country of the payer or of the patient: level 2.
        let payer = evaluate(&Subjects {
            payer_residence: vec!["AT".into(), "IR".into()],
            ..Subjects::default()
        });
        assert_eq!(check_level(&payer), (2, vec!["payer_residence_blacklist"]));
        let patient = evaluate(&Subjects {
            patient_citizenships: vec!["KP".into()],
            ..Subjects::default()
        });
        assert_eq!(
            check_level(&patient),
            (2, vec!["patient_citizenship_blacklist"])
        );
        // An open match is named, the level stays 1.
        let pending = evaluate(&Subjects {
            payer_screening: Screening::ReviewPending,
            review_pending: true,
            ..Subjects::default()
        });
        assert_eq!(check_level(&pending), (1, vec!["sanctions_review_pending"]));
    }

    #[test]
    fn a_pep_cash_and_a_high_total_leave_the_proof_of_funds_optional() {
        let declaration = Declaration {
            payment_method: Some("cash".into()),
            ..person_payer()
        };
        let answers = Answers {
            country: Some("AT".into()),
            citizenships: vec!["AT".into()],
            pep_self: Some(true),
            pep_related: Some(true),
            high_risk_country: Some(true),
            ..effective_answers(&Answers::default(), &declaration, None)
        };
        let required = |level: u8| Requirements {
            privacy_acknowledged: true,
            payer_type: "person",
            id_uploaded: true,
            funds_proof_required: level == 2,
            funds_proof_uploaded: false,
            payment_route: None,
            organisation_follow_up: false,
            today: today(),
        };
        let (level, reasons) = check_level(&EnhancedCheck::default());
        assert_eq!((level, reasons), (1, vec![]));
        assert!(!missing_for_submit(&answers, &required(level)).contains(&"funds_proof_upload"));
        assert!(missing_for_submit(&answers, &required(2)).contains(&"funds_proof_upload"));
    }

    #[test]
    fn the_missing_list_follows_the_form_order() {
        let declaration = person_payer();
        let answers = effective_answers(&Answers::default(), &declaration, None);
        let required = Requirements {
            privacy_acknowledged: false,
            payer_type: "person",
            id_uploaded: false,
            funds_proof_required: true,
            funds_proof_uploaded: false,
            payment_route: Some(&declaration),
            organisation_follow_up: false,
            today: today(),
        };
        assert_eq!(
            missing_for_submit(&answers, &required),
            [
                "privacy_ack",
                "date_of_birth",
                "birth_place",
                "birth_country",
                "citizenships",
                "street",
                "zip",
                "city",
                "country",
                "id_document_type",
                "id_document_number",
                "id_issuing_authority",
                "id_issuing_country",
                "id_valid_until",
                "id_document_upload",
                "occupation",
                "funds_sources",
                "funds_proof_upload",
                "payment_method",
                "via_third_party",
                "pep_self",
                "pep_related",
                "high_risk_country",
                "sanctions_links",
            ]
        );
        let company = Declaration {
            payer_type: Some("company".into()),
            organisation_name: Some("Beispiel GmbH".into()),
            first_name: None,
            last_name: None,
            date_of_birth: None,
            citizenships: Vec::new(),
            ..person_payer()
        };
        let answers = effective_answers(&Answers::default(), &company, None);
        let required = Requirements {
            privacy_acknowledged: true,
            payer_type: "company",
            id_uploaded: true,
            funds_proof_required: false,
            funds_proof_uploaded: false,
            payment_route: None,
            organisation_follow_up: false,
            today: today(),
        };
        let missing = missing_for_submit(&answers, &required);
        assert_eq!(
            &missing[..6],
            [
                "street",
                "zip",
                "city",
                "country",
                "register_court",
                "register_number"
            ]
        );
        assert!(missing.contains(&"representative_first_name"));
        assert!(missing.contains(&"beneficial_owners"));
        assert!(missing.contains(&"industry"));
        assert!(!missing.contains(&"first_name"));
        assert!(!missing.contains(&"payment_method"), "not asked here");
        assert!(!missing.contains(&"legal_form"), "only with block E");
        // Block E open: the legal form after the name, why it pays after the relationship.
        let missing = missing_for_submit(
            &answers,
            &Requirements {
                organisation_follow_up: true,
                ..required
            },
        );
        let at = |key: &str| missing.iter().position(|known| *known == key);
        assert_eq!(at("legal_form"), Some(0));
        assert!(at("payment_reason") > at("relationship") && at("payment_reason") < at("industry"));
        let answered = Answers {
            legal_form: Some("GmbH".into()),
            payment_reason: Some("Arbeitgeber".into()),
            ..answers.clone()
        };
        let missing = missing_for_submit(
            &answered,
            &Requirements {
                organisation_follow_up: true,
                ..required
            },
        );
        assert!(!missing.contains(&"legal_form") && !missing.contains(&"payment_reason"));
    }

    #[test]
    fn adoption_takes_the_identity_and_the_source_of_funds_only_while_empty() {
        let declaration = person_payer();
        let answers = Answers {
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            birth_place: Some("Graz".into()),
            street: Some("Hauptstraße 1".into()),
            relationship_kind: Some("other".into()),
            relationship: Some("Onkel".into()),
            funds_sources: vec!["employment".into(), "savings".into()],
            funds_description: Some("Gehalt und Sparbuch".into()),
            ..Answers::default()
        };
        let document = Uuid::new_v4();
        let adopted = adopted_declaration(&declaration, &answers, Some(document));
        assert_eq!(adopted.place_of_birth.as_deref(), Some("Graz"));
        assert_eq!(adopted.street.as_deref(), Some("Hauptstraße 1"));
        assert_eq!(adopted.relationship.as_deref(), Some("Onkel"));
        assert_eq!(
            adopted.email, declaration.email,
            "the address never changes"
        );
        assert_eq!(adopted.source_of_funds.as_deref(), Some("other"));
        assert_eq!(
            adopted.source_of_funds_description.as_deref(),
            Some(
                "Angaben des Zahlers: Gehalt / nichtselbständige Arbeit, Ersparnisse – Gehalt und Sparbuch"
            )
        );
        assert_eq!(adopted.source_of_funds_document_id, Some(document));
        let stated = Declaration {
            source_of_funds: Some("inheritance_gift".into()),
            ..declaration
        };
        let kept = adopted_declaration(&stated, &answers, Some(document));
        assert_eq!(kept.source_of_funds.as_deref(), Some("inheritance_gift"));
    }

    /// An organisation's sources map to the declaration's list where it has
    /// a match, else to "other" with the payer's words (QA 2026-10-06).
    #[test]
    fn adoption_maps_the_sources_of_an_organisation() {
        let company = Declaration {
            payer_type: Some("company".into()),
            organisation_name: Some("Beispiel GmbH".into()),
            first_name: None,
            last_name: None,
            date_of_birth: None,
            citizenships: Vec::new(),
            ..person_payer()
        };
        let adopt = |sources: &[&str], text: Option<&str>| {
            adopted_declaration(
                &company,
                &Answers {
                    funds_sources: sources.iter().map(|source| source.to_string()).collect(),
                    funds_description: text.map(str::to_string),
                    ..Answers::default()
                },
                None,
            )
        };
        let revenue = adopt(&["business_revenue"], None);
        assert_eq!(revenue.source_of_funds.as_deref(), Some("business_income"));
        assert_eq!(revenue.source_of_funds_description, None);
        let other = adopt(&["other"], Some("Rücklagen der Stiftung"));
        assert_eq!(other.source_of_funds.as_deref(), Some("other"));
        assert_eq!(
            other.source_of_funds_description.as_deref(),
            Some("Rücklagen der Stiftung")
        );
        let loan = adopt(&["loan"], Some("Kredit der Hausbank"));
        assert_eq!(loan.source_of_funds.as_deref(), Some("other"));
        assert_eq!(
            loan.source_of_funds_description.as_deref(),
            Some("Angaben des Zahlers: Darlehen / Kredit – Kredit der Hausbank")
        );
        let several = adopt(&["business_revenue", "equity"], None);
        assert_eq!(several.source_of_funds.as_deref(), Some("other"));
        assert_eq!(
            several.source_of_funds_description.as_deref(),
            Some("Angaben des Zahlers: Geschäftstätigkeit / Umsatz, Eigenkapital")
        );
        // Every value of either list is one the declaration accepts.
        for source in ORGANISATION_FUNDS_SOURCES
            .iter()
            .chain(lead_payer::SOURCE_OF_FUNDS)
        {
            let adopted = adopt(&[*source], None);
            assert!(
                lead_payer::SOURCE_OF_FUNDS
                    .contains(&adopted.source_of_funds.as_deref().unwrap_or_default()),
                "{source}"
            );
            assert_ne!(funds_source_label(source), *source, "{source} has a label");
        }
    }
}
