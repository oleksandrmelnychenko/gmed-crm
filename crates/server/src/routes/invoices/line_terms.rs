//! The unit and the VAT exemption of each stored invoice line, as the printed
//! documents and the e-invoice state them (QA3, qa-fix-115):
//!
//! * the unit code (BT-130) follows the line's unit; lines billed from a quote
//!   carry no unit of their own, so the order position's catalogue unit is
//!   read through `source_order_leistung_id` (an interim's «Dolmetscherbetreuung»
//!   was `C62` instead of `HUR`);
//! * the reason for a line without VAT is its tax profile's
//!   ([`crate::tax_exemptions`]).
//!
//! Credit notes and Stornorechnungen take the terms of the invoice line they
//! correct.

use std::collections::HashMap;

use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::tax_exemptions::{Exemption, ExemptionCatalog};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct InvoiceLineTerms {
    /// The unit label of the line (`hour`, `Std.`, `day`, …).
    pub unit: Option<String>,
    /// Why the line carries no VAT; `None` for a taxed line.
    pub exemption: Option<Exemption>,
    /// The German name of a catalogue line stored with the Russian UI name
    /// (QA3: «Услуги переводчика QA2-C form» on a German invoice); `None`
    /// keeps the stored description.
    pub german_description: Option<String>,
}

/// The catalogue texts of an order position a line was billed from.
struct SourceLine {
    unit: Option<String>,
    name_de: Option<String>,
    name_ru: Option<String>,
}

/// The terms of each line of `line_items` (same order).
pub(crate) async fn invoice_line_terms(
    conn: &mut PgConnection,
    line_items: &Value,
) -> Result<Vec<InvoiceLineTerms>, sqlx::Error> {
    let lines = line_items.as_array().map(Vec::as_slice).unwrap_or_default();
    let catalog = ExemptionCatalog::load(&mut *conn).await?;
    let source_ids = lines
        .iter()
        .filter_map(source_order_line)
        .collect::<Vec<_>>();
    let mut sources = HashMap::new();
    if !source_ids.is_empty() {
        let rows = sqlx::query(
            r#"SELECT line.id,
                      COALESCE(NULLIF(BTRIM(line.agency_service_unit_label_snapshot), ''),
                               catalog.unit_label) AS unit,
                      COALESCE(NULLIF(BTRIM(line.agency_service_name_snapshot), ''),
                               catalog.service_name) AS name_de,
                      NULLIF(BTRIM(catalog.name_ru), '') AS name_ru
               FROM order_leistungen line
               LEFT JOIN agency_service_catalog catalog ON catalog.id = line.agency_service_id
               WHERE line.id = ANY($1)"#,
        )
        .bind(&source_ids)
        .fetch_all(&mut *conn)
        .await?;
        for row in rows {
            sources.insert(
                row.try_get::<Uuid, _>("id")?,
                SourceLine {
                    unit: row.try_get("unit")?,
                    name_de: row.try_get("name_de")?,
                    name_ru: row.try_get("name_ru")?,
                },
            );
        }
    }
    Ok(lines
        .iter()
        .map(|line| {
            let source = source_order_line(line).and_then(|id| sources.get(&id));
            InvoiceLineTerms {
                unit: own_unit(line)
                    .map(str::to_string)
                    .or_else(|| source.and_then(|source| source.unit.clone())),
                exemption: catalog.for_json_line(line),
                german_description: source.and_then(|source| {
                    german_description(
                        line.get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        source.name_ru.as_deref(),
                        source.name_de.as_deref(),
                    )
                }),
            }
        })
        .collect())
}

/// The German wording of a line stored with the catalogue's Russian UI name:
/// the Russian name gives way to the German
/// one; anything typed after it stays. `None` for any other description.
fn german_description(
    description: &str,
    name_ru: Option<&str>,
    name_de: Option<&str>,
) -> Option<String> {
    let (name_ru, name_de) = (name_ru?.trim(), name_de?.trim());
    if name_ru.is_empty() || name_de.is_empty() {
        return None;
    }
    let description = description.trim();
    let prefix = description.get(..name_ru.len())?;
    if prefix.to_lowercase() != name_ru.to_lowercase() {
        return None;
    }
    let rest = description[name_ru.len()..].trim();
    Some(if rest.is_empty() {
        name_de.to_string()
    } else {
        format!("{name_de} {rest}")
    })
}

/// The unit a stored line names itself; the placeholder `unit` names none.
fn own_unit(line: &Value) -> Option<&str> {
    line.get("unit")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|unit| !unit.is_empty() && !unit.eq_ignore_ascii_case("unit"))
}

fn source_order_line(line: &Value) -> Option<Uuid> {
    line.get("source_order_leistung_id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_line_with_the_russian_catalogue_name_prints_the_german_one() {
        let ru = Some("Услуги переводчика");
        let de = Some("Dolmetscherbetreuung");
        assert_eq!(
            german_description("Услуги переводчика QA2-C form", ru, de).as_deref(),
            Some("Dolmetscherbetreuung QA2-C form")
        );
        assert_eq!(
            german_description("услуги переводчика", ru, de).as_deref(),
            Some("Dolmetscherbetreuung")
        );
        assert_eq!(german_description("Dolmetscherbetreuung", ru, de), None);
        assert_eq!(german_description("Трансфер", ru, de), None);
        assert_eq!(german_description("Услуги переводчика", None, de), None);
    }

    #[test]
    fn a_line_names_its_unit_unless_it_is_the_placeholder() {
        assert_eq!(own_unit(&json!({"unit": "hour"})), Some("hour"));
        assert_eq!(own_unit(&json!({"unit": "unit"})), None);
        assert_eq!(own_unit(&json!({"unit": " "})), None);
        assert_eq!(own_unit(&json!({})), None);
    }
}
