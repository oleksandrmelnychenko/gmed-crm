//! Completeness of an initial lead's signing packet, independently of which
//! PDFs still need a signature. Existing signatures never disappear from it.
use super::*;
use serde::Serialize;

#[derive(Serialize)]
pub(super) struct Manifest {
    pub expected_count: usize,
    pub items: Vec<Item>,
}

#[derive(Serialize)]
pub(super) struct Item {
    pub template: String,
    pub document_id: Option<Uuid>,
    pub title: Option<String>,
    pub version: Option<i32>,
    pub state: &'static str,
    pub reason: Option<&'static str>,
    pub paper_signed: bool,
    pub pending_elsewhere: bool,
}

/// The expected documents; the patient form only where
/// [`crate::lead_self_disclosure::required`] (owner decision 2026-10-23). The
/// consent slot is always the last one.
fn slots(minor: bool, self_disclosure_required: bool) -> Vec<&'static [&'static str]> {
    let mut slots = vec![
        &["framework_contract"][..],
        &["single_order"][..],
        &["order_cost_estimate"][..],
    ];
    if self_disclosure_required {
        slots.push(&[crate::lead_self_disclosure::TEMPLATE]);
    }
    if minor {
        slots.push(&["consent_data_release_child", "consent_data_release_single"]);
    } else {
        slots.extend([&["confidentiality_release"][..], &["privacy_consents"][..]]);
    }
    slots
}

pub(super) async fn manifest(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Option<Manifest>, Response> {
    if !matches!(
        template_of(source).as_deref(),
        Some("framework_contract" | "single_order" | "order_cost_estimate")
    ) || source.get::<Option<Uuid>, _>("patient_id").is_some()
    {
        return Ok(None);
    }
    let Some(lead_id) = source.get::<Option<Uuid>, _>("lead_id") else {
        return Ok(None);
    };
    // A repeat order is exempt only with a signed, currently effective
    // framework contract. Merely having a previous patient is insufficient.
    let initial: bool = sqlx::query_scalar(
        "SELECT converted_patient_id IS NULL AND NOT EXISTS(
           SELECT 1 FROM framework_contracts f WHERE f.patient_id=l.repeat_patient_id
           AND f.status='signed' AND f.signed_at IS NOT NULL
           AND (f.valid_from IS NULL OR f.valid_from <= $2)
           AND (f.valid_to IS NULL OR f.valid_to >= $2)) FROM leads l WHERE id=$1",
    )
    .bind(lead_id)
    .bind(crate::app_time::today())
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?
    .unwrap_or(false);
    if !initial {
        return Ok(None);
    }
    let minor = package::scope_is_minor(state, source).await?;
    let self_disclosure = crate::lead_self_disclosure::status(&state.db, lead_id)
        .await
        .map_err(db_error)?;
    let mut slots = slots(minor, self_disclosure.required);
    if minor {
        let mut conn = state.db.acquire().await.map_err(db_error)?;
        let loaded = crate::routes::lead_representatives::load(&mut conn, lead_id)
            .await
            .map_err(db_error)?
            .unwrap_or_default();
        let consent: &'static [&'static str] = if loaded.representation.answers.custody()
            == crate::routes::lead_representatives::CUSTODY_JOINT
        {
            &["consent_data_release_child"]
        } else {
            &["consent_data_release_single"]
        };
        if let Some(slot) = slots.last_mut() {
            *slot = consent;
        }
    }
    // Keep the current version even if it is archived, inaccessible or lacks
    // a PDF. Falling back to an older signed version would hide the problem.
    let docs = sqlx::query(
        "SELECT id,generated_template_id,order_id FROM documents d
        WHERE lead_id=$1 AND patient_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id)
        ORDER BY created_at DESC,id DESC",
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;
    let order = source.get::<Option<Uuid>, _>("order_id").or_else(|| {
        docs.iter()
            .find(|row| {
                row.get::<Option<String>, _>("generated_template_id")
                    .as_deref()
                    == Some("single_order")
            })
            .and_then(|row| row.get::<Option<Uuid>, _>("order_id"))
    });
    let mut items = Vec::new();
    for slot in slots {
        let mut item = Item {
            template: slot[0].into(),
            document_id: None,
            title: None,
            version: None,
            state: "missing",
            reason: Some("document_missing"),
            paper_signed: false,
            pending_elsewhere: false,
        };
        let candidate = docs.iter().find(|row| {
            row.get::<Option<String>, _>("generated_template_id")
                .as_deref()
                .is_some_and(|t| slot.contains(&t))
                && (!matches!(slot[0], "single_order" | "order_cost_estimate")
                    || row.get::<Option<Uuid>, _>("order_id") == order)
        });
        if let Some(candidate) = candidate {
            let id: Uuid = candidate.get("id");
            match signature_document_access(state, auth, id, false).await {
                Err(response)
                    if matches!(
                        response.status(),
                        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
                    ) =>
                {
                    item.state = "blocked";
                    item.reason = Some("document_inaccessible");
                }
                Err(response) => return Err(response),
                Ok(row) => {
                    item.document_id = Some(id);
                    item.title = Some(row.get("auto_name"));
                    item.version = Some(row.get("version_number"));
                    item.paper_signed = paper_signed(&row);
                    item.pending_elsewhere=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM document_signature_requests r
                        WHERE r.status IN ('submitting','submission_unknown','pending')
                        AND (r.source_document_id=$1 OR EXISTS(SELECT 1 FROM document_signature_members m
                            WHERE m.request_id=r.id AND m.document_id=$1)))")
                        .bind(id).fetch_one(&state.db).await.map_err(db_error)?;
                    let signed = row.get::<Option<DateTime<Utc>>, _>("signed_at").is_some();
                    // Existing consent evidence must still match the person's
                    // current recorded choices. Never manufacture those choices.
                    let changed = crate::consent_choices::changed_since_generation(
                        &state.db,
                        template_of(&row).as_deref(),
                        row.get::<Option<Value>, _>("generated_bindings").as_ref(),
                        Some(lead_id),
                        None,
                    )
                    .await
                    .map_err(db_error)?;
                    let reason = if signed {
                        eligibility_with_paper(&row, item.paper_signed)
                            .filter(|reason| {
                                !matches!(*reason, "document_already_signed" | "pdf_required")
                            })
                            .or(changed)
                            .or_else(|| {
                                // A valid paper scan may be JPG/PNG. It satisfies
                                // the legal slot but cannot be re-sent as a PDF.
                                row.get::<Option<String>, _>("storage_key")
                                    .is_none()
                                    .then_some("document_unavailable")
                            })
                    } else {
                        current_eligibility(state, &row).await?
                    };
                    item.reason = reason;
                    item.state = if reason.is_some() {
                        "blocked"
                    } else if signed {
                        "signed"
                    } else {
                        "ready"
                    };
                }
            }
        }
        items.push(item);
    }
    Ok(Some(Manifest {
        expected_count: items.len(),
        items,
    }))
}

pub(super) fn validate(manifest: Option<&Manifest>, selected: &[Uuid]) -> Result<(), Response> {
    if let Some(manifest) = manifest
        && manifest.items.iter().any(|item| {
            item.state != "signed"
                && (item.state != "ready"
                    || item.pending_elsewhere
                    || item.document_id.is_none_or(|id| !selected.contains(&id)))
        })
    {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":"onboarding_package_incomplete","onboarding_manifest":manifest})),
        )
            .into_response());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_adult_and_minor_have_six_and_five_required_documents() {
        assert_eq!(slots(false, true).len(), 6);
        assert_eq!(slots(true, true).len(), 5);
        assert_eq!(
            slots(true, true)[4],
            ["consent_data_release_child", "consent_data_release_single"]
        );
        assert!(
            !slots(false, true)
                .iter()
                .any(|slot| slot.contains(&"privacy_information"))
        );
    }
    #[test]
    fn the_patient_form_is_expected_only_in_a_new_patients_first_onboarding() {
        let first = crate::lead_self_disclosure::required(None, None);
        let repeat = crate::lead_self_disclosure::required(None, Some(Uuid::new_v4()));
        for minor in [false, true] {
            assert!(
                slots(minor, first)
                    .iter()
                    .any(|slot| slot.contains(&"lead_self_disclosure"))
            );
            assert!(
                !slots(minor, repeat)
                    .iter()
                    .any(|slot| slot.contains(&"lead_self_disclosure"))
            );
        }
        assert_eq!(slots(false, repeat).len(), 5);
        // The consents stay the last slot, where a minor's custody variant goes.
        assert_eq!(
            slots(true, repeat).last().copied(),
            Some(&["consent_data_release_child", "consent_data_release_single"][..])
        );
    }
    #[test]
    fn signed_documents_satisfy_completeness_but_missing_or_unselected_do_not() {
        let id = Uuid::new_v4();
        let mut manifest = Manifest {
            expected_count: 1,
            items: vec![Item {
                template: "privacy_consents".into(),
                document_id: Some(id),
                title: None,
                version: Some(2),
                state: "signed",
                reason: None,
                paper_signed: true,
                pending_elsewhere: false,
            }],
        };
        assert!(validate(Some(&manifest), &[]).is_ok());
        manifest.items[0].state = "ready";
        assert!(validate(Some(&manifest), &[]).is_err());
        assert!(validate(Some(&manifest), &[id]).is_ok());
        manifest.items[0].pending_elsewhere = true;
        assert!(validate(Some(&manifest), &[id]).is_err());
        manifest.items[0].state = "blocked";
        assert!(validate(Some(&manifest), &[id]).is_err());
    }
}
