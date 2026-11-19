use super::*;

fn line_net(line: &Value) -> Decimal {
    let number = |key| {
        text(line, key)
            .replace(',', ".")
            .parse::<Decimal>()
            .unwrap_or_default()
    };
    let (quantity, price) = (number("quantity"), number("unit_price"));
    // The line's discount (owner 2026-11-18) lowers its net like the order.
    money::line_list_net(quantity, price)
        - money::line_discount_amount(quantity, price, money::json_discount_percent(line))
}

/// The VAT rate a document counts for a line. A pass-through cost carries no
/// VAT whatever rate its line holds, so the document total is the order's
/// (`order_service_total_gross`, QA 2026-10-31). Only the repeat-order context
/// flags such lines.
fn line_vat_rate(line: &Value) -> &str {
    if crate::money::json_line_pass_through(line) {
        "0"
    } else {
        text(line, "vat_rate")
    }
}

pub(super) fn totals(data: &Value) -> Option<(String, String, String)> {
    let lines = data["lines"].as_array().filter(|lines| !lines.is_empty())?;
    let mut net = Decimal::ZERO;
    let mut vat = Decimal::ZERO;
    for line in lines {
        let amount = line_net(line);
        let rate = line_vat_rate(line)
            .replace(',', ".")
            .parse::<Decimal>()
            .unwrap_or_default();
        net += amount;
        vat += money::vat_amount(amount, rate);
    }
    let format = format_eur_decimal;
    Some((format(net), format(vat), format(net + vat)))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

/// The price column of a German document line, "550,00 € / Stück": the
/// catalogue stores technical or UI-language units ("item", "hour"), the
/// document prints German ones (QA 2026-10-11).
fn unit_fee(line: &Value, unit: &str) -> String {
    let price = line["unit_price"]
        .as_str()
        .and_then(|value| value.trim().replace(',', ".").parse::<Decimal>().ok())
        .or_else(|| line["unit_price"].as_f64().and_then(Decimal::from_f64))
        .unwrap_or_default();
    let currency = match text(line, "currency").trim() {
        "" => "EUR",
        currency => currency,
    };
    crate::order_document_texts::discounted_unit_price_label_de(
        price,
        currency,
        unit,
        money::json_discount_percent(line),
    )
}

fn decimal(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(parse_eur_amount))
        .unwrap_or_default()
}

/// Agency services feed the order and its Kostenvoranschlag only (with the
/// payer's copy of it, phase 3b). The VKS (`cost_estimate`) lists the
/// selected medical work types, see `estimate_selection`.
pub(super) fn apply(bindings: &mut DocumentBindingOverrides, data: &Value, template: &str) {
    if !matches!(
        template,
        "single_order" | "order_cost_estimate" | "payer_cost_estimate"
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
                tax_profile_id: line["tax_profile_id"]
                    .as_str()
                    .and_then(|id| uuid::Uuid::parse_str(id).ok()),
                unit_price: None,
                unit: None,
                discount_percent: None,
                description: text(line, "description").to_string(),
                description_items: (!description_items.is_empty()).then_some(description_items),
                fee: Some(unit_fee(line, unit)),
                quantity: Some(match crate::order_document_texts::german_unit_label(unit) {
                    german if german.is_empty() => text(line, "quantity").to_string(),
                    german => format!("{} {german}", text(line, "quantity")),
                }),
                line_total: Some(format_eur_decimal(line_net(line))),
                vat_rate: Some(text(line, "vat_rate").to_string()),
                // Intake lines carry no pass-through flag; the estimated
                // outlays line is recognised by its description.
                is_cost_passthrough: None,
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
    let work_type_ids = work_types
        .iter()
        .filter_map(|item| item["id"].as_str()?.parse::<Uuid>().ok())
        .collect();
    let line_items = work_types
        .iter()
        .map(|item| {
            let min = decimal(&item["min_price_eur"]);
            let max = decimal(&item["max_price_eur"]);
            // A catalog price is the price of the whole service, as in the main lead
            // wizard; its duration is informational and never multiplies the price.
            let duration = item["duration_hours"].as_i64().unwrap_or(1);
            minimum += min;
            maximum += max;
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
                line_gross: format_eur_range(min, max),
                vat_rate: None,
                is_cost_passthrough: false,
                notes: None,
                tax_profile_id: None,
                vat_category: None,
                exemption_reason: None,
            }
        })
        .collect();
    Some(GeneratedCostEstimateCatalogSelection {
        work_type_ids,
        line_items,
        total_range: format_eur_range(minimum, maximum),
    })
}

/// Repeat-order PDFs are rendered from persisted facts, including service snapshots.
pub(super) fn repeat_bindings(context: &Value, template: &str) -> DocumentBindingOverrides {
    let parse_date = |key| text(context, key).parse::<NaiveDate>().ok();
    let specialty_names = context["specialty_names"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .map(|name| json!({ "name_de": name }))
        .collect::<Vec<_>>();
    let resolver_data = json!({
        "date_from": context["date_from"],
        "date_to": context["date_to"],
        "catalog_snapshot": { "specializations": specialty_names },
    });
    let mut bindings = DocumentBindingOverrides {
        period_from: parse_date("date_from"),
        period_to: parse_date("date_to"),
        contract_date: parse_date("contract_effective_date"),
        cost_threshold: context["cost_threshold"].as_str().map(str::to_owned),
        examination_purpose: context["needs_description"].as_str().map(str::to_owned),
        ..Default::default()
    };
    bindings.specialties = resolver_data["catalog_snapshot"]["specializations"]
        .as_array()
        .filter(|items| !items.is_empty())
        .map(|_| {
            super::super::order_intakes::catalog_description("[Fachrichtung]", &resolver_data)
        });
    let mut services = context["services"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|line| {
            matches!(template, "order_cost_estimate" | "payer_cost_estimate")
                || text(line, "description") != "Voraussichtliche Auslagen"
        })
        .collect::<Vec<_>>();
    services.sort_by_key(|line| text(line, "description") == "Voraussichtliche Auslagen");
    bindings.estimate_total = totals(&json!({"lines": &services})).map(|value| value.2);
    bindings.service_lines = services
        .into_iter()
        .map(|line| {
            let unit = text(line, "unit_label");
            let description_items: Vec<crate::service_description::ServiceDescriptionItem> =
                serde_json::from_value::<Vec<crate::service_description::ServiceDescriptionItem>>(
                    line["description_items"].clone(),
                )
                .unwrap_or_default()
                .into_iter()
                .map(|item| crate::service_description::ServiceDescriptionItem {
                    id: item.id,
                    text: super::super::order_intakes::catalog_description(
                        &item.text,
                        &resolver_data,
                    ),
                })
                .collect();
            let note = if description_items.is_empty() {
                line["note"]
                    .as_str()
                    .map(|note| {
                        super::super::order_intakes::catalog_description(note, &resolver_data)
                    })
                    .filter(|note| !note.is_empty())
            } else {
                crate::service_description::items_text(&description_items)
            };
            ServiceLineInput {
                tax_profile_id: line["tax_profile_id"]
                    .as_str()
                    .and_then(|id| uuid::Uuid::parse_str(id).ok()),
                unit_price: None,
                unit: None,
                discount_percent: None,
                description: text(line, "description").to_owned(),
                description_items: (!description_items.is_empty()).then_some(description_items),
                note,
                quantity: Some(text(line, "quantity").to_owned()),
                fee: Some(unit_fee(line, unit)),
                line_total: Some(format_eur_decimal(line_net(line))),
                vat_rate: Some(line_vat_rate(line).to_owned()),
                // The context flags pass-through costs; the estimated outlays
                // line is also recognised by its description.
                is_cost_passthrough: line["is_cost_passthrough"]
                    .as_bool()
                    .map(|flag| flag || crate::money::json_line_pass_through(line)),
            }
        })
        .collect();
    bindings
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_discounted_line_prints_its_tariff_and_the_discounted_amount() {
        // 2 × 180,00 at 10 %: «180,00 € / Einheit, Rabatt 10 % = 162,00 € /
        // Einheit», 324,00 € net, 385,56 € gross (owner 2026-11-18).
        let data = json!({
            "lines":[{"agency_service_id":"service","description":"Beratungsleistungen","quantity":"2",
                "unit_price":"180","vat_rate":"19","discount_percent":"10"}],
            "catalog_snapshot":{"services":[{"id":"service","unit_label":"unit"}]}});
        let mut bindings = DocumentBindingOverrides::default();
        apply(&mut bindings, &data, "single_order");
        assert_eq!(
            bindings.service_lines[0].fee.as_deref(),
            Some("180,00 € / Einheit, Rabatt 10 % = 162,00 € / Einheit")
        );
        assert_eq!(
            bindings.service_lines[0].line_total.as_deref(),
            Some("324,00 €")
        );
        assert_eq!(bindings.estimate_total.as_deref(), Some("385,56 €"));
        // A quote line with a discount: the same price text, the discounted net.
        let quote = super::super::parse_quote_line_items(&json!([{
            "description": "Beratungsleistungen", "quantity": "2", "unit_price": "180",
            "vat_rate": "19", "discount_percent": "10", "discount_amount": "36",
            "line_net": "324", "line_vat": "61.56", "line_gross": "385.56"
        }]));
        assert_eq!(quote[0].unit_price, "180,00 €, Rabatt 10 % = 162,00 €");
        assert_eq!(quote[0].line_gross, "324");
    }

    #[test]
    fn intake_documents_resolve_catalog_context_and_match_main_estimate() {
        let data = json!({"date_from":"2026-09-14","date_to":"2026-09-19","cost_estimate_additional_language":"ru",
            "lines":[{"agency_service_id":"service","description":"Coordination","quantity":"19","unit_price":"60","vat_rate":"19"}],
            "catalog_snapshot":{"specializations":[{"name_de":"Urologie"}],
            "services":[{"id":"service","unit_label":"Std.","description_items":[{"id":"scope","text":"[Datum Beginn] bis [Datum Ende]: [Fachrichtung 1], [Fachrichtung 2]"}]}],
            "work_types":[{"id":"6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f","name_de":"Operation","name_ru":"Операция","duration_hours":15,"min_price_eur":28000,"max_price_eur":35000,"descriptions":[]}]}});
        let mut bindings = DocumentBindingOverrides::default();
        apply(&mut bindings, &data, "single_order");
        assert_eq!(
            bindings.service_lines[0].note.as_deref(),
            Some("14.09.2026 bis 19.09.2026: Urologie")
        );
        assert_eq!(
            bindings.service_lines[0].line_total.as_deref(),
            Some("1.140,00 €")
        );
        // German price per unit, never the raw catalogue unit (QA 2026-10-11).
        assert_eq!(
            bindings.service_lines[0].fee.as_deref(),
            Some("60,00 € / Std.")
        );
        assert_eq!(
            bindings.service_lines[0].quantity.as_deref(),
            Some("19 Std.")
        );
        assert_eq!(bindings.specialties.as_deref(), Some("Urologie"));
        assert_eq!(bindings.estimate_total.as_deref(), Some("1.356,60 €"));
        let selection = estimate_selection(&json!({"data":data})).unwrap();
        assert_eq!(
            selection.line_items[0].unit_price,
            "28.000,00 - 35.000,00 €"
        );
        assert_eq!(
            selection.line_items[0].line_gross,
            "28.000,00 - 35.000,00 €"
        );
        assert_eq!(selection.total_range, "28.000,00 - 35.000,00 €");
        assert_eq!(selection.line_items[0].quantity, "15");
        assert_eq!(selection.line_items[0].localized_sections.len(), 2);
        assert_eq!(
            selection.work_type_ids,
            vec![Uuid::parse_str("6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f").unwrap()]
        );
    }

    #[test]
    fn intake_cost_estimate_never_receives_the_agency_services() {
        let data = json!({"lines":[{"agency_service_id":"service","description":"Interpreter support",
            "quantity":"1","unit_price":"285","vat_rate":"19"}],
            "catalog_snapshot":{"specializations":[{"name_de":"Gastroenterologie"}],
            "services":[{"id":"service","unit_label":"Std."}]}});
        let mut bindings = DocumentBindingOverrides::default();
        apply(&mut bindings, &data, "cost_estimate");
        assert!(bindings.service_lines.is_empty());
        assert_eq!(bindings.estimate_total, None);
        // No medical work types chosen: the intake has no estimate to render.
        assert!(estimate_selection(&json!({ "data": data })).is_none());

        apply(&mut bindings, &data, "order_cost_estimate");
        assert_eq!(bindings.service_lines[0].description, "Interpreter support");
    }

    #[test]
    fn intake_document_totals_round_each_line_like_the_order() {
        let line = json!({"quantity":"1", "unit_price":"0.03", "vat_rate":"19"});
        assert_eq!(
            totals(&json!({"lines":[line,line]})),
            Some(("0,06 €".into(), "0,02 €".into(), "0,08 €".into()))
        );
    }

    #[test]
    fn repeat_quote_keeps_estimated_outlays_last_and_other_documents_exclude_them() {
        let context = json!({
            "services": [
                {"description":"Voraussichtliche Auslagen","quantity":"1","unit_price":"50","vat_rate":"0"},
                {"description":"Coordination","quantity":"1","unit_price":"100","vat_rate":"19"}
            ]
        });

        let quote = repeat_bindings(&context, "order_cost_estimate");
        assert_eq!(quote.service_lines.len(), 2);
        assert_eq!(quote.service_lines[0].description, "Coordination");
        assert_eq!(
            quote.service_lines[1].description,
            "Voraussichtliche Auslagen"
        );
        assert_eq!(quote.estimate_total.as_deref(), Some("169,00 €"));

        let order = repeat_bindings(&context, "single_order");
        assert_eq!(order.service_lines.len(), 1);
        assert_eq!(order.service_lines[0].description, "Coordination");
        assert_eq!(order.estimate_total.as_deref(), Some("119,00 €"));
    }

    #[test]
    fn repeat_documents_total_pass_through_costs_without_vat_like_the_order() {
        let context = json!({
            "services": [
                {"description":"Klinikrechnung","quantity":"1","unit_price":"200","vat_rate":"19","is_cost_passthrough":true},
                {"description":"Coordination","quantity":"1","unit_price":"100","vat_rate":"19"}
            ]
        });

        let quote = repeat_bindings(&context, "order_cost_estimate");
        assert_eq!(quote.estimate_total.as_deref(), Some("319,00 €"));
        assert_eq!(quote.service_lines[0].vat_rate.as_deref(), Some("0"));
        assert_eq!(quote.service_lines[0].is_cost_passthrough, Some(true));
        assert_eq!(quote.service_lines[1].vat_rate.as_deref(), Some("19"));
        assert_eq!(quote.service_lines[1].is_cost_passthrough, None);
        assert_eq!(
            totals(&json!({"lines": context["services"]})),
            Some(("300,00 €".into(), "19,00 €".into(), "319,00 €".into()))
        );
    }

    #[test]
    fn repeat_documents_resolve_specialty_and_period_placeholders() {
        let context = json!({
            "date_from": "2026-09-07",
            "date_to": "2026-09-10",
            "specialty_names": ["Plastische und Ästhetische Chirurgie", "Urologie"],
            "services": [{
                "description": "Organisation der Behandlung",
                "description_items": [{
                    "id": "scope",
                    "text": "[Datum Beginn] bis [Datum Ende]: [Fachrichtung 1], [Fachrichtung 2], [Fachrichtung n] und [Fachrichtung n+1]"
                }],
                "quantity": "1",
                "unit_price": "450",
                "vat_rate": "19"
            }]
        });

        let bindings = repeat_bindings(&context, "single_order");
        assert_eq!(
            bindings.specialties.as_deref(),
            Some("Plastische und Ästhetische Chirurgie und Urologie")
        );
        assert_eq!(
            bindings.service_lines[0].note.as_deref(),
            Some("07.09.2026 bis 10.09.2026: Plastische und Ästhetische Chirurgie und Urologie")
        );
        assert!(
            !bindings.service_lines[0]
                .note
                .as_deref()
                .unwrap_or_default()
                .contains('[')
        );
    }
}
