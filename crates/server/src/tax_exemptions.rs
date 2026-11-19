//! Why a line carries no VAT, per tax profile (QA3 B S2-2): each profile has
//! its own German reason (BT-120) and optionally a VATEX code (BT-121),
//! editable in «Налоговые профили». The printed invoice, the order documents
//! (Kostenvoranschlag, Einzelauftrag) and the embedded e-invoice state the
//! same reason. Lines without a profile keep the former classification:
//! a pass-through cost is a durchlaufender Posten, any other 0 % line
//! steuerfreie Heilbehandlung.

use std::collections::HashMap;

use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

/// Durchlaufende Posten: § 10 Abs. 1 Satz 5 UStG (Satz 6 is the
/// Mehrzweck-Gutschein rule since 2019).
pub const PASSTHROUGH_REASON: &str = "Durchlaufender Posten gemäß § 10 Abs. 1 Satz 5 UStG";
/// Medical care, § 4 Nr. 14 UStG (Art. 132 VAT Directive).
pub const MEDICAL_REASON: &str = "Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG";
pub const MEDICAL_REASON_CODE: &str = "VATEX-EU-132";
/// A profile without a reason of its own: no legal paragraph is invented.
pub const GENERIC_REASON: &str = "Steuerfreie Leistung";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Exemption {
    pub reason: String,
    pub code: Option<String>,
    /// A pass-through cost (durchlaufender Posten), not a VAT-free supply.
    pub pass_through: bool,
}

impl Exemption {
    pub fn pass_through() -> Self {
        Self {
            reason: PASSTHROUGH_REASON.to_string(),
            code: None,
            pass_through: true,
        }
    }

    pub fn medical() -> Self {
        Self {
            reason: MEDICAL_REASON.to_string(),
            code: Some(MEDICAL_REASON_CODE.to_string()),
            pass_through: false,
        }
    }
}

/// The reasons of the tax profiles, loaded once per document.
#[derive(Clone, Debug, Default)]
pub struct ExemptionCatalog {
    by_id: HashMap<Uuid, (String, Exemption)>,
    /// The system profile of a category: `termin_fee_0` (zero rated),
    /// `vat_exempt_0` (exempt), `pass_through_0`.
    by_category: HashMap<String, Exemption>,
}

impl ExemptionCatalog {
    pub async fn load(conn: &mut PgConnection) -> Result<Self, sqlx::Error> {
        let rows = sqlx::query(
            r#"SELECT id, profile_key, vat_category, exemption_reason, exemption_reason_code
               FROM tax_profiles"#,
        )
        .fetch_all(&mut *conn)
        .await?;
        let mut catalog = Self::default();
        for row in rows {
            let category: String = row.try_get("vat_category")?;
            let key: String = row.try_get("profile_key")?;
            let reason = row
                .try_get::<Option<String>, _>("exemption_reason")?
                .map(|reason| reason.trim().to_string())
                .filter(|reason| !reason.is_empty());
            let has_reason = reason.is_some();
            let exemption = Exemption {
                reason: reason.unwrap_or_else(|| {
                    if category == "pass_through" {
                        PASSTHROUGH_REASON.to_string()
                    } else {
                        GENERIC_REASON.to_string()
                    }
                }),
                code: row
                    .try_get::<Option<String>, _>("exemption_reason_code")?
                    .map(|code| code.trim().to_string())
                    .filter(|code| !code.is_empty()),
                pass_through: category == "pass_through",
            };
            if has_reason
                && matches!(
                    (key.as_str(), category.as_str()),
                    ("termin_fee_0", "zero_rated")
                        | ("vat_exempt_0", "exempt")
                        | ("pass_through_0", "pass_through")
                )
            {
                catalog
                    .by_category
                    .insert(category.clone(), exemption.clone());
            }
            catalog
                .by_id
                .insert(row.try_get("id")?, (category, exemption));
        }
        Ok(catalog)
    }

    /// The reason of a line: `None` for a taxed line.
    pub fn resolve(
        &self,
        vat_rate: Decimal,
        is_cost_passthrough: bool,
        tax_profile_id: Option<Uuid>,
        vat_category: Option<&str>,
    ) -> Option<Exemption> {
        if vat_rate > Decimal::ZERO {
            return None;
        }
        let profile = tax_profile_id.and_then(|id| self.by_id.get(&id));
        if is_cost_passthrough || vat_category == Some("pass_through") {
            return Some(
                profile
                    .filter(|(category, _)| category == "pass_through")
                    .map(|(_, exemption)| exemption.clone())
                    .or_else(|| self.by_category.get("pass_through").cloned())
                    .unwrap_or_else(Exemption::pass_through),
            );
        }
        if let Some((category, exemption)) = profile
            && category != "pass_through"
        {
            return Some(exemption.clone());
        }
        Some(
            vat_category
                .and_then(|category| self.by_category.get(category))
                .cloned()
                .unwrap_or_else(Exemption::medical),
        )
    }

    /// [`Self::resolve`] for a stored invoice or quote line.
    pub fn for_json_line(&self, line: &Value) -> Option<Exemption> {
        let vat_rate = match line.get("vat_rate") {
            Some(Value::String(text)) => text.trim().parse::<Decimal>().ok(),
            Some(Value::Number(number)) => number.to_string().parse::<Decimal>().ok(),
            _ => None,
        }
        .unwrap_or(Decimal::ZERO);
        let tax_profile_id = line
            .get("tax_profile_id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        self.resolve(
            vat_rate,
            crate::money::json_line_pass_through(line),
            tax_profile_id,
            line.get("vat_category").and_then(Value::as_str),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> (ExemptionCatalog, Uuid, Uuid) {
        let exempt_id = Uuid::new_v4();
        let medical_id = Uuid::new_v4();
        let mut catalog = ExemptionCatalog::default();
        let exempt = Exemption {
            reason: "Steuerfreie Leistung".to_string(),
            code: None,
            pass_through: false,
        };
        catalog
            .by_id
            .insert(exempt_id, ("exempt".to_string(), exempt.clone()));
        catalog
            .by_id
            .insert(medical_id, ("zero_rated".to_string(), Exemption::medical()));
        catalog.by_category.insert("exempt".to_string(), exempt);
        (catalog, exempt_id, medical_id)
    }

    #[test]
    fn a_profile_without_a_reason_is_no_heilbehandlung() {
        let custom = Uuid::new_v4();
        let mut catalog = ExemptionCatalog::default();
        catalog.by_id.insert(
            custom,
            (
                "custom".to_string(),
                Exemption {
                    reason: GENERIC_REASON.to_string(),
                    code: None,
                    pass_through: false,
                },
            ),
        );
        let exemption = catalog
            .for_json_line(&json!({"vat_rate": "0", "tax_profile_id": custom.to_string()}))
            .unwrap();
        assert_eq!(exemption.reason, GENERIC_REASON);
        assert_eq!(exemption.code, None);
    }

    #[test]
    fn each_profile_prints_its_own_reason() {
        let (catalog, exempt_id, medical_id) = catalog();
        let exempt = catalog
            .for_json_line(&json!({"vat_rate": "0", "tax_profile_id": exempt_id.to_string()}))
            .unwrap();
        assert_eq!(exempt.reason, "Steuerfreie Leistung");
        assert_eq!(exempt.code, None);
        let medical = catalog
            .for_json_line(&json!({"vat_rate": 0, "tax_profile_id": medical_id.to_string()}))
            .unwrap();
        assert_eq!(medical, Exemption::medical());
        // A category without its profile id, a line without either.
        assert_eq!(
            catalog
                .for_json_line(&json!({"vat_rate": "0", "vat_category": "exempt"}))
                .unwrap()
                .reason,
            "Steuerfreie Leistung"
        );
        assert_eq!(
            catalog.for_json_line(&json!({"vat_rate": "0"})),
            Some(Exemption::medical())
        );
        assert_eq!(catalog.for_json_line(&json!({"vat_rate": "19"})), None);
    }

    #[test]
    fn a_pass_through_cost_is_a_durchlaufender_posten() {
        let (catalog, exempt_id, _) = catalog();
        let line = json!({
            "vat_rate": "0",
            "is_cost_passthrough": true,
            "tax_profile_id": exempt_id.to_string(),
        });
        let exemption = catalog.for_json_line(&line).unwrap();
        assert!(exemption.pass_through);
        assert_eq!(exemption.reason, PASSTHROUGH_REASON);
        assert!(PASSTHROUGH_REASON.contains("§ 10 Abs. 1 Satz 5 UStG"));
    }
}
