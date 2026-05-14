//! Business-metric definitions and one-time descriptions.
//!
//! The `metrics` crate provides a thin macro facade
//! (`counter!`, `histogram!`, `gauge!`) that emits into the global
//! recorder installed by [`axum_prometheus`] at startup. This module
//! centralises:
//!
//!   - The canonical metric **names** as string constants. Importing
//!     them at the call site prevents typos that silently create two
//!     time series instead of one.
//!   - The **descriptions** registered up-front via [`describe_counter`]
//!     etc. The `# HELP` line then appears in the `/metrics` output
//!     so operators can read what a series means without grepping the
//!     codebase.
//!
//! Adding a new business metric is three small steps:
//!
//! 1. Add a `pub const NAME: &str = "gmed_<thing>_total";` constant
//!    here. Stick to Prometheus conventions: `lower_snake_case`,
//!    `_total` for counters, `_seconds` for time, no units in the
//!    label values.
//! 2. Register a description in [`describe_all`].
//! 3. Emit at the call site:
//!    ```rust,ignore
//!    metrics::counter!(metrics_names::PATIENT_CREATED_TOTAL, "role" => role).increment(1);
//!    ```
//!
//! Label cardinality is the only ongoing care: every distinct label
//! combination creates a separate time series in Prometheus. Bounded
//! enums (outcome / reason / role) are fine; anything user-controlled
//! (email, IP, free text) belongs in the audit log, not in a metric.

use metrics::{Unit, describe_counter};

// --- Names ----------------------------------------------------------------
//
// Every constant here gets a matching `describe_counter!`/`describe_gauge!`/
// `describe_histogram!` call in `describe_all` below. Keep the two lists in
// sync: a missing description is harmless but ugly; a name typo (or two
// constants pointing at the same series) is the kind of bug that only
// surfaces when an alert misfires at 03:00.

/// Counter: login attempts segmented by outcome and reason.
///
/// Labels:
///   - `outcome` = `success | failure | blocked | mfa_pending`
///   - `reason`  = `ok | unknown_email | wrong_password | account_inactive |
///                  account_locked | auto_locked | ip_whitelist | mfa_pending`
///
/// Bounded cardinality: 4 outcomes × ~8 reasons ≈ 32 series at the high
/// end. Comfortably under Prometheus's "high cardinality" threshold.
pub const LOGIN_ATTEMPTS_TOTAL: &str = "gmed_login_attempts_total";

// --- Descriptions ---------------------------------------------------------

/// Register `# HELP` text for every metric defined in this module.
///
/// Must be called AFTER the Prometheus recorder is installed (which
/// happens inside `axum_prometheus::PrometheusMetricLayerBuilder::build_pair`).
/// Calling it before the recorder is installed silently no-ops, so
/// `main.rs` invokes it immediately after the builder returns.
pub fn describe_all() {
    describe_counter!(
        LOGIN_ATTEMPTS_TOTAL,
        Unit::Count,
        "Login attempts, labelled by outcome and the specific failure reason. \
         outcome=success counts only fully-authenticated logins; outcome=mfa_pending \
         counts logins that passed password but await MFA approval."
    );
}
