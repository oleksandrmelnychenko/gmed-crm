//! The tax profile of an order position (owner decision 2026-11-19): every
//! position carries the profile staff chose, and quotes and invoices bill
//! the VAT of that profile instead of deriving it along the way.
//!
//! * A pass-through cost (durchlaufender Posten) carries the profile
//!   «Durchlaufender Posten 0 %» (`pass_through_0`, category `pass_through`);
//!   any other profile is refused. Its purchase VAT is a planned partner cost,
//!   not the patient's rate.
//! * Any other position takes the profile staff picked, else the catalogue
//!   item's, else the one active profile with the typed rate; a pass-through
//!   profile on it is refused.

use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::money::CommercialRounding;

/// Key of the pass-through profile (migration 20261119120000).
pub(crate) const PASS_THROUGH_PROFILE_KEY: &str = "pass_through_0";

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LineTaxProfile {
    pub id: Uuid,
    pub vat_rate: Decimal,
    pub pass_through: bool,
}

fn from_row(row: &sqlx::postgres::PgRow) -> LineTaxProfile {
    LineTaxProfile {
        id: row.try_get("id").unwrap_or_default(),
        vat_rate: row
            .try_get::<Decimal, _>("vat_rate")
            .unwrap_or(Decimal::ZERO)
            .round_commercial(2),
        pass_through: row
            .try_get::<String, _>("vat_category")
            .is_ok_and(|category| category == "pass_through"),
    }
}

/// An active, currently valid profile by id.
pub(crate) async fn active_profile<'e>(
    db: impl sqlx::PgExecutor<'e>,
    id: Uuid,
) -> Result<Option<LineTaxProfile>, sqlx::Error> {
    Ok(sqlx::query(
        r#"SELECT id, vat_rate, vat_category FROM tax_profiles
           WHERE id = $1 AND is_active
             AND valid_from <= CURRENT_DATE
             AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)"#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .as_ref()
    .map(from_row))
}

/// The pass-through profile.
pub(crate) async fn pass_through_profile<'e>(
    db: impl sqlx::PgExecutor<'e>,
) -> Result<Option<LineTaxProfile>, sqlx::Error> {
    Ok(sqlx::query(
        "SELECT id, vat_rate, vat_category FROM tax_profiles WHERE profile_key = $1 AND is_active",
    )
    .bind(PASS_THROUGH_PROFILE_KEY)
    .fetch_optional(db)
    .await?
    .as_ref()
    .map(from_row))
}

/// The one active profile (not pass-through) with this rate; `None` when
/// none or several match (0 % is both § 4 Nr. 14 and «exempt»: staff pick).
pub(crate) async fn unique_profile_for_rate<'e>(
    db: impl sqlx::PgExecutor<'e>,
    vat_rate: Decimal,
) -> Result<Option<LineTaxProfile>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT id, vat_rate, vat_category FROM tax_profiles
           WHERE is_active AND vat_category <> 'pass_through'
             AND valid_from <= CURRENT_DATE
             AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
             AND ROUND(vat_rate, 2) = ROUND($1, 2)
           LIMIT 2"#,
    )
    .bind(vat_rate)
    .fetch_all(db)
    .await?;
    Ok(match rows.as_slice() {
        [row] => Some(from_row(row)),
        _ => None,
    })
}

/// The profile of a position a staff path creates (service form, lead
/// wizard, order wizard): the one staff chose, else the pass-through profile
/// for a pass-through cost, else the catalogue item's, else
/// the one profile of the typed rate. `Ok(Err(message))` is the 422 answer:
/// a chosen profile that is inactive or does not fit the position. The
/// automatic paths get the same profile from the INSERT trigger
/// `resolve_order_line_tax_profile` (migration 20261119180000).
pub(crate) async fn resolve(
    conn: &mut sqlx::PgConnection,
    chosen: Option<Uuid>,
    is_cost_passthrough: bool,
    catalog_profile: Option<Uuid>,
    vat_rate: Decimal,
) -> Result<Result<Option<LineTaxProfile>, &'static str>, sqlx::Error> {
    let profile = if let Some(id) = chosen {
        match active_profile(&mut *conn, id).await? {
            Some(profile) => Some(profile),
            None => return Ok(Err("The tax profile is not active")),
        }
    } else if is_cost_passthrough {
        pass_through_profile(&mut *conn).await?
    } else {
        let catalog = match catalog_profile {
            Some(id) => active_profile(&mut *conn, id)
                .await?
                .filter(|profile| !profile.pass_through),
            None => None,
        };
        match catalog {
            Some(profile) => Some(profile),
            None => unique_profile_for_rate(&mut *conn, vat_rate).await?,
        }
    };
    if let Some(message) = profile
        .as_ref()
        .and_then(|profile| mismatch(profile, is_cost_passthrough))
    {
        return Ok(Err(message));
    }
    Ok(Ok(profile))
}

/// Why a profile does not fit the position, for the 422 answer.
pub(crate) fn mismatch(
    profile: &LineTaxProfile,
    is_cost_passthrough: bool,
) -> Option<&'static str> {
    match (is_cost_passthrough, profile.pass_through) {
        (true, false) => {
            Some("A pass-through cost needs the tax profile «Durchlaufender Posten 0 %»")
        }
        (false, true) => {
            Some("The tax profile «Durchlaufender Posten 0 %» is only for pass-through costs")
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(pass_through: bool) -> LineTaxProfile {
        LineTaxProfile {
            id: Uuid::nil(),
            vat_rate: Decimal::ZERO,
            pass_through,
        }
    }

    #[test]
    fn a_pass_through_cost_takes_only_the_pass_through_profile() {
        assert!(mismatch(&profile(false), true).is_some());
        assert!(mismatch(&profile(true), false).is_some());
        assert!(mismatch(&profile(true), true).is_none());
        assert!(mismatch(&profile(false), false).is_none());
    }
}
