use super::*;
use rust_decimal::Decimal;

fn line_net(line: &Value) -> Decimal {
    let number = |key| {
        text(line, key)
            .replace(',', ".")
            .parse::<Decimal>()
            .unwrap_or_default()
    };
    (number("quantity") * number("unit_price")).round_dp(2)
}

pub(super) fn totals(data: &Value) -> Option<(String, String, String)> {
    let lines = data["lines"].as_array().filter(|lines| !lines.is_empty())?;
    let mut net = Decimal::ZERO;
    let mut vat = Decimal::ZERO;
    for line in lines {
        let amount = line_net(line);
        let rate = text(line, "vat_rate")
            .replace(',', ".")
            .parse::<Decimal>()
            .unwrap_or_default();
        net += amount;
        vat += (amount * rate / Decimal::from(100)).round_dp(2);
    }
    let format = |amount: Decimal| format_eur(amount.to_string().parse().unwrap_or_default());
    Some((format(net), format(vat), format(net + vat)))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn decimal(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(parse_eur_amount))
        .unwrap_or_default()
}

pub(super) fn apply(bindings: &mut DocumentBindingOverrides, data: &Value, template: &str) {
    if !matches!(
        template,
        "single_order" | "order_cost_estimate" | "cost_estimate"
    ) {
        return;
    }
    bindings.specialties = data["catalog_snapshot"]["specializations"]
        .as_array()
        .filter(|items| !items.is_empty())
        .map(|_| super::super::order_intakes::catalog_description("[Fachrichtung]", data));
    bindings.estimate_total = totals(data).map(|totals| totals.2);
    bindings.service_lines = data["lines"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|line| {
            let catalog = data["catalog_snapshot"]["services"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|service| service["id"] == line["agency_service_id"]);
            let unit = catalog
                .map(|service| text(service, "unit_label"))
                .unwrap_or_default();
            let description_items: Vec<crate::service_description::ServiceDescriptionItem> =
                catalog
                    .and_then(|service| service["description_items"].as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|item| {
                        Some(crate::service_description::ServiceDescriptionItem {
                            id: item["id"].as_str()?.to_string(),
                            text: super::super::order_intakes::catalog_description(
                                item["text"].as_str()?,
                                data,
                            ),
                        })
                    })
                    .collect();
            let note = if description_items.is_empty() {
                catalog
                    .map(|service| {
                        super::super::order_intakes::catalog_description(
                            text(service, "description"),
                            data,
                        )
                    })
                    .filter(|value| !value.is_empty())
            } else {
                crate::service_description::items_text(&description_items)
            };
            ServiceLineInput {
                description: text(line, "description").to_string(),
                description_items: (!description_items.is_empty()).then_some(description_items),
                fee: Some(format!(
                    "{}{}",
                    format_eur(decimal(&line["unit_price"])),
                    if unit.is_empty() {
                        String::new()
                    } else {
                        format!(" / {unit}")
                    }
                )),
                quantity: Some(format!(
                    "{}{}",
                    text(line, "quantity"),
                    if unit.is_empty() {
                        String::new()
                    } else {
                        format!(" {unit}")
                    }
                )),
                line_total: Some(format_eur(
                    line_net(line).to_string().parse().unwrap_or_default(),
                )),
                vat_rate: Some(text(line, "vat_rate").to_string()),
                note,
            }
        })
        .collect();
}

pub(super) fn estimate_selection(context: &Value) -> Option<GeneratedCostEstimateCatalogSelection> {
    let data = &context["data"];
    let work_types = data["catalog_snapshot"]["work_types"]
        .as_array()
        .filter(|items| !items.is_empty())?;
    let mut minimum = 0.0;
    let mut maximum = 0.0;
    let line_items = work_types
        .iter()
        .map(|item| {
            let min = decimal(&item["min_price_eur"]);
            let max = decimal(&item["max_price_eur"]);
            // Keep the estimate calculation identical to the main lead wizard.
            let duration = item["duration_hours"].as_i64().unwrap_or(1);
            minimum += min * duration as f64;
            maximum += max * duration as f64;
            let descriptions: Vec<(String, String)> = item["descriptions"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|description| {
                    (
                        text(description, "language_code").to_string(),
                        text(description, "body").to_string(),
                    )
                })
                .collect();
            GeneratedContractLineItem {
                description_items: None,
                localized_sections: localized_estimate_work_type_sections(
                    data["cost_estimate_additional_language"].as_str(),
                    text(item, "name_de"),
                    text(item, "name_ru"),
                    text(item, "name_en"),
                    text(item, "name_es"),
                    &descriptions,
                ),
                description: String::new(),
                quantity: duration.to_string(),
                unit_price: format_eur_range(min, max),
                line_gross: format_eur_range(min * duration as f64, max * duration as f64),
                vat_rate: None,
                notes: None,
            }
        })
        .collect();
    Some(GeneratedCostEstimateCatalogSelection {
        line_items,
        total_range: format_eur_range(minimum, maximum),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn intake_documents_resolve_catalog_context_and_match_main_estimate() {
        let data = json!({"date_from":"2026-09-14","date_to":"2026-09-19","cost_estimate_additional_language":"ru",
            "lines":[{"agency_service_id":"service","description":"Coordination","quantity":"19","unit_price":"60","vat_rate":"19"}],
            "catalog_snapshot":{"specializations":[{"name_de":"Urologie"}],
            "services":[{"id":"service","unit_label":"Std.","description_items":[{"id":"scope","text":"[Datum Beginn] bis [Datum Ende]: [Fachrichtung 1], [Fachrichtung 2]"}]}],
            "work_types":[{"name_de":"Operation","name_ru":"Операция","duration_hours":15,"min_price_eur":28000,"max_price_eur":35000,"descriptions":[]}]}});
        let mut bindings = DocumentBindingOverrides::default();
        apply(&mut bindings, &data, "single_order");
        assert_eq!(
            bindings.service_lines[0].note.as_deref(),
            Some("14.09.2026 bis 19.09.2026: Urologie")
        );
        assert_eq!(
            bindings.service_lines[0].line_total.as_deref(),
            Some("1.140,00 EUR")
        );
        assert_eq!(bindings.specialties.as_deref(), Some("Urologie"));
        assert_eq!(bindings.estimate_total.as_deref(), Some("1.356,60 EUR"));
        let selection = estimate_selection(&json!({"data":data})).unwrap();
        assert_eq!(
            selection.line_items[0].unit_price,
            "28.000,00 - 35.000,00 EUR"
        );
        assert_eq!(selection.total_range, "420.000,00 - 525.000,00 EUR");
        assert_eq!(selection.line_items[0].quantity, "15");
        assert_eq!(selection.line_items[0].localized_sections.len(), 2);
    }

    #[test]
    fn intake_document_totals_round_each_line_like_the_order() {
        let line = json!({"quantity":"1", "unit_price":"0.03", "vat_rate":"19"});
        assert_eq!(
            totals(&json!({"lines":[line,line]})),
            Some(("0,06 EUR".into(), "0,02 EUR".into(), "0,08 EUR".into()))
        );
    }
}
