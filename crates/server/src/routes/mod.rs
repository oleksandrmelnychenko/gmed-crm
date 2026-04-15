pub mod access_policies;
pub mod admin_compliance;
pub mod admin_security;
pub mod admin_settings;
pub mod announcements;
pub mod appointments;
pub mod auth;
pub mod cases;
pub mod concierge_services;
pub mod contracts;
pub mod custom_fields;
pub(crate) mod debt_management;
pub mod documents;
pub mod e2e_support;
pub mod feedback;
pub mod health;
pub mod invoices;
pub mod key_rotation;
pub mod leads;
pub mod me;
pub mod messages;
pub mod notifications;
pub mod orders;
pub mod patients;
pub mod providers;
pub mod sops;
pub mod stats;
pub mod tasks;
pub mod user_notifications;
pub mod users;
pub mod workflow_checklists;
pub(crate) mod workflow_lifecycle;

use crate::state::AppState;
use axum::Router;

pub fn protected_router() -> Router<AppState> {
    Router::new()
        .merge(me::router())
        .merge(auth::protected_router())
        .merge(users::router())
        .merge(access_policies::router())
        .merge(patients::router())
        .merge(providers::router())
        .merge(sops::router())
        .merge(cases::router())
        .merge(concierge_services::router())
        .merge(contracts::router())
        .merge(leads::router())
        .merge(orders::router())
        .merge(appointments::router())
        .merge(tasks::router())
        .merge(stats::router())
        .merge(invoices::router())
        .merge(admin_settings::router())
        .merge(admin_security::router())
        .merge(key_rotation::router())
        .merge(admin_compliance::router())
        .merge(notifications::router())
        .merge(custom_fields::router())
        .merge(documents::router())
        .merge(feedback::router())
        .merge(announcements::router())
        .merge(user_notifications::router())
        .merge(messages::router())
        .merge(workflow_checklists::router())
}
