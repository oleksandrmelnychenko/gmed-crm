//! Credit notes (Rechnungskorrekturen) per invoice line and per VAT rate.
//!
//! A credit note reduces selected invoice lines, so its VAT follows the rates
//! of those lines: crediting a 0 % pass-through hotel line credits no VAT,
//! crediting a 19 % service credits 19 % VAT. Staff either pick lines (in full
//! or with a partial gross amount per line) or credit an amount within one
//! VAT rate, which is spread over that rate's lines by their remaining amount.
//!
//! Credit notes created before line-level credits (`legacy_pro_rata`) carry no
//! lines; for the remaining amount per line they count as spread pro rata over
//! the invoice lines, which is how their VAT was computed.

use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::str::FromStr;

use crate::money::{self, CommercialRounding};

pub(crate) const CREDIT_MODE_LINES: &str = "lines";
pub(crate) const CREDIT_MODE_VAT_RATE: &str = "vat_rate";
pub(crate) const CREDIT_MODE_LEGACY: &str = "legacy_pro_rata";

fn json_decimal(item: &Value, key: &str) -> Option<Decimal> {
    match item.get(key)? {
        Value::String(text) => Decimal::from_str(text.trim()).ok(),
        Value::Number(number) => Decimal::from_str(&number.to_string()).ok(),
        _ => None,
    }
}

fn share(amount: Decimal, part: Decimal, total: Decimal) -> Decimal {
    if amount.is_zero() || part.is_zero() || total.is_zero() {
        Decimal::ZERO
    } else {
        money::round_cents(amount * part / total)
    }
}

/// One invoice line with what active credit notes already took from it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CreditableLine {
    pub index: usize,
    pub description: String,
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    /// Rate printed on the line; lines of old invoices without a rate use the
    /// rate implied by their VAT and net amounts.
    pub vat_rate: Decimal,
    pub is_cost_passthrough: bool,
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
    pub credited_net: Decimal,
    pub credited_vat: Decimal,
    pub credited_gross: Decimal,
}

impl CreditableLine {
    pub fn remaining_gross(&self) -> Decimal {
        (self.gross - self.credited_gross).max(Decimal::ZERO)
    }

    pub fn remaining_vat(&self) -> Decimal {
        (self.vat - self.credited_vat).max(Decimal::ZERO)
    }

    pub fn to_json(&self) -> Value {
        json!({
            "line_index": self.index,
            "description": self.description,
            "quantity": self.quantity.map(money::money_string),
            "unit_price": self.unit_price.map(money::money_string),
            "vat_rate": self.vat_rate.normalize().to_string(),
            "is_cost_passthrough": self.is_cost_passthrough,
            "line_net": money::money_string(self.net),
            "line_vat": money::money_string(self.vat),
            "line_gross": money::money_string(self.gross),
            "credited_net": money::money_string(self.credited_net),
            "credited_gross": money::money_string(self.credited_gross),
            "remaining_gross": money::money_string(self.remaining_gross()),
            "remaining_vat": money::money_string(self.remaining_vat()),
        })
    }
}

/// An active (not reversed) credit note of the invoice.
#[derive(Debug, Clone)]
pub(crate) struct ExistingCredit {
    pub vat: Decimal,
    pub gross: Decimal,
    /// Credited lines; `None` for a legacy pro-rata credit note.
    pub lines: Option<Vec<CreditNoteLine>>,
}

/// One credited line as stored in `invoice_credit_note_transactions.line_items`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CreditNoteLine {
    pub invoice_line_index: usize,
    pub description: String,
    /// Quantity and unit price are set when the whole line is credited.
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub vat_rate: Decimal,
    pub is_cost_passthrough: bool,
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
}

impl CreditNoteLine {
    pub fn to_json(&self) -> Value {
        json!({
            "invoice_line_index": self.invoice_line_index,
            "description": self.description,
            "quantity": self.quantity.map(money::money_string),
            "unit_price": self.unit_price.map(money::money_string),
            "vat_rate": self.vat_rate.normalize().to_string(),
            "is_cost_passthrough": self.is_cost_passthrough,
            "line_net": money::money_string(self.net),
            "line_vat": money::money_string(self.vat),
            "line_gross": money::money_string(self.gross),
        })
    }

    pub fn from_json(item: &Value) -> Option<Self> {
        Some(Self {
            invoice_line_index: usize::try_from(item.get("invoice_line_index")?.as_u64()?).ok()?,
            description: item
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            quantity: json_decimal(item, "quantity"),
            unit_price: json_decimal(item, "unit_price"),
            vat_rate: json_decimal(item, "vat_rate").unwrap_or(Decimal::ZERO),
            is_cost_passthrough: item
                .get("is_cost_passthrough")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            net: json_decimal(item, "line_net").unwrap_or(Decimal::ZERO),
            vat: json_decimal(item, "line_vat").unwrap_or(Decimal::ZERO),
            gross: json_decimal(item, "line_gross").unwrap_or(Decimal::ZERO),
        })
    }
}

/// Parses stored credited lines; `None` when the column is NULL (legacy).
pub(crate) fn parse_credit_note_lines(value: Option<&Value>) -> Option<Vec<CreditNoteLine>> {
    let items = value?.as_array()?;
    Some(items.iter().filter_map(CreditNoteLine::from_json).collect())
}

/// Net, VAT and gross per VAT rate of credited lines, ascending by rate.
pub(crate) fn vat_breakdown(lines: &[CreditNoteLine]) -> Vec<(Decimal, Decimal, Decimal, Decimal)> {
    let mut rates: Vec<(Decimal, Decimal, Decimal, Decimal)> = Vec::new();
    for line in lines {
        let rate = line.vat_rate.normalize();
        match rates.iter_mut().find(|(existing, ..)| *existing == rate) {
            Some((_, net, vat, gross)) => {
                *net += line.net;
                *vat += line.vat;
                *gross += line.gross;
            }
            None => rates.push((rate, line.net, line.vat, line.gross)),
        }
    }
    rates.sort_by_key(|entry| entry.0);
    rates
}

pub(crate) fn vat_breakdown_json(lines: &[CreditNoteLine]) -> Value {
    Value::Array(
        vat_breakdown(lines)
            .into_iter()
            .map(|(rate, net, vat, gross)| {
                json!({
                    "vat_rate": rate.to_string(),
                    "net": money::money_string(net),
                    "vat": money::money_string(vat),
                    "gross": money::money_string(gross),
                })
            })
            .collect(),
    )
}

fn effective_vat_rate(item: &Value, net: Decimal, vat: Decimal) -> Decimal {
    if let Some(rate) = json_decimal(item, "vat_rate") {
        return rate.round_commercial(2).normalize();
    }
    if net > Decimal::ZERO {
        (vat * Decimal::ONE_HUNDRED / net)
            .round_commercial(2)
            .normalize()
    } else {
        Decimal::ZERO
    }
}

/// Invoice lines with what active credit notes already credited on each.
pub(crate) fn creditable_lines(
    line_items: &Value,
    credits: &[ExistingCredit],
) -> Vec<CreditableLine> {
    let mut lines = line_items
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let gross = json_decimal(item, "line_gross").unwrap_or(Decimal::ZERO);
            let vat = json_decimal(item, "line_vat").unwrap_or(Decimal::ZERO);
            let net = json_decimal(item, "line_net").unwrap_or(gross - vat);
            CreditableLine {
                index,
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                quantity: json_decimal(item, "quantity"),
                unit_price: json_decimal(item, "unit_price"),
                vat_rate: effective_vat_rate(item, net, vat),
                is_cost_passthrough: item
                    .get("is_cost_passthrough")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                net,
                vat,
                gross,
                credited_net: Decimal::ZERO,
                credited_vat: Decimal::ZERO,
                credited_gross: Decimal::ZERO,
            }
        })
        .collect::<Vec<_>>();

    let total_gross: Decimal = lines.iter().map(|line| line.gross).sum();
    for credit in credits {
        match &credit.lines {
            Some(credited) => {
                for credited_line in credited {
                    if let Some(line) = lines.get_mut(credited_line.invoice_line_index) {
                        line.credited_net += credited_line.net;
                        line.credited_vat += credited_line.vat;
                        line.credited_gross += credited_line.gross;
                    }
                }
            }
            None => {
                // Legacy pro-rata credit: spread by line gross, the last line
                // takes the rounding remainder.
                let count = lines.len();
                let mut left_gross = credit.gross;
                let mut left_vat = credit.vat;
                for (position, line) in lines.iter_mut().enumerate() {
                    let (gross, vat) = if position + 1 == count {
                        (left_gross, left_vat)
                    } else {
                        (
                            share(credit.gross, line.gross, total_gross),
                            share(credit.vat, line.gross, total_gross),
                        )
                    };
                    left_gross -= gross;
                    left_vat -= vat;
                    line.credited_gross += gross;
                    line.credited_vat += vat;
                    line.credited_net += gross - vat;
                }
            }
        }
    }
    lines
}

/// What staff asked to credit.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CreditSelection {
    /// Invoice lines, each in full (`None`) or with a gross amount.
    Lines(Vec<(usize, Option<Decimal>)>),
    /// A gross amount within one VAT rate.
    VatRate {
        rate: Decimal,
        amount_gross: Decimal,
    },
    /// A gross amount without lines or rate (older clients): accepted only
    /// when every open line of the invoice has the same VAT rate.
    Amount(Decimal),
}

impl CreditSelection {
    /// Normalised form stored with the credit note for idempotent replays.
    pub fn to_json(&self) -> Value {
        match self {
            Self::Lines(lines) => json!({
                "lines": lines
                    .iter()
                    .map(|(index, amount)| json!({
                        "line_index": index,
                        "amount_gross": amount.map(money::money_string),
                    }))
                    .collect::<Vec<_>>(),
            }),
            Self::VatRate { rate, amount_gross } => json!({
                "vat_rate": rate.normalize().to_string(),
                "amount_gross": money::money_string(*amount_gross),
            }),
            Self::Amount(amount_gross) => json!({
                "amount_gross": money::money_string(*amount_gross),
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CreditPlanError {
    NothingSelected,
    LineNotFound,
    LineSelectedTwice,
    InvalidAmount,
    LineExceeded,
    NoLinesForVatRate,
    VatRateExceeded,
    SeveralVatRates,
    InvoiceFullyCredited,
}

impl CreditPlanError {
    pub fn message(self) -> &'static str {
        match self {
            Self::NothingSelected => "Select at least one invoice line to credit",
            Self::LineNotFound => "Credited invoice line does not exist",
            Self::LineSelectedTwice => "An invoice line was selected more than once",
            Self::InvalidAmount => "Credit-note amount must be greater than zero",
            Self::LineExceeded => "Credit note exceeds the remaining amount of an invoice line",
            Self::NoLinesForVatRate => "The invoice has no open lines with this VAT rate",
            Self::VatRateExceeded => "Credit note exceeds the remaining amount of this VAT rate",
            Self::SeveralVatRates => {
                "The invoice has several VAT rates: select the credited lines or a VAT rate"
            }
            Self::InvoiceFullyCredited => "The invoice is already fully credited",
        }
    }

    /// Conflicts with the current invoice state answer 409, malformed
    /// selections 422.
    pub fn is_conflict(self) -> bool {
        matches!(
            self,
            Self::LineExceeded | Self::VatRateExceeded | Self::InvoiceFullyCredited
        )
    }
}

/// Credited lines and totals of a new credit note.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CreditNotePlan {
    pub mode: &'static str,
    pub lines: Vec<CreditNoteLine>,
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
}

impl CreditNotePlan {
    /// Stored `line_items`: `None` for a credit note without lines.
    pub fn line_items_json(&self) -> Option<Value> {
        (!self.lines.is_empty())
            .then(|| Value::Array(self.lines.iter().map(CreditNoteLine::to_json).collect()))
    }

    /// Invoices without stored lines (early advance invoices) can only take an
    /// amount; its VAT keeps the invoice's overall VAT share.
    pub fn without_lines(amount_gross: Decimal, total_vat: Decimal, total_gross: Decimal) -> Self {
        let gross = amount_gross.round_cents();
        let vat = share(gross, total_vat, total_gross).min(gross);
        Self {
            mode: CREDIT_MODE_LEGACY,
            lines: Vec::new(),
            net: gross - vat,
            vat,
            gross,
        }
    }
}

/// Credit `amount` (rounded gross) of one line. VAT follows the line's
/// remaining VAT share, so crediting what is left of a line always credits
/// exactly its remaining VAT.
fn credit_line(line: &CreditableLine, amount: Decimal) -> CreditNoteLine {
    let remaining = line.remaining_gross();
    let vat = if amount == remaining {
        line.remaining_vat()
    } else {
        share(amount, line.remaining_vat(), remaining).min(amount)
    };
    let whole_line = amount == line.gross && line.credited_gross.is_zero();
    CreditNoteLine {
        invoice_line_index: line.index,
        description: line.description.clone(),
        quantity: if whole_line { line.quantity } else { None },
        unit_price: if whole_line { line.unit_price } else { None },
        vat_rate: line.vat_rate,
        is_cost_passthrough: line.is_cost_passthrough,
        net: amount - vat,
        vat,
        gross: amount,
    }
}

fn finish(mode: &'static str, lines: Vec<CreditNoteLine>) -> CreditNotePlan {
    let net = lines
        .iter()
        .map(|line| line.net)
        .sum::<Decimal>()
        .round_cents();
    let vat = lines
        .iter()
        .map(|line| line.vat)
        .sum::<Decimal>()
        .round_cents();
    let gross = lines
        .iter()
        .map(|line| line.gross)
        .sum::<Decimal>()
        .round_cents();
    CreditNotePlan {
        mode,
        lines,
        net,
        vat,
        gross,
    }
}

/// Spread `amount` over the open lines of one VAT rate by their remaining
/// gross; rounding cents go to the lines that still have room, in order.
fn plan_vat_rate(
    lines: &[CreditableLine],
    rate: Decimal,
    amount: Decimal,
) -> Result<CreditNotePlan, CreditPlanError> {
    let rate = rate.round_commercial(2).normalize();
    let candidates = lines
        .iter()
        .filter(|line| line.vat_rate == rate && line.remaining_gross() > Decimal::ZERO)
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Err(CreditPlanError::NoLinesForVatRate);
    }
    let open: Decimal = candidates.iter().map(|line| line.remaining_gross()).sum();
    if amount > open {
        return Err(CreditPlanError::VatRateExceeded);
    }
    let mut shares = candidates
        .iter()
        .map(|line| share(amount, line.remaining_gross(), open).min(line.remaining_gross()))
        .collect::<Vec<_>>();
    let cent = Decimal::new(1, 2);
    let mut left = amount - shares.iter().copied().sum::<Decimal>();
    while left != Decimal::ZERO {
        let before = left;
        for (position, line) in candidates.iter().enumerate() {
            if left > Decimal::ZERO && shares[position] < line.remaining_gross() {
                let step = cent
                    .min(left)
                    .min(line.remaining_gross() - shares[position]);
                shares[position] += step;
                left -= step;
            } else if left < Decimal::ZERO && shares[position] > Decimal::ZERO {
                let step = cent.min(-left).min(shares[position]);
                shares[position] -= step;
                left += step;
            }
            if left == Decimal::ZERO {
                break;
            }
        }
        if left == before {
            return Err(CreditPlanError::VatRateExceeded);
        }
    }
    Ok(finish(
        CREDIT_MODE_VAT_RATE,
        candidates
            .iter()
            .zip(shares)
            .filter(|(_, amount)| *amount > Decimal::ZERO)
            .map(|(line, amount)| credit_line(line, amount))
            .collect(),
    ))
}

/// Credited lines, VAT and totals for `selection`.
pub(crate) fn plan_credit_note(
    lines: &[CreditableLine],
    selection: &CreditSelection,
) -> Result<CreditNotePlan, CreditPlanError> {
    match selection {
        CreditSelection::Lines(selected) => {
            if selected.is_empty() {
                return Err(CreditPlanError::NothingSelected);
            }
            let mut seen = BTreeSet::new();
            let mut credited = Vec::with_capacity(selected.len());
            for (index, amount) in selected {
                if !seen.insert(*index) {
                    return Err(CreditPlanError::LineSelectedTwice);
                }
                let line = lines.get(*index).ok_or(CreditPlanError::LineNotFound)?;
                let remaining = line.remaining_gross();
                let amount = match amount {
                    Some(value) => value.round_cents(),
                    None => remaining,
                };
                if amount <= Decimal::ZERO {
                    return Err(if amount.is_zero() && remaining.is_zero() {
                        CreditPlanError::LineExceeded
                    } else {
                        CreditPlanError::InvalidAmount
                    });
                }
                if amount > remaining {
                    return Err(CreditPlanError::LineExceeded);
                }
                credited.push(credit_line(line, amount));
            }
            Ok(finish(CREDIT_MODE_LINES, credited))
        }
        CreditSelection::VatRate { rate, amount_gross } => {
            let amount = amount_gross.round_cents();
            if amount <= Decimal::ZERO {
                return Err(CreditPlanError::InvalidAmount);
            }
            plan_vat_rate(lines, *rate, amount)
        }
        CreditSelection::Amount(amount_gross) => {
            let amount = amount_gross.round_cents();
            if amount <= Decimal::ZERO {
                return Err(CreditPlanError::InvalidAmount);
            }
            let rates = lines
                .iter()
                .filter(|line| line.remaining_gross() > Decimal::ZERO)
                .map(|line| line.vat_rate)
                .collect::<BTreeSet<_>>();
            match rates.len() {
                0 => Err(CreditPlanError::InvoiceFullyCredited),
                1 => plan_vat_rate(
                    lines,
                    *rates.iter().next().unwrap_or(&Decimal::ZERO),
                    amount,
                ),
                _ => Err(CreditPlanError::SeveralVatRates),
            }
        }
    }
}

/// Credited amounts split into the accounting categories of an invoice:
/// `(passthrough_gross, passthrough_vat)` of the credit. Legacy credits count
/// pro rata to the invoice's pass-through share, like their VAT did.
pub(crate) fn credited_passthrough(
    credit: &ExistingCredit,
    invoice_passthrough_gross: Decimal,
    invoice_passthrough_vat: Decimal,
    invoice_total_gross: Decimal,
) -> (Decimal, Decimal) {
    match &credit.lines {
        Some(lines) => lines
            .iter()
            .filter(|line| line.is_cost_passthrough)
            .fold((Decimal::ZERO, Decimal::ZERO), |(gross, vat), line| {
                (gross + line.gross, vat + line.vat)
            }),
        None => (
            share(credit.gross, invoice_passthrough_gross, invoice_total_gross),
            share(credit.gross, invoice_passthrough_vat, invoice_total_gross),
        ),
    }
}

/// Active (not reversed) credit notes of an invoice, oldest first.
pub(crate) async fn load_active_credits(
    conn: &mut sqlx::PgConnection,
    invoice_id: uuid::Uuid,
) -> Result<Vec<ExistingCredit>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(
        r#"SELECT credit.amount_net, credit.amount_vat, credit.amount_gross, credit.line_items
           FROM invoice_credit_note_transactions credit
           WHERE credit.invoice_id = $1
             AND credit.transaction_type = 'credit_note'
             AND NOT EXISTS (
                 SELECT 1 FROM invoice_credit_note_transactions reversal
                 WHERE reversal.reverses_transaction_id = credit.id
                   AND reversal.transaction_type = 'reversal'
             )
           ORDER BY credit.issued_on, credit.created_at, credit.id"#,
    )
    .bind(invoice_id)
    .fetch_all(conn)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(ExistingCredit {
                vat: row.try_get("amount_vat")?,
                gross: row.try_get("amount_gross")?,
                lines: parse_credit_note_lines(
                    row.try_get::<Option<Value>, _>("line_items")?.as_ref(),
                ),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).expect("decimal literal")
    }

    /// Service 518.50 gross at 19 % and a 481.50 pass-through hotel at 0 %.
    fn mixed_invoice() -> Value {
        json!([
            {
                "description": "Organisation",
                "quantity": "1",
                "unit_price": "435.71",
                "vat_rate": "19",
                "is_cost_passthrough": false,
                "line_net": "435.71",
                "line_vat": "82.78",
                "line_gross": "518.49"
            },
            {
                "description": "Hotel",
                "quantity": "3",
                "unit_price": "160.5",
                "vat_rate": "0",
                "is_cost_passthrough": true,
                "line_net": "481.50",
                "line_vat": "0",
                "line_gross": "481.50"
            }
        ])
    }

    #[test]
    fn crediting_the_zero_rated_hotel_line_credits_no_vat() {
        let lines = creditable_lines(&mixed_invoice(), &[]);
        let plan = plan_credit_note(&lines, &CreditSelection::Lines(vec![(1, None)])).unwrap();
        assert_eq!(plan.mode, CREDIT_MODE_LINES);
        assert_eq!(plan.gross, dec("481.50"));
        assert_eq!(plan.vat, Decimal::ZERO);
        assert_eq!(plan.net, dec("481.50"));
        assert_eq!(plan.lines[0].quantity, Some(dec("3")));
        assert!(plan.lines[0].is_cost_passthrough);
    }

    #[test]
    fn partial_line_credits_follow_the_line_vat_and_exhaust_it_exactly() {
        let lines = creditable_lines(&mixed_invoice(), &[]);
        let first =
            plan_credit_note(&lines, &CreditSelection::Lines(vec![(0, Some(dec("100")))])).unwrap();
        assert_eq!(first.vat, dec("15.97"));
        assert_eq!(first.lines[0].quantity, None);
        let lines = creditable_lines(
            &mixed_invoice(),
            &[ExistingCredit {
                vat: first.vat,
                gross: first.gross,
                lines: Some(first.lines.clone()),
            }],
        );
        assert_eq!(lines[0].remaining_gross(), dec("418.49"));
        let rest = plan_credit_note(&lines, &CreditSelection::Lines(vec![(0, None)])).unwrap();
        assert_eq!(rest.gross, dec("418.49"));
        assert_eq!(first.vat + rest.vat, dec("82.78"));
        assert_eq!(
            plan_credit_note(
                &lines,
                &CreditSelection::Lines(vec![(0, Some(dec("418.50")))])
            ),
            Err(CreditPlanError::LineExceeded)
        );
    }

    #[test]
    fn vat_rate_credit_spreads_over_the_lines_of_that_rate() {
        let invoice = json!([
            {"description": "A", "vat_rate": "19", "line_net": "100", "line_vat": "19", "line_gross": "119"},
            {"description": "B", "vat_rate": "0", "line_net": "50", "line_vat": "0", "line_gross": "50"},
            {"description": "C", "vat_rate": "19", "line_net": "200", "line_vat": "38", "line_gross": "238"}
        ]);
        let lines = creditable_lines(&invoice, &[]);
        let plan = plan_credit_note(
            &lines,
            &CreditSelection::VatRate {
                rate: dec("19.00"),
                amount_gross: dec("100"),
            },
        )
        .unwrap();
        assert_eq!(plan.mode, CREDIT_MODE_VAT_RATE);
        assert_eq!(plan.gross, dec("100"));
        assert_eq!(
            plan.lines
                .iter()
                .map(|line| line.invoice_line_index)
                .collect::<Vec<_>>(),
            vec![0, 2]
        );
        assert_eq!(plan.lines[0].gross, dec("33.33"));
        assert_eq!(plan.lines[1].gross, dec("66.67"));
        // Sum of the rounded per-line VAT (5.32 + 10.64), like invoice totals.
        assert_eq!(plan.vat, dec("15.96"));
        assert_eq!(
            plan_credit_note(
                &lines,
                &CreditSelection::VatRate {
                    rate: dec("7"),
                    amount_gross: dec("1"),
                },
            ),
            Err(CreditPlanError::NoLinesForVatRate)
        );
        assert_eq!(
            plan_credit_note(
                &lines,
                &CreditSelection::VatRate {
                    rate: dec("0"),
                    amount_gross: dec("50.01"),
                },
            ),
            Err(CreditPlanError::VatRateExceeded)
        );
    }

    #[test]
    fn a_plain_amount_is_refused_on_mixed_rate_invoices_and_accepted_on_single_rate_ones() {
        let lines = creditable_lines(&mixed_invoice(), &[]);
        assert_eq!(
            plan_credit_note(&lines, &CreditSelection::Amount(dec("481.50"))),
            Err(CreditPlanError::SeveralVatRates)
        );
        let single = json!([
            {"description": "Care", "quantity": "1", "line_net": "84.03", "line_vat": "15.97", "line_gross": "100"}
        ]);
        let lines = creditable_lines(&single, &[]);
        let plan = plan_credit_note(&lines, &CreditSelection::Amount(dec("40"))).unwrap();
        assert_eq!(plan.gross, dec("40"));
        assert_eq!(plan.vat, dec("6.39"));
        assert_eq!(plan.net, dec("33.61"));
    }

    #[test]
    fn legacy_pro_rata_credits_reduce_every_line_by_its_share() {
        let lines = creditable_lines(
            &mixed_invoice(),
            &[ExistingCredit {
                vat: dec("53.91"),
                gross: dec("481.50"),
                lines: None,
            }],
        );
        assert_eq!(
            lines[0].credited_gross + lines[1].credited_gross,
            dec("481.50")
        );
        assert_eq!(lines[0].credited_vat + lines[1].credited_vat, dec("53.91"));
        assert_eq!(
            lines[0].remaining_gross() + lines[1].remaining_gross(),
            dec("518.49")
        );
    }

    #[test]
    fn vat_breakdown_groups_credited_lines_by_rate() {
        let lines = creditable_lines(&mixed_invoice(), &[]);
        let plan =
            plan_credit_note(&lines, &CreditSelection::Lines(vec![(0, None), (1, None)])).unwrap();
        let breakdown = vat_breakdown(&plan.lines);
        assert_eq!(breakdown.len(), 2);
        assert_eq!(breakdown[0].0, Decimal::ZERO);
        assert_eq!(breakdown[1].0, dec("19"));
        assert_eq!(breakdown[1].2, dec("82.78"));
        let stored = parse_credit_note_lines(plan.line_items_json().as_ref()).unwrap();
        assert_eq!(stored, plan.lines);
        let without_lines = CreditNotePlan::without_lines(dec("50"), dec("15.97"), dec("100"));
        assert_eq!(without_lines.mode, CREDIT_MODE_LEGACY);
        assert_eq!(without_lines.vat, dec("7.99"));
        assert!(without_lines.line_items_json().is_none());
    }

    #[test]
    fn passthrough_share_of_a_credit_follows_its_lines() {
        let lines = creditable_lines(&mixed_invoice(), &[]);
        let plan = plan_credit_note(&lines, &CreditSelection::Lines(vec![(1, None)])).unwrap();
        let credit = ExistingCredit {
            vat: plan.vat,
            gross: plan.gross,
            lines: Some(plan.lines),
        };
        assert_eq!(
            credited_passthrough(&credit, dec("481.50"), Decimal::ZERO, dec("999.99")),
            (dec("481.50"), Decimal::ZERO)
        );
        let legacy = ExistingCredit {
            vat: dec("15.97"),
            gross: dec("100"),
            lines: None,
        };
        assert_eq!(
            credited_passthrough(&legacy, dec("481.50"), Decimal::ZERO, dec("999.99")),
            (dec("48.15"), Decimal::ZERO)
        );
    }
}
