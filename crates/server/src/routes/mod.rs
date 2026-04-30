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
pub mod drug_products;
pub mod e2e_support;
pub mod feedback;
pub mod health;
pub mod interpreter_patient_history;
pub mod interpreters;
pub mod invoices;
pub mod key_rotation;
pub mod leads;
pub mod me;
pub mod messages;
pub mod notifications;
pub mod order_service_groups;
pub mod orders;
pub mod patient_document_requests;
pub mod patient_financials;
pub mod patient_next_actions;
pub mod patient_recommendations;
pub mod patients;
pub mod providers;
pub mod realtime;
pub mod service_packages;
pub mod sops;
pub mod stats;
pub mod tasks;
pub mod tax_profiles;
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
        .merge(patient_financials::router())
        .merge(patient_recommendations::router())
        .merge(patient_next_actions::router())
        .merge(patient_document_requests::router())
        .merge(service_packages::router())
        .merge(tax_profiles::router())
        .merge(interpreters::router())
        .merge(interpreter_patient_history::router())
        .merge(order_service_groups::router())
        .merge(drug_products::router())
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
