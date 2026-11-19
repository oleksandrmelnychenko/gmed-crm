//! «Schlussrechnung» with nothing left to bill (QA2 D S2-2, 2026-11-19).
//!
//! Interim invoices may bill every estimate line before the order ends. The
//! final invoice still closes the order's billing (services, waivers, the
//! order's billing state) and names the interim invoices before it. With
//! nothing left it carries one informational line at 0,00 € so it stays an
//! EN 16931 invoice (BR-16: at least one line): VAT category and rate of the
//! order's own services (S 19 % with 0 basis, or E for a 0 % service), or
//! the pass-through mapping when the estimate holds pass-through costs only.
//! Its payable amount is 0.

use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::Row;

use super::final_delivery;
use crate::money;

/// Invoice line source of the informational closing line.
pub(crate) const CLOSING_LINE_SOURCE: &str = "final_closing";

/// The order may be closed by a final without lines: every estimate line is
/// billed by released interim invoices, no service outside the estimate is
/// waiting, and no final invoice is active. Returns the interim numbers.
pub(super) async fn closing_interims(
    db: &sqlx::PgPool,
    ctx: &super::QuoteInvoiceContext,
) -> Result<Option<Vec<String>>, sqlx::Error> {
    if ctx.order_contract_terminated {
        return Ok(None);
    }
    let quote_lines = ctx
        .line_items
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let delivery = final_delivery::delivery_plan(
        quote_lines,
        &ctx.order_service_facts,
        ctx.editing_invoice_id,
    );
    if !delivery.extras.is_empty() {
        return Ok(None);
    }
    let row = sqlx::query(
        r#"SELECT
               NOT EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(q.line_items) = 'array'
                                 THEN q.line_items ELSE '[]'::jsonb END
                        ) WITH ORDINALITY AS line(value, position)
                   LEFT JOIN quote_line_invoiced_quantities(q.id) billed
                          ON billed.quote_line_index = line.position - 1
                   WHERE COALESCE(NULLIF(line.value ->> 'quantity', '')::NUMERIC, 0)
                         > COALESCE(billed.quantity, 0)
               ) AS fully_billed,
               EXISTS (
                   SELECT 1 FROM invoices final_invoice
                   WHERE final_invoice.order_id = q.order_id
                     AND final_invoice.invoice_type = 'final'
                     AND final_invoice.status <> 'cancelled'
                     AND final_invoice.id IS DISTINCT FROM $2
               ) AS has_final,
               ARRAY(
                   SELECT interim.invoice_number
                   FROM invoices interim
                   WHERE interim.order_id = q.order_id
                     AND interim.quote_id IS NOT NULL
                     AND interim.invoice_type = 'interim'
                     AND interim.status <> 'cancelled'
                     AND interim.released_at IS NOT NULL
                     AND interim.invoice_number IS NOT NULL
                   ORDER BY interim.issued_at, interim.invoice_number
               ) AS interims
           FROM quotes q
           WHERE q.id = $1"#,
    )
    .bind(ctx.quote_id)
    .bind(ctx.editing_invoice_id)
    .fetch_optional(db)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let fully_billed = row.try_get::<bool, _>("fully_billed").unwrap_or(false);
    let has_final = row.try_get::<bool, _>("has_final").unwrap_or(true);
    let interims = row
        .try_get::<Vec<String>, _>("interims")
        .unwrap_or_default();
    Ok((fully_billed && !has_final && !interims.is_empty()).then_some(interims))
}

/// The informational line: «Schlussrechnung zu Auftrag … — bereits
/// abgerechnet mit INV-…» at 0,00 € in the VAT treatment of the order's own
/// services (highest rate), else of its pass-through costs.
pub(crate) fn closing_line(
    quote_lines: &[Value],
    order_number: &str,
    interims: &[String],
) -> Value {
    let own = quote_lines
        .iter()
        .filter(|line| !money::json_line_pass_through(line))
        .max_by_key(|line| line_rate(line));
    let description = format!(
        "Schlussrechnung zu Auftrag {order_number} — bereits abgerechnet mit {}",
        interims.join(", ")
    );
    let mut line = json!({
        "description": description,
        "quantity": "1",
        "unit": "unit",
        "unit_price": "0",
        "vat_rate": money::money_string(own.map(line_rate).unwrap_or(Decimal::ZERO)),
        "line_net": "0",
        "line_vat": "0",
        "line_gross": "0",
        "is_cost_passthrough": own.is_none(),
        "source": CLOSING_LINE_SOURCE,
        "quoted_quantity": "0",
    });
    let (profile_id, category) = match own {
        Some(source) => (
            source.get("tax_profile_id").cloned(),
            money::json_line_vat_category(source).map(ToOwned::to_owned),
        ),
        None => (None, Some("pass_through".to_string())),
    };
    if let Some(map) = line.as_object_mut() {
        if let Some(profile_id) = profile_id.filter(|value| !value.is_null()) {
            map.insert("tax_profile_id".to_string(), profile_id);
        }
        if let Some(category) = category {
            map.insert("vat_category".to_string(), json!(category));
        }
    }
    line
}

fn line_rate(line: &Value) -> Decimal {
    let value = match line.get("vat_rate") {
        Some(Value::String(text)) => text.trim().parse::<Decimal>().ok(),
        Some(Value::Number(number)) => number.to_string().parse::<Decimal>().ok(),
        _ => None,
    };
    value.unwrap_or(Decimal::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_closing_line_takes_the_rate_of_the_own_services() {
        let lines = vec![
            json!({"vat_rate": "0", "is_cost_passthrough": true, "vat_category": "pass_through"}),
            json!({"vat_rate": "19", "is_cost_passthrough": false, "vat_category": "standard"}),
            json!({"vat_rate": "0", "is_cost_passthrough": false, "vat_category": "zero_rated"}),
        ];
        let line = closing_line(&lines, "A-1", &["INV-1".to_string(), "INV-2".to_string()]);
        assert_eq!(line["vat_rate"], "19");
        assert_eq!(line["line_gross"], "0");
        assert_eq!(line["is_cost_passthrough"], false);
        assert_eq!(line["vat_category"], "standard");
        assert_eq!(
            line["description"],
            "Schlussrechnung zu Auftrag A-1 — bereits abgerechnet mit INV-1, INV-2"
        );
    }

    #[test]
    fn pass_through_costs_alone_close_with_the_pass_through_mapping() {
        let lines = vec![json!({"vat_rate": "0", "is_cost_passthrough": true})];
        let line = closing_line(&lines, "A-2", &["INV-3".to_string()]);
        assert_eq!(line["is_cost_passthrough"], true);
        assert_eq!(line["vat_category"], "pass_through");
        assert_eq!(line["vat_rate"], "0");
    }
}
