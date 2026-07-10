use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct GeneratedServiceGroupLines {
    pub generated_count: u64,
    pub updated_count: u64,
    pub skipped_duplicate_count: u64,
    pub leistung_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ServiceGroupLinePreview {
    pub participant_id: Uuid,
    pub provider_id: Uuid,
    pub provider_name: String,
    pub doctor_id: Uuid,
    pub doctor_name: String,
    pub description: String,
    pub quantity: String,
    pub unit_price: String,
    pub currency: String,
    pub vat_rate: String,
    pub existing_leistung_id: Option<Uuid>,
    pub action: String,
}

#[derive(Debug, Serialize)]
pub struct ServiceGroupLinePreviewSummary {
    pub generate_count: u64,
    pub update_count: u64,
    pub skip_duplicate_count: u64,
    pub override_duplicates: bool,
    pub lines: Vec<ServiceGroupLinePreview>,
}

struct ServiceGroupDefaults {
    order_id: Uuid,
    group_title: String,
    agency_service_id: Option<Uuid>,
    quantity: Decimal,
    unit_price: Decimal,
    currency: String,
    vat_rate: Decimal,
    tax_profile_id: Option<Uuid>,
    vat_source: String,
}

struct ServiceGroupParticipant {
    id: Uuid,
    provider_id: Uuid,
    provider_name: String,
    doctor_id: Uuid,
    doctor_name: String,
    quantity_override: Option<Decimal>,
    unit_price_override: Option<Decimal>,
    description_override: Option<String>,
}

pub async fn generate_order_service_group_lines(
    pool: &gmed_db::DbPool,
    group_id: Uuid,
    override_duplicates: bool,
) -> Result<GeneratedServiceGroupLines, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let group = sqlx::query(
        r#"SELECT id, order_id, group_title, agency_service_id, quantity, unit_price,
                  currency, vat_rate, tax_profile_id, vat_source
           FROM order_service_groups
           WHERE id = $1
             AND status <> 'cancelled'
           FOR UPDATE"#,
    )
    .bind(group_id)
    .fetch_one(&mut *tx)
    .await
    .map(|row| ServiceGroupDefaults {
        order_id: row.try_get("order_id").unwrap_or_default(),
        group_title: row.try_get("group_title").unwrap_or_default(),
        agency_service_id: row.try_get("agency_service_id").unwrap_or_default(),
        quantity: row.try_get("quantity").unwrap_or(Decimal::ONE),
        unit_price: row.try_get("unit_price").unwrap_or(Decimal::ZERO),
        currency: row
            .try_get("currency")
            .unwrap_or_else(|_| "EUR".to_string()),
        vat_rate: row.try_get("vat_rate").unwrap_or(Decimal::ZERO),
        tax_profile_id: row.try_get("tax_profile_id").unwrap_or_default(),
        vat_source: row
            .try_get("vat_source")
            .unwrap_or_else(|_| "manual".to_string()),
    })?;

    let participants = sqlx::query(
        r#"SELECT participant.id,
                  participant.provider_id,
                  provider.name AS provider_name,
                  participant.doctor_id,
                  doctor.name AS doctor_name,
                  participant.quantity_override,
                  participant.unit_price_override,
                  participant.description_override
           FROM order_service_group_participants participant
           JOIN providers provider ON provider.id = participant.provider_id
           JOIN provider_doctors doctor ON doctor.id = participant.doctor_id
           WHERE participant.service_group_id = $1
             AND participant.is_active = true
           ORDER BY doctor.name"#,
    )
    .bind(group_id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|row| ServiceGroupParticipant {
        id: row.try_get("id").unwrap_or_default(),
        provider_id: row.try_get("provider_id").unwrap_or_default(),
        provider_name: row.try_get("provider_name").unwrap_or_default(),
        doctor_id: row.try_get("doctor_id").unwrap_or_default(),
        doctor_name: row.try_get("doctor_name").unwrap_or_default(),
        quantity_override: row.try_get("quantity_override").unwrap_or_default(),
        unit_price_override: row.try_get("unit_price_override").unwrap_or_default(),
        description_override: row.try_get("description_override").unwrap_or_default(),
    })
    .collect::<Vec<_>>();

    let mut summary = GeneratedServiceGroupLines {
        generated_count: 0,
        updated_count: 0,
        skipped_duplicate_count: 0,
        leistung_ids: Vec::new(),
    };

    for participant in participants {
        let existing_id = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id
               FROM order_leistungen
               WHERE source_service_group_participant_id = $1"#,
        )
        .bind(participant.id)
        .fetch_optional(&mut *tx)
        .await?;

        let description = participant
            .description_override
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "{} - {} ({})",
                    group.group_title, participant.doctor_name, participant.provider_name
                )
            });
        let quantity = participant.quantity_override.unwrap_or(group.quantity);
        let unit_price = participant.unit_price_override.unwrap_or(group.unit_price);

        if let Some(existing_id) = existing_id {
            sqlx::query(
                r#"UPDATE order_service_group_participants
                   SET generated_leistung_id = $2
                   WHERE id = $1
                     AND generated_leistung_id IS DISTINCT FROM $2"#,
            )
            .bind(participant.id)
            .bind(existing_id)
            .execute(&mut *tx)
            .await?;

            if !override_duplicates {
                summary.skipped_duplicate_count += 1;
                summary.leistung_ids.push(existing_id);
                continue;
            }

            sqlx::query(
                r#"UPDATE order_leistungen
                   SET description = $2,
                       quantity = $3,
                       unit_price = $4,
                       currency = $5,
                       vat_rate = $6,
                       provider_id = $7,
                       doctor_id = $8,
                       agency_service_id = $9,
                       tax_profile_id = $10,
                       vat_source = $11,
                       source_service_group_id = $12,
                       notes = $13
                   WHERE id = $1"#,
            )
            .bind(existing_id)
            .bind(description)
            .bind(quantity)
            .bind(unit_price)
            .bind(&group.currency)
            .bind(group.vat_rate)
            .bind(participant.provider_id)
            .bind(participant.doctor_id)
            .bind(group.agency_service_id)
            .bind(group.tax_profile_id)
            .bind(&group.vat_source)
            .bind(group_id)
            .bind("Generated from multi-doctor service group")
            .execute(&mut *tx)
            .await?;
            summary.updated_count += 1;
            summary.leistung_ids.push(existing_id);
            continue;
        }

        let leistung_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO order_leistungen (
                    order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
                    is_cost_passthrough, provider_id, doctor_id, agency_service_id,
                    tax_profile_id, vat_source, source_service_group_id,
                    source_service_group_participant_id, notes
               ) VALUES (
                    $1, (SELECT patient_id FROM orders WHERE id = $1), $2, $3, $4, $5, $6,
                    false, $7, $8, $9,
                    $10, $11, $12,
                    $13, $14
               )
               RETURNING id"#,
        )
        .bind(group.order_id)
        .bind(description)
        .bind(quantity)
        .bind(unit_price)
        .bind(&group.currency)
        .bind(group.vat_rate)
        .bind(participant.provider_id)
        .bind(participant.doctor_id)
        .bind(group.agency_service_id)
        .bind(group.tax_profile_id)
        .bind(&group.vat_source)
        .bind(group_id)
        .bind(participant.id)
        .bind("Generated from multi-doctor service group")
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            r#"UPDATE order_service_group_participants
               SET generated_leistung_id = $2
               WHERE id = $1"#,
        )
        .bind(participant.id)
        .bind(leistung_id)
        .execute(&mut *tx)
        .await?;

        summary.generated_count += 1;
        summary.leistung_ids.push(leistung_id);
    }

    if summary.generated_count > 0 || summary.updated_count > 0 {
        sqlx::query(
            r#"UPDATE order_service_groups
               SET status = 'generated',
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(group_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(summary)
}

pub async fn preview_order_service_group_lines(
    pool: &gmed_db::DbPool,
    group_id: Uuid,
    override_duplicates: bool,
) -> Result<ServiceGroupLinePreviewSummary, sqlx::Error> {
    let group = sqlx::query(
        r#"SELECT id, order_id, group_title, agency_service_id, quantity, unit_price,
                  currency, vat_rate, tax_profile_id, vat_source
           FROM order_service_groups
           WHERE id = $1
             AND status <> 'cancelled'"#,
    )
    .bind(group_id)
    .fetch_one(pool)
    .await
    .map(|row| ServiceGroupDefaults {
        order_id: row.try_get("order_id").unwrap_or_default(),
        group_title: row.try_get("group_title").unwrap_or_default(),
        agency_service_id: row.try_get("agency_service_id").unwrap_or_default(),
        quantity: row.try_get("quantity").unwrap_or(Decimal::ONE),
        unit_price: row.try_get("unit_price").unwrap_or(Decimal::ZERO),
        currency: row
            .try_get("currency")
            .unwrap_or_else(|_| "EUR".to_string()),
        vat_rate: row.try_get("vat_rate").unwrap_or(Decimal::ZERO),
        tax_profile_id: row.try_get("tax_profile_id").unwrap_or_default(),
        vat_source: row
            .try_get("vat_source")
            .unwrap_or_else(|_| "manual".to_string()),
    })?;

    let rows = sqlx::query(
        r#"SELECT participant.id,
                  participant.provider_id,
                  provider.name AS provider_name,
                  participant.doctor_id,
                  doctor.name AS doctor_name,
                  participant.quantity_override,
                  participant.unit_price_override,
                  participant.description_override,
                  leistung.id AS existing_leistung_id
           FROM order_service_group_participants participant
           JOIN providers provider ON provider.id = participant.provider_id
           JOIN provider_doctors doctor ON doctor.id = participant.doctor_id
           LEFT JOIN order_leistungen leistung
                  ON leistung.source_service_group_participant_id = participant.id
           WHERE participant.service_group_id = $1
             AND participant.is_active = true
           ORDER BY doctor.name"#,
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?;

    let mut summary = ServiceGroupLinePreviewSummary {
        generate_count: 0,
        update_count: 0,
        skip_duplicate_count: 0,
        override_duplicates,
        lines: Vec::with_capacity(rows.len()),
    };

    for row in rows {
        let participant = ServiceGroupParticipant {
            id: row.try_get("id").unwrap_or_default(),
            provider_id: row.try_get("provider_id").unwrap_or_default(),
            provider_name: row.try_get("provider_name").unwrap_or_default(),
            doctor_id: row.try_get("doctor_id").unwrap_or_default(),
            doctor_name: row.try_get("doctor_name").unwrap_or_default(),
            quantity_override: row.try_get("quantity_override").unwrap_or_default(),
            unit_price_override: row.try_get("unit_price_override").unwrap_or_default(),
            description_override: row.try_get("description_override").unwrap_or_default(),
        };
        let existing_leistung_id = row
            .try_get::<Option<Uuid>, _>("existing_leistung_id")
            .unwrap_or_default();
        let action = generation_action(existing_leistung_id, override_duplicates);
        match action {
            "generate" => summary.generate_count += 1,
            "update" => summary.update_count += 1,
            "skip_duplicate" => summary.skip_duplicate_count += 1,
            _ => {}
        }
        let quantity = participant.quantity_override.unwrap_or(group.quantity);
        let unit_price = participant.unit_price_override.unwrap_or(group.unit_price);
        summary.lines.push(ServiceGroupLinePreview {
            participant_id: participant.id,
            provider_id: participant.provider_id,
            provider_name: participant.provider_name.clone(),
            doctor_id: participant.doctor_id,
            doctor_name: participant.doctor_name.clone(),
            description: participant_description(&group, &participant),
            quantity: decimal_json(quantity),
            unit_price: decimal_json(unit_price),
            currency: group.currency.clone(),
            vat_rate: decimal_json(group.vat_rate),
            existing_leistung_id,
            action: action.to_string(),
        });
    }

    Ok(summary)
}

fn generation_action(
    existing_leistung_id: Option<Uuid>,
    override_duplicates: bool,
) -> &'static str {
    match (existing_leistung_id, override_duplicates) {
        (Some(_), true) => "update",
        (Some(_), false) => "skip_duplicate",
        (None, _) => "generate",
    }
}

fn participant_description(
    group: &ServiceGroupDefaults,
    participant: &ServiceGroupParticipant,
) -> String {
    participant
        .description_override
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "{} - {} ({})",
                group.group_title, participant.doctor_name, participant.provider_name
            )
        })
}

fn decimal_json(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_action_skips_existing_lines_by_default() {
        let existing_id = Uuid::new_v4();

        assert_eq!(
            generation_action(Some(existing_id), false),
            "skip_duplicate"
        );
        assert_eq!(generation_action(Some(existing_id), true), "update");
        assert_eq!(generation_action(None, false), "generate");
    }

    #[test]
    fn participant_description_uses_override_when_present() {
        let group = ServiceGroupDefaults {
            order_id: Uuid::new_v4(),
            group_title: "Tumor board".to_string(),
            agency_service_id: None,
            quantity: Decimal::ONE,
            unit_price: Decimal::new(120, 0),
            currency: "EUR".to_string(),
            vat_rate: Decimal::new(19, 0),
            tax_profile_id: None,
            vat_source: "manual".to_string(),
        };
        let participant = ServiceGroupParticipant {
            id: Uuid::new_v4(),
            provider_id: Uuid::new_v4(),
            provider_name: "Clinic Mitte".to_string(),
            doctor_id: Uuid::new_v4(),
            doctor_name: "Dr. Two".to_string(),
            quantity_override: None,
            unit_price_override: None,
            description_override: Some("Custom split line".to_string()),
        };

        assert_eq!(
            participant_description(&group, &participant),
            "Custom split line"
        );
    }
}
