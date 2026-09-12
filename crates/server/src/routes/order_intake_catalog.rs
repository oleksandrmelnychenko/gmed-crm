use super::*;

/// Keep the catalog content that belongs to this preparation beside its IDs.
/// Client-provided snapshots are always replaced with database values.
pub(super) async fn snapshot(
    conn: &mut PgConnection,
    draft: &Draft,
    complete: bool,
) -> Result<Value, Response> {
    for ids in [&draft.specialization_ids, &draft.selected_work_type_ids] {
        if ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
            return Err(invalid("Duplicate catalog selection"));
        }
    }
    let specializations: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(s) FROM medical_specializations s WHERE s.id=ANY($1) AND s.deleted_at IS NULL AND (NOT $2 OR s.is_active) ORDER BY array_position($1,s.id)",
    ).bind(&draft.specialization_ids).bind(complete).fetch_all(&mut *conn).await.map_err(db_error)?;
    if specializations.len() != draft.specialization_ids.len() {
        return Err(invalid("A selected specialization is unavailable"));
    }
    let work_types: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(w) || jsonb_build_object(
          'name_ru',COALESCE(w.name_ru,''),'name_en',COALESCE(w.name_en,''),'name_es',COALESCE(w.name_es,''),
          'specialization_ids',(SELECT jsonb_agg(a.specialization_id ORDER BY a.specialization_id) FROM medical_specialization_work_type_assignments a WHERE a.work_type_id=w.id),
          'descriptions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.sort_order,d.id) FROM medical_specialization_work_type_descriptions d WHERE d.work_type_id=w.id AND d.is_active AND d.deleted_at IS NULL),'[]'::jsonb))
         FROM medical_specialization_work_types w WHERE w.id=ANY($1) AND w.deleted_at IS NULL AND (NOT $3 OR w.is_active)
         AND EXISTS(SELECT 1 FROM medical_specialization_work_type_assignments a WHERE a.work_type_id=w.id AND a.specialization_id=ANY($2)) ORDER BY w.sort_order,w.code,w.id",
    ).bind(&draft.selected_work_type_ids).bind(&draft.specialization_ids).bind(complete).fetch_all(&mut *conn).await.map_err(db_error)?;
    if work_types.len() != draft.selected_work_type_ids.len() {
        return Err(invalid(
            "A selected work type is unavailable in these specializations",
        ));
    }
    let service_ids: Vec<Uuid> = draft
        .lines
        .iter()
        .filter_map(|line| line.agency_service_id)
        .collect();
    let services: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(s) FROM agency_service_catalog s WHERE s.id=ANY($1) ORDER BY s.id",
    )
    .bind(&service_ids)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_error)?;
    if services.len()
        != service_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
    {
        return Err(invalid("A selected service is unavailable"));
    }
    if specializations.is_empty() && work_types.is_empty() && services.is_empty() {
        return Ok(Value::Null);
    }
    Ok(json!({"specializations":specializations,"work_types":work_types,"services":services}))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}
pub(super) fn resolve_description(template: &str, data: &Value) -> String {
    let date = |key| {
        text(data, key)
            .parse::<NaiveDate>()
            .map(|date| date.format("%d.%m.%Y").to_string())
            .unwrap_or_else(|_| "noch festzulegen".into())
    };
    let names: Vec<&str> = data["catalog_snapshot"]["specializations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["name_de"].as_str())
        .collect();
    let specialties = match names.as_slice() {
        [] => "noch festzulegende Fachrichtungen".into(),
        [name] => (*name).to_string(),
        _ => format!(
            "{} und {}",
            names[..names.len() - 1].join(", "),
            names.last().unwrap()
        ),
    };
    let mut result = String::new();
    let mut remaining = template;
    let mut previous_specialty = false;
    while let Some(start) = remaining.find('[') {
        let Some(end) = remaining[start..].find(']').map(|end| start + end) else {
            break;
        };
        let prefix = &remaining[..start];
        let token = remaining[start + 1..end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let specialty = token == "fachrichtung"
            || token.strip_prefix("fachrichtung ").is_some_and(|suffix| {
                suffix.chars().all(|character| character.is_ascii_digit())
                    || matches!(suffix.replace(' ', "").as_str(), "n" | "n+1")
            });
        let replacement = match token.as_str() {
            "datum beginn" => Some(date("date_from")),
            "datum ende" => Some(date("date_to")),
            _ if specialty => Some(specialties.clone()),
            _ => None,
        };
        let separator = prefix
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        if !(specialty
            && previous_specialty
            && matches!(separator.as_str(), "" | "," | "und" | ", und"))
        {
            result.push_str(prefix);
            result.push_str(replacement.as_deref().unwrap_or(&remaining[start..=end]));
        }
        previous_specialty = specialty;
        remaining = &remaining[end + 1..];
    }
    result.push_str(remaining);
    result.trim().to_string()
}
