//! Who may be assigned new work (owner decision 2026-09-28, Q11).
//!
//! * An interpreter (or team lead interpreter) whose profile status is
//!   `blocked` or `terminated` is not offered and not accepted for a new
//!   assignment. An external interpreter (employment `external` or a
//!   freelance contract) also needs a signed AVV (Art. 28 DSGVO). Existing
//!   assignments stay; they are only checked when they change.
//! * An inactive or archived provider is refused on new appointments, order
//!   services and concierge services; existing records keep it.

use sqlx::PgPool;
use uuid::Uuid;

/// SQL condition on a `users` row aliased `u`: the interpreter can take new
/// assignments. True for users without an interpreter profile.
pub const INTERPRETER_ASSIGNABLE_SQL: &str = "NOT EXISTS (
    SELECT 1
    FROM interpreter_profile_details ipd
    LEFT JOIN interpreter_compliance_profiles icp ON icp.user_id = ipd.user_id
    WHERE ipd.user_id = u.id
      AND (
          ipd.status IN ('blocked', 'terminated')
          OR (
              (ipd.employment_kind = 'external' OR ipd.contract_type = 'freelancer')
              AND COALESCE(icp.avv_status, '') <> 'signed'
          )
      )
)";

/// Why an interpreter cannot take a new assignment, or `None`.
pub async fn interpreter_block_reason(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<&'static str>, sqlx::Error> {
    let row: Option<(String, bool)> = sqlx::query_as(
        r#"SELECT ipd.status,
                  COALESCE(
                      (ipd.employment_kind = 'external' OR ipd.contract_type = 'freelancer')
                      AND COALESCE(icp.avv_status, '') <> 'signed',
                      false
                  ) AS avv_missing
           FROM interpreter_profile_details ipd
           LEFT JOIN interpreter_compliance_profiles icp ON icp.user_id = ipd.user_id
           WHERE ipd.user_id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some((status, _)) if status == "blocked" => Some("Interpreter is blocked"),
        Some((status, _)) if status == "terminated" => Some("Interpreter contract has ended"),
        Some((_, true)) => {
            Some("External interpreter has no signed AVV (data processing agreement)")
        }
        _ => None,
    })
}

/// SQL condition on a `providers` row aliased `p`: accepts new work.
pub const PROVIDER_ACCEPTS_NEW_WORK_SQL: &str = "(p.is_active = true AND p.archived_at IS NULL)";

/// Whether the provider accepts new work (active, not archived). `None` when
/// it does not exist.
pub async fn provider_accepts_new_work(
    pool: &PgPool,
    provider_id: Uuid,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        "SELECT {PROVIDER_ACCEPTS_NEW_WORK_SQL} FROM providers p WHERE p.id = $1"
    ))
    .bind(provider_id)
    .fetch_optional(pool)
    .await
}

pub const INACTIVE_PROVIDER_MESSAGE: &str =
    "The provider is inactive or archived and cannot be used for new records";
