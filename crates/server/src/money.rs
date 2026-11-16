//! Commercial rounding (kaufmännisches Runden) for every amount the server
//! rounds: money to cents, and quantities, rates and percentages to their
//! display precision.
//!
//! Ties are rounded half away from zero (`2.345 -> 2.35`, `-2.345 -> -2.35`).
//! `Decimal::round_dp` rounds ties to even (`45.125 -> 45.12`), which made
//! server quotes disagree with the frontend and with PostgreSQL `ROUND(numeric)`
//! / `::NUMERIC(p, 2)` casts, both of which round half away from zero. Use these
//! helpers instead of `round_dp` (enforced by `clippy.toml`).
//!
//! Line amounts follow the per-line model used by quotes, invoices, credit
//! notes and ZUGFeRD: net = round(quantity × unit price), VAT = round(net ×
//! rate / 100), gross = net + VAT; document totals are sums of rounded lines.

use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::{Decimal, RoundingStrategy};

/// Decimal places of a money amount (cents).
pub const MONEY_DECIMAL_PLACES: u32 = 2;

/// Rounds `value` to `decimal_places`, ties half away from zero.
pub fn round_commercial(value: Decimal, decimal_places: u32) -> Decimal {
    value.round_dp_with_strategy(decimal_places, RoundingStrategy::MidpointAwayFromZero)
}

/// Rounds a money amount to cents, ties half away from zero.
pub fn round_cents(value: Decimal) -> Decimal {
    round_commercial(value, MONEY_DECIMAL_PLACES)
}

/// Rounds a binary floating point money amount to cents, ties half away from
/// zero. The value is first taken at its shortest decimal form so that e.g.
/// `1.005_f64` (stored as 1.00499…) still rounds to `1.01`.
pub fn round_cents_f64(value: f64) -> f64 {
    match Decimal::from_f64(value) {
        Some(decimal) => round_cents(decimal).to_f64().unwrap_or(value),
        None => value,
    }
}

/// VAT on an already rounded net amount: `round(net × rate / 100)`.
pub fn vat_amount(net: Decimal, vat_rate_percent: Decimal) -> Decimal {
    round_cents(net * vat_rate_percent / Decimal::ONE_HUNDRED)
}

/// Rounded net, VAT and gross amounts of one document line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineAmounts {
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
}

/// Net, VAT and gross of one line: net = round(quantity × unit price),
/// VAT = round(net × rate / 100), gross = net + VAT.
pub fn line_amounts(quantity: Decimal, unit_price_net: Decimal, vat_rate: Decimal) -> LineAmounts {
    let net = round_cents(quantity * unit_price_net);
    let vat = vat_amount(net, vat_rate);
    LineAmounts {
        net,
        vat,
        gross: round_cents(net + vat),
    }
}

/// Amounts of one part of a line billed in parts (e.g. 2,5 h and 0,5 h of a
/// 3 h quote line). The part that completes the line's quantity takes exactly
/// what the line total has left after the parts billed before; any other part
/// is rounded on its own but never takes more than that rest. So the parts of
/// a line never add up to more than the line, and all of them add up to it
/// exactly (QA 2026-11-15, A-1).
pub fn line_part_amounts(
    part_quantity: Decimal,
    billed_quantity: Decimal,
    line_quantity: Decimal,
    unit_price_net: Decimal,
    vat_rate: Decimal,
    line: LineAmounts,
    billed: LineAmounts,
) -> LineAmounts {
    let rest_net = (line.net - billed.net).max(Decimal::ZERO);
    let rest_gross = (line.gross - billed.gross).max(rest_net);
    let rest = LineAmounts {
        net: rest_net,
        vat: rest_gross - rest_net,
        gross: rest_gross,
    };
    if billed_quantity + part_quantity >= line_quantity {
        return rest;
    }
    let own = line_amounts(part_quantity, unit_price_net, vat_rate);
    if own.net <= rest.net && own.gross <= rest.gross {
        own
    } else {
        rest
    }
}

/// Amounts a final invoice bills of a quote line: the delivered quantity,
/// which may pass the quoted one (owner 2026-11-17). Up to the quote it is
/// [`line_part_amounts`]; a line billed for the first time is priced as a
/// whole; otherwise the quantity beyond the quote is added at the unit price.
pub fn final_line_part_amounts(
    part_quantity: Decimal,
    billed_quantity: Decimal,
    line_quantity: Decimal,
    unit_price_net: Decimal,
    vat_rate: Decimal,
    line: LineAmounts,
    billed: LineAmounts,
) -> LineAmounts {
    let total = billed_quantity + part_quantity;
    if total <= line_quantity {
        return line_part_amounts(
            part_quantity,
            billed_quantity,
            line_quantity,
            unit_price_net,
            vat_rate,
            line,
            billed,
        );
    }
    if billed_quantity <= Decimal::ZERO {
        return line_amounts(part_quantity, unit_price_net, vat_rate);
    }
    let within = (line_quantity - billed_quantity).max(Decimal::ZERO);
    let rest = if within > Decimal::ZERO {
        line_part_amounts(
            within,
            billed_quantity,
            line_quantity,
            unit_price_net,
            vat_rate,
            line,
            billed,
        )
    } else {
        LineAmounts {
            net: Decimal::ZERO,
            vat: Decimal::ZERO,
            gross: Decimal::ZERO,
        }
    };
    let excess = line_amounts(part_quantity - within, unit_price_net, vat_rate);
    LineAmounts {
        net: rest.net + excess.net,
        vat: rest.vat + excess.vat,
        gross: rest.gross + excess.gross,
    }
}

/// Net unit price (in cents) of a single-unit line whose gross should be
/// `gross` at `vat_rate` percent, e.g. an agreed gross amount that is billed
/// as one line. Prefers a net whose [`line_amounts`] gross is exactly `gross`;
/// when no cent value hits it (rare rounding gaps), the nearest net is used and
/// the line gross differs by a cent.
pub fn net_for_gross(gross: Decimal, vat_rate: Decimal) -> Decimal {
    let gross = round_cents(gross);
    let divisor = Decimal::ONE + vat_rate / Decimal::ONE_HUNDRED;
    if divisor <= Decimal::ZERO {
        return gross;
    }
    let estimate = round_cents(gross / divisor);
    let cent = Decimal::new(1, MONEY_DECIMAL_PLACES);
    [Decimal::ZERO, -cent, cent, -cent - cent, cent + cent]
        .into_iter()
        .map(|offset| estimate + offset)
        .find(|net| line_amounts(Decimal::ONE, *net, vat_rate).gross == gross)
        .unwrap_or(estimate)
}

/// Net, VAT and gross of a single-unit line whose gross is exactly `gross`, an
/// amount agreed gross such as a required prepayment. Where no cent net reaches
/// that gross (see [`net_for_gross`]) the VAT is the rest of the gross, the VAT
/// contained in it: 87.40 at 19 % is 73.45 + 13.95, not 73.45 + 13.96 = 87.41
/// (QA 2026-11-01, W1 B1).
pub fn line_amounts_for_gross(gross: Decimal, vat_rate: Decimal) -> LineAmounts {
    let gross = round_cents(gross);
    let net = net_for_gross(gross, vat_rate);
    LineAmounts {
        net,
        vat: gross - net,
        gross,
    }
}

/// Canonical API string of a money amount: rounded to cents, trailing zeros
/// trimmed (`"282.63"`, `"95"`).
pub fn money_string(value: Decimal) -> String {
    round_cents(value).normalize().to_string()
}

/// Money amount with exactly two decimals (`"282.60"`), as required by
/// fixed-format outputs such as ZUGFeRD XML.
pub fn cents_string(value: Decimal) -> String {
    format!("{:.2}", round_cents(value))
}

/// Method form of the helpers above, for rounding at the end of an expression
/// chain (`row.try_get::<Decimal, _>("amount")?.round_cents()`).
pub trait CommercialRounding {
    /// See [`round_cents`].
    fn round_cents(self) -> Self;
    /// See [`round_commercial`].
    fn round_commercial(self, decimal_places: u32) -> Self;
}

impl CommercialRounding for Decimal {
    fn round_cents(self) -> Self {
        round_cents(self)
    }

    fn round_commercial(self, decimal_places: u32) -> Self {
        round_commercial(self, decimal_places)
    }
}

/// A non-negative euro amount as people type it: `500`, `500,00`, `1.234,56`,
/// `1234.5`, optionally followed by `€` or `EUR`. Signs, letters and anything
/// else give `None` (the framework contract printed "abc" or a lost minus
/// sign as its budget threshold, QA 2026-11-11 V-13).
pub fn parse_non_negative_amount(raw: &str) -> Option<Decimal> {
    let mut value = raw.trim();
    for suffix in ["€", "EUR", "eur", "Eur"] {
        if let Some(rest) = value.strip_suffix(suffix) {
            value = rest.trim_end();
            break;
        }
    }
    if value.is_empty()
        || !value
            .chars()
            .all(|ch| ch.is_ascii_digit() || ch == ',' || ch == '.')
    {
        return None;
    }
    let (integer, fraction) = match value.matches(',').count() {
        0 => match value.rsplit_once('.') {
            // One dot with one or two digits after it is the decimal point.
            Some((head, tail)) if !head.contains('.') && (1..=2).contains(&tail.len()) => {
                (head, tail)
            }
            _ => (value, ""),
        },
        1 => value.split_once(',')?,
        _ => return None,
    };
    if fraction.len() > 2 || !fraction.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    // "500," has a decimal comma without cents.
    if value.contains(',') && fraction.is_empty() {
        return None;
    }
    // Dots left in the integer part group thousands: "1.234.567".
    let grouped = integer.contains('.');
    let mut groups = integer.split('.');
    let first = groups.next()?;
    if first.is_empty() || (grouped && first.len() > 3) {
        return None;
    }
    let mut digits = first.to_string();
    for group in groups {
        if group.len() != 3 {
            return None;
        }
        digits.push_str(group);
    }
    let text = if fraction.is_empty() {
        digits
    } else {
        format!("{digits}.{fraction}")
    };
    text.parse::<Decimal>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn a_final_part_bills_the_delivered_quantity_above_or_below_the_quote() {
        // 3 h quoted at 60,00 net, 19 %: 180,00 / 34,20 / 214,20.
        let line = line_amounts(dec("3"), dec("60"), dec("19"));
        let none = LineAmounts {
            net: Decimal::ZERO,
            vat: Decimal::ZERO,
            gross: Decimal::ZERO,
        };
        let five = final_line_part_amounts(
            dec("5"),
            Decimal::ZERO,
            dec("3"),
            dec("60"),
            dec("19"),
            line,
            none,
        );
        assert_eq!(five.gross, dec("357.00"));
        let two = final_line_part_amounts(
            dec("2"),
            Decimal::ZERO,
            dec("3"),
            dec("60"),
            dec("19"),
            line,
            none,
        );
        assert_eq!(two.gross, dec("142.80"));
        // 1 h billed by an interim invoice, 4 h more on the final: the rest of
        // the line plus 2 h beyond it.
        let billed = line_amounts(dec("1"), dec("60"), dec("19"));
        let rest = final_line_part_amounts(
            dec("4"),
            dec("1"),
            dec("3"),
            dec("60"),
            dec("19"),
            line,
            billed,
        );
        assert_eq!(rest.net, dec("240.00"));
        assert_eq!(rest.gross, dec("285.60"));
    }

    #[test]
    fn non_negative_amounts_are_read_as_typed() {
        for (raw, expected) in [
            ("500", "500"),
            ("500,00", "500.00"),
            ("500,5", "500.5"),
            ("1.234,56", "1234.56"),
            ("1.234", "1234"),
            ("1234.5", "1234.5"),
            ("0", "0"),
            (" 750 € ", "750"),
            ("750 EUR", "750"),
        ] {
            assert_eq!(parse_non_negative_amount(raw), Some(dec(expected)), "{raw}");
        }
        for raw in [
            "", "abc", "-500", "+500", "500,", "5,000,00", "12.34.5", "1,234.56", "50 0", "500€x",
        ] {
            assert_eq!(parse_non_negative_amount(raw), None, "{raw}");
        }
    }

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).expect("decimal literal")
    }

    #[test]
    fn round_cents_rounds_midpoints_up_for_positive_amounts() {
        assert_eq!(round_cents(dec("45.125")), dec("45.13"));
        assert_eq!(round_cents(dec("0.005")), dec("0.01"));
        assert_eq!(round_cents(dec("2.345")), dec("2.35"));
        assert_eq!(round_cents(dec("2.335")), dec("2.34"));
        assert_eq!(round_cents(dec("1.004999")), dec("1.00"));
        assert_eq!(round_cents(dec("1.2")), dec("1.2"));
    }

    #[test]
    fn round_cents_rounds_negative_midpoints_away_from_zero() {
        assert_eq!(round_cents(dec("-45.125")), dec("-45.13"));
        assert_eq!(round_cents(dec("-0.005")), dec("-0.01"));
        assert_eq!(round_cents(dec("-2.345")), dec("-2.35"));
        assert_eq!(round_cents(dec("-1.004999")), dec("-1.00"));
    }

    #[test]
    fn round_commercial_applies_the_same_rule_at_any_precision() {
        assert_eq!(round_commercial(dec("0.12345"), 4), dec("0.1235"));
        assert_eq!(round_commercial(dec("-0.12345"), 4), dec("-0.1235"));
        assert_eq!(round_commercial(dec("12.25"), 1), dec("12.3"));
        assert_eq!(round_commercial(dec("2.5"), 0), dec("3"));
        assert_eq!(dec("45.125").round_commercial(2), dec("45.13"));
        assert_eq!(dec("-45.125").round_cents(), dec("-45.13"));
    }

    #[test]
    fn round_cents_f64_ignores_binary_representation_noise() {
        assert_eq!(round_cents_f64(1.005), 1.01);
        assert_eq!(round_cents_f64(-1.005), -1.01);
        assert_eq!(round_cents_f64(45.125), 45.13);
        assert_eq!(round_cents_f64(2.675), 2.68);
    }

    #[test]
    fn two_and_a_half_hours_at_95_euro_with_19_percent_vat_is_282_63_gross() {
        let amounts = line_amounts(dec("2.5"), dec("95"), dec("19"));
        assert_eq!(amounts.net, dec("237.50"));
        assert_eq!(amounts.vat, dec("45.13"));
        assert_eq!(amounts.gross, dec("282.63"));
    }

    #[test]
    fn half_and_four_and_a_half_hours_at_95_euro_round_vat_up() {
        // 0.5 h: 47.50 net, 9.025 VAT; 4.5 h: 427.50 net, 81.225 VAT.
        assert_eq!(
            line_amounts(dec("0.5"), dec("95"), dec("19")),
            LineAmounts {
                net: dec("47.50"),
                vat: dec("9.03"),
                gross: dec("56.53"),
            }
        );
        assert_eq!(
            line_amounts(dec("4.5"), dec("95"), dec("19")),
            LineAmounts {
                net: dec("427.50"),
                vat: dec("81.23"),
                gross: dec("508.73"),
            }
        );
    }

    fn part(
        part: &str,
        billed_quantity: &str,
        line: LineAmounts,
        billed: LineAmounts,
    ) -> LineAmounts {
        line_part_amounts(
            dec(part),
            dec(billed_quantity),
            dec("3"),
            dec("33.33"),
            dec("19"),
            line,
            billed,
        )
    }

    fn zero() -> LineAmounts {
        LineAmounts {
            net: Decimal::ZERO,
            vat: Decimal::ZERO,
            gross: Decimal::ZERO,
        }
    }

    fn plus(a: LineAmounts, b: LineAmounts) -> LineAmounts {
        LineAmounts {
            net: a.net + b.net,
            vat: a.vat + b.vat,
            gross: a.gross + b.gross,
        }
    }

    #[test]
    fn the_part_completing_a_line_bills_exactly_its_rest() {
        // QA 2026-11-15 A-1: 3 x 33,33 EUR = 99,99 net / 118,99 gross; 2,5 h
        // and 0,5 h were 83,33 + 16,67 = 100,00 net.
        let line = line_amounts(dec("3"), dec("33.33"), dec("19"));
        assert_eq!((line.net, line.gross), (dec("99.99"), dec("118.99")));
        let first = part("2.5", "0", line, zero());
        assert_eq!((first.net, first.gross), (dec("83.33"), dec("99.16")));
        let last = part("0.5", "2.5", line, first);
        assert_eq!(
            (last.net, last.vat, last.gross),
            (dec("16.66"), dec("3.17"), dec("19.83"))
        );
        assert_eq!(plus(first, last), line);
    }

    #[test]
    fn any_split_of_a_line_adds_up_to_the_line() {
        let line = line_amounts(dec("3"), dec("33.33"), dec("19"));
        for split in [
            vec!["1", "1.5", "0.5"],
            vec!["0.5", "2.5"],
            vec!["0.01", "0.01", "2.98"],
            vec!["1.5", "1.5"],
            vec!["0.25", "0.25", "0.25", "2.25"],
        ] {
            let mut billed = zero();
            let mut billed_quantity = Decimal::ZERO;
            for quantity in split {
                let amounts = part(quantity, &billed_quantity.to_string(), line, billed);
                billed = plus(billed, amounts);
                billed_quantity += dec(quantity);
                assert!(billed.net <= line.net && billed.gross <= line.gross);
                assert!(amounts.vat >= Decimal::ZERO);
            }
            assert_eq!(billed, line);
        }
    }

    #[test]
    fn small_parts_never_exceed_the_line_total() {
        // 7 x 0,05 EUR: each 0,01-unit part rounds to 0,00 or more, never past
        // what the 0,35 line has left.
        let line = line_amounts(dec("7"), dec("0.05"), dec("19"));
        let mut billed = zero();
        let mut billed_quantity = Decimal::ZERO;
        for _ in 0..7 {
            let amounts = line_part_amounts(
                dec("1"),
                billed_quantity,
                dec("7"),
                dec("0.05"),
                dec("19"),
                line,
                billed,
            );
            billed = plus(billed, amounts);
            billed_quantity += Decimal::ONE;
            assert!(billed.net <= line.net && billed.gross <= line.gross);
        }
        assert_eq!(billed, line);
    }

    #[test]
    fn negative_lines_mirror_positive_lines() {
        let amounts = line_amounts(dec("-2.5"), dec("95"), dec("19"));
        assert_eq!(amounts.net, dec("-237.50"));
        assert_eq!(amounts.vat, dec("-45.13"));
        assert_eq!(amounts.gross, dec("-282.63"));
    }

    #[test]
    fn net_for_gross_hits_the_agreed_gross_amount() {
        for (gross, rate) in [
            ("150", "19"),
            ("100", "19"),
            ("10", "19"),
            ("0.01", "19"),
            ("550", "0"),
            ("123.45", "7"),
            ("999.99", "19"),
        ] {
            let net = net_for_gross(dec(gross), dec(rate));
            assert_eq!(
                line_amounts(Decimal::ONE, net, dec(rate)).gross,
                dec(gross),
                "{gross} at {rate}%"
            );
        }
        assert_eq!(net_for_gross(dec("150"), dec("19")), dec("126.05"));
        assert_eq!(net_for_gross(dec("550"), dec("0")), dec("550"));
    }

    #[test]
    fn a_line_agreed_gross_keeps_that_gross_at_every_amount_and_rate() {
        for rate in ["0", "7", "19", "5.5", "10.7"] {
            let rate = dec(rate);
            for cents in 1..=100_000 {
                let gross = Decimal::new(cents, 2);
                let line = line_amounts_for_gross(gross, rate);
                assert_eq!(line.gross, gross, "{gross} at {rate}%");
                assert_eq!(line.net + line.vat, gross, "{gross} at {rate}%");
                assert!(line.vat >= Decimal::ZERO, "{gross} at {rate}%");
                // Only a cent from the VAT of the net, where a cent is off at all.
                let exact = line_amounts(Decimal::ONE, line.net, rate);
                assert!(
                    (exact.vat - line.vat).abs() <= Decimal::new(1, 2),
                    "{gross} at {rate}%"
                );
            }
        }
        let gap = line_amounts_for_gross(dec("87.40"), dec("19"));
        assert_eq!((gap.net, gap.vat), (dec("73.45"), dec("13.95")));
        let exact = line_amounts_for_gross(dec("150"), dec("19"));
        assert_eq!((exact.net, exact.vat), (dec("126.05"), dec("23.95")));
    }

    #[test]
    fn money_strings_use_commercial_rounding() {
        assert_eq!(money_string(dec("45.125")), "45.13");
        assert_eq!(money_string(dec("95.00")), "95");
        assert_eq!(money_string(dec("-0.005")), "-0.01");
        assert_eq!(cents_string(dec("282.625")), "282.63");
        assert_eq!(cents_string(dec("95")), "95.00");
        assert_eq!(cents_string(dec("-45.125")), "-45.13");
    }
}
