//! Cancellation documents (Stornorechnungen) of released invoices.
//!
//! A released invoice is final (GoBD): cancelling it does not erase it but
//! issues a cancellation document with its own gapless number
//! (`invoice_storno` range), the original invoice's number and date, and every
//! invoice line with negative amounts, summed per VAT rate. Its PDF is stored
//! in the same transaction; the invoice and its cancellation document net to
//! zero in the patient's account. A draft cancelled before release was never
//! issued and gets no document.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::credit_notes::{self, CreditNoteLine};
use super::release;
use crate::money::{self, CommercialRounding};

/// Lines and totals of a cancellation document, with positive amounts (the
/// stored row negates them).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StornoPlan {
    pub lines: Vec<CreditNoteLine>,
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
}

/// Every invoice line in full. When the stored lines do not add up to the
/// invoice totals (invoices from before line data was kept), one summary line
/// carries the totals so the document always reverses exactly the invoice.
pub(crate) fn plan_storno(
    line_items: &Value,
    total_net: Decimal,
    total_vat: Decimal,
    total_gross: Decimal,
    summary_description: &str,
) -> StornoPlan {
    let lines = credit_notes::creditable_lines(line_items, &[])
        .into_iter()
        .map(|line| CreditNoteLine {
            invoice_line_index: line.index,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unit_price,
            vat_rate: line.vat_rate,
            is_cost_passthrough: line.is_cost_passthrough,
            net: line.net.round_cents(),
            vat: line.vat.round_cents(),
            gross: line.gross.round_cents(),
        })
        .collect::<Vec<_>>();
    let sum = |pick: fn(&CreditNoteLine) -> Decimal| {
        lines.iter().map(pick).sum::<Decimal>().round_cents()
    };
    if !lines.is_empty()
        && sum(|line| line.net) == total_net.round_cents()
        && sum(|line| line.vat) == total_vat.round_cents()
        && sum(|line| line.gross) == total_gross.round_cents()
    {
        return StornoPlan {
            lines,
            net: total_net.round_cents(),
            vat: total_vat.round_cents(),
            gross: total_gross.round_cents(),
        };
    }
    let vat_rate = if total_net > Decimal::ZERO {
        (total_vat * Decimal::ONE_HUNDRED / total_net)
            .round_commercial(2)
            .normalize()
    } else {
        Decimal::ZERO
    };
    StornoPlan {
        lines: vec![CreditNoteLine {
            invoice_line_index: 0,
            description: summary_description.to_string(),
            quantity: None,
            unit_price: None,
            vat_rate,
            is_cost_passthrough: false,
            net: total_net.round_cents(),
            vat: total_vat.round_cents(),
            gross: total_gross.round_cents(),
        }],
        net: total_net.round_cents(),
        vat: total_vat.round_cents(),
        gross: total_gross.round_cents(),
    }
}

fn negated(line: &CreditNoteLine) -> CreditNoteLine {
    CreditNoteLine {
        net: -line.net,
        vat: -line.vat,
        gross: -line.gross,
        ..line.clone()
    }
}

/// A cancellation document issued inside the cancelling transaction.
#[derive(Debug, Clone)]
pub(crate) struct IssuedStorno {
    pub id: Uuid,
    pub document_number: String,
    pub issued_on: NaiveDate,
    pub amount_gross: Decimal,
}

/// Issues the cancellation document of a released invoice that the caller's
/// transaction has just cancelled. The number is taken last, so the counter
/// row stays locked only briefly.
pub(crate) async fn issue_storno_tx(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    reason: &str,
    actor: Uuid,
) -> Result<IssuedStorno, sqlx::Error> {
    let invoice = sqlx::query(
        r#"SELECT invoice_number, issued_at, currency, total_net, total_vat, total_gross,
                  line_items
           FROM invoices
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(invoice_id)
    .fetch_one(&mut *conn)
    .await?;
    let invoice_number = invoice
        .try_get::<Option<String>, _>("invoice_number")?
        .unwrap_or_default();
    let invoice_date = crate::app_time::date_of(invoice.try_get::<DateTime<Utc>, _>("issued_at")?);
    let issued_on = crate::app_time::today().max(invoice_date);
    let plan = plan_storno(
        &invoice
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| json!([])),
        invoice.try_get("total_net")?,
        invoice.try_get("total_vat")?,
        invoice.try_get("total_gross")?,
        &format!("Storno der Rechnung {invoice_number}"),
    );
    let negative_lines = plan.lines.iter().map(negated).collect::<Vec<_>>();
    let line_items = Value::Array(negative_lines.iter().map(CreditNoteLine::to_json).collect());
    let vat_breakdown = credit_notes::vat_breakdown_json(&negative_lines);
    let sequence = release::next_correction_number(conn, release::SERIES_INVOICE_STORNO).await?;
    let document_number = release::storno_number(issued_on, sequence);
    let id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_storno_documents (
                invoice_id, document_number, issued_on, reason,
                original_invoice_number, original_invoice_date, currency,
                amount_net, amount_vat, amount_gross, line_items, vat_breakdown, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id"#,
    )
    .bind(invoice_id)
    .bind(&document_number)
    .bind(issued_on)
    .bind(reason)
    .bind(&invoice_number)
    .bind(invoice_date)
    .bind(invoice.try_get::<String, _>("currency")?)
    .bind(-plan.net)
    .bind(-plan.vat)
    .bind(-plan.gross)
    .bind(line_items)
    .bind(vat_breakdown)
    .bind(actor)
    .fetch_one(&mut *conn)
    .await?;
    Ok(IssuedStorno {
        id,
        document_number,
        issued_on,
        amount_gross: -plan.gross,
    })
}

/// The cancellation document of an invoice for the invoice detail, with its
/// stored PDF when kept.
pub(crate) async fn load_storno_summary(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<Value>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT storno.id, storno.document_number, storno.issued_on, storno.reason,
                  storno.original_invoice_number, storno.original_invoice_date,
                  storno.currency, storno.amount_net, storno.amount_vat, storno.amount_gross,
                  storno.vat_breakdown, storno.created_at,
                  document.file_name, document.sha256, document.generated_at,
                  document.generation_trigger
           FROM invoice_storno_documents storno
           LEFT JOIN invoice_documents document ON document.storno_document_id = storno.id
           WHERE storno.invoice_id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| {
        let amount = |column: &str| {
            money::money_string(row.try_get::<Decimal, _>(column).unwrap_or(Decimal::ZERO))
        };
        let stored_document = row
            .try_get::<Option<String>, _>("file_name")
            .unwrap_or_default()
            .map(|file_name| {
                json!({
                    "file_name": file_name,
                    "sha256": row.try_get::<Option<String>, _>("sha256").unwrap_or_default(),
                    "generation_trigger": row.try_get::<Option<String>, _>("generation_trigger").unwrap_or_default(),
                    "generated_at": row
                        .try_get::<Option<DateTime<Utc>>, _>("generated_at")
                        .unwrap_or_default()
                        .map(|value| value.to_rfc3339()),
                })
            });
        json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "document_number": row.try_get::<String, _>("document_number").unwrap_or_default(),
            "issued_on": row.try_get::<NaiveDate, _>("issued_on").map(|value| value.to_string()).unwrap_or_default(),
            "reason": row.try_get::<String, _>("reason").unwrap_or_default(),
            "original_invoice_number": row.try_get::<String, _>("original_invoice_number").unwrap_or_default(),
            "original_invoice_date": row.try_get::<NaiveDate, _>("original_invoice_date").map(|value| value.to_string()).unwrap_or_default(),
            "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
            "amount_net": amount("amount_net"),
            "amount_vat": amount("amount_vat"),
            "amount_gross": amount("amount_gross"),
            "vat_breakdown": row.try_get::<Value, _>("vat_breakdown").unwrap_or_else(|_| json!([])),
            "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            "stored_document": stored_document,
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    #[test]
    fn storno_reverses_every_line_with_its_vat_rate() {
        let lines = json!([
            {
                "description": "Organisation der Behandlung",
                "quantity": "1",
                "unit_price": "500",
                "vat_rate": "0",
                "line_net": "500.00",
                "line_vat": "0.00",
                "line_gross": "500.00"
            },
            {
                "description": "Dolmetscher",
                "quantity": "2",
                "unit_price": "60",
                "vat_rate": "19",
                "line_net": "120.00",
                "line_vat": "22.80",
                "line_gross": "142.80"
            },
            {
                "description": "Hotel",
                "quantity": "3",
                "unit_price": "160.5",
                "vat_rate": "0",
                "is_cost_passthrough": true,
                "line_net": "481.50",
                "line_vat": "0.00",
                "line_gross": "481.50"
            }
        ]);
        let plan = plan_storno(
            &lines,
            dec("1101.50"),
            dec("22.80"),
            dec("1124.30"),
            "Storno",
        );
        assert_eq!(plan.lines.len(), 3);
        assert_eq!(plan.gross, dec("1124.30"));
        assert!(plan.lines[2].is_cost_passthrough);
        let negative = plan.lines.iter().map(negated).collect::<Vec<_>>();
        let breakdown = credit_notes::vat_breakdown(&negative);
        assert_eq!(
            breakdown,
            vec![
                (Decimal::ZERO, dec("-981.50"), Decimal::ZERO, dec("-981.50")),
                (dec("19"), dec("-120.00"), dec("-22.80"), dec("-142.80")),
            ]
        );
    }

    #[test]
    fn storno_without_matching_lines_carries_the_invoice_totals() {
        let plan = plan_storno(
            &json!([]),
            dec("100.00"),
            dec("19.00"),
            dec("119.00"),
            "Storno der Rechnung INV-1",
        );
        assert_eq!(plan.lines.len(), 1);
        assert_eq!(plan.lines[0].vat_rate, dec("19"));
        assert_eq!(plan.lines[0].gross, dec("119.00"));
        assert_eq!(
            (plan.net, plan.vat, plan.gross),
            (dec("100.00"), dec("19.00"), dec("119.00"))
        );
    }
}
