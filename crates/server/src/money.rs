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

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

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

    #[test]
    fn negative_lines_mirror_positive_lines() {
        let amounts = line_amounts(dec("-2.5"), dec("95"), dec("19"));
        assert_eq!(amounts.net, dec("-237.50"));
        assert_eq!(amounts.vat, dec("-45.13"));
        assert_eq!(amounts.gross, dec("-282.63"));
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
