//! `GET /me/email-check?email=…`: whether an address is well-formed and its
//! domain accepts mail (`crate::email_domain`). Forms ask it when a field is
//! left and cards ask it for stored addresses, so a domain DNS could not
//! answer for at save time is checked again later. Any signed-in user may
//! ask; the answer says nothing about who uses the address.

use axum::{Json, Router, extract::Query, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::email_address::has_valid_format;
use crate::email_domain::{DomainStatus, check_email};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/me/email-check", get(email_check))
}

#[derive(Deserialize)]
struct EmailCheckQuery {
    email: String,
}

async fn email_check(Query(query): Query<EmailCheckQuery>) -> Json<Value> {
    let email = query.email.trim();
    if !has_valid_format(email) {
        return Json(json!({ "format_valid": false, "domain": Value::Null }));
    }
    let status: DomainStatus = check_email(email).await;
    Json(json!({ "format_valid": true, "domain": status.as_str() }))
}
