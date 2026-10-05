//! Legal rules for electronic signatures in Germany, as engineering rules
//! (not legal advice; see docs/architecture/document-signatures-germany_ua.md,
//! «Правові вимоги»):
//!
//! * eIDAS Art. 25 Abs. 2 / § 126a BGB: only a QES replaces the written form.
//!   QES is the default and the minimum for contracts, orders and declarations
//!   of cost coverage. AES is allowed for consents and cost estimates (owner
//!   decision 2026-10-01). A package takes the highest minimum of its members.
//! * Some declarations cannot be made in electronic form at all
//!   (§ 766 S. 2 BGB Bürgschaft, § 623 BGB Kündigung/Auflösungsvertrag eines
//!   Arbeitsverhältnisses, § 630 S. 3 BGB Arbeitszeugnis). Such documents are
//!   never sent for an electronic signature.
//! * Invitation texts are generic: document types and page ranges, never
//!   patient, health or document content (Art. 9 DSGVO, § 203 StGB).
use super::provider::Level;

/// Templates and document types that may be signed with an AES (owner
/// decision 2026-10-05): consents and cost estimates, where no written form
/// is required, and the internal GwG records that only a GMED staff member
/// signs. Contracts, orders, the payer's documents and everything that
/// identifies a person need a QES; a simple signature (SES) is never offered.
const AES_ALLOWED: [&str; 11] = [
    "confidentiality_release",
    "privacy_consents",
    "privacy_consent",
    "consent_data_release_child",
    "consent_data_release_single",
    "consent_data_release",
    "consent",
    "order_cost_estimate",
    "cost_estimate",
    "enhanced_due_diligence",
    "gwg_identification",
];

/// Templates whose informational companion is mandatory (Art. 13/14 DSGVO
/// information, the medical cost calculation). They are attached read-only.
pub(super) fn companion(template: Option<&str>) -> Option<&'static str> {
    match template {
        Some("framework_contract") => Some("privacy_information"),
        Some("confidentiality_release") => Some("privacy_information"),
        Some("order_cost_estimate") => Some("cost_estimate"),
        _ => None,
    }
}

/// Informational documents are attached for acknowledgement, never signed.
pub(super) fn informational(template: Option<&str>) -> bool {
    template.is_some_and(informational_template)
}

pub(super) fn informational_template(template: &str) -> bool {
    matches!(template, "privacy_information" | "cost_estimate")
}

fn document_kind<'a>(template: Option<&'a str>, art: &'a str) -> &'a str {
    template
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| art.trim())
}

/// The lowest signature level a document type accepts.
pub(super) fn minimum_level(template: Option<&str>, art: &str) -> Level {
    if AES_ALLOWED.contains(&document_kind(template, art)) {
        Level::Aes
    } else {
        Level::Qes
    }
}

/// The level a package needs: the highest minimum of its documents.
#[cfg(test)]
pub(super) fn package_minimum_level<'a>(
    documents: impl IntoIterator<Item = (Option<&'a str>, &'a str)>,
) -> Level {
    documents
        .into_iter()
        .map(|(template, art)| minimum_level(template, art))
        .max()
        .unwrap_or_default()
}

/// The statute that excludes the electronic form for this document type, if
/// any. Matching is by template id or document type; the list is reviewed by
/// legal counsel (see the docs).
pub(super) fn electronic_form_excluded(template: Option<&str>, art: &str) -> Option<&'static str> {
    let kind = document_kind(template, art).to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| kind.contains(needle));
    if has(&[
        "buergschaft",
        "bürgschaft",
        "burgschaft",
        "surety",
        "guarantee_bond",
    ]) {
        Some("§ 766 S. 2 BGB")
    } else if has(&[
        "employment_termination",
        "arbeitsvertrag_kuendigung",
        "arbeitsverhaeltnis_kuendigung",
        "aufhebungsvertrag",
        "auflösungsvertrag",
        "aufloesungsvertrag",
    ]) {
        Some("§ 623 BGB")
    } else if has(&["arbeitszeugnis", "employment_reference"]) {
        Some("§ 630 S. 3 BGB")
    } else {
        None
    }
}

/// Generic, data-minimised label of a document type for invitation texts.
/// Medical documents are named only as such.
pub(super) fn invitation_label(
    template: Option<&str>,
    art: &str,
    is_medical: bool,
) -> &'static str {
    if is_medical {
        return "Medizinische Unterlage";
    }
    match document_kind(template, art) {
        "framework_contract" => "Rahmenvertrag",
        "single_order" => "Einzelauftrag",
        "order_cost_estimate" => "Kostenvoranschlag",
        "cost_coverage_declaration" => "Kostenübernahmeerklärung",
        "confidentiality_release" => "Schweigepflichtsentbindung",
        "privacy_consents" | "privacy_consent" | "consent" => "Einwilligungserklärung",
        "consent_data_release_child" | "consent_data_release_single" | "consent_data_release" => {
            "Einverständniserklärung der Sorgeberechtigten"
        }
        "privacy_information" => "Datenschutzinformation",
        "cost_estimate" => "Vorläufige medizinische Kostenkalkulation",
        "enhanced_due_diligence" => "Sorgfaltspflichten-Dokumentation",
        "gwg_identification" => "Dokumentationsbogen nach dem Geldwäschegesetz",
        "appointment_confirmation" => "Terminbestätigung",
        _ => "Dokument",
    }
}

/// Generic invitation subject. The full request ID lets an ambiguous creation
/// be found again by the provider search; it carries no personal data.
pub(super) fn invitation_title(request_id: uuid::Uuid) -> String {
    format!("Dokumente zur Unterschrift – GMED · {request_id}")
}

pub(super) struct IndexEntry {
    pub label: &'static str,
    pub page_start: usize,
    pub page_count: usize,
}

/// The invitation message lists every document of the package in order with
/// its pages, and every read-only attachment, so each signer sees the complete
/// set before signing (transparency, §§ 305 ff. BGB). A staff note follows.
pub(super) fn invitation_message(
    entries: &[IndexEntry],
    attachments: &[&'static str],
    note: Option<&str>,
    language: &str,
) -> String {
    let english = language == "en";
    let mut lines = vec![
        if english {
            "Documents for your signature (GMED):"
        } else {
            "Dokumente zur Unterschrift (GMED):"
        }
        .to_string(),
    ];
    for (index, entry) in entries.iter().enumerate() {
        let last = entry.page_start + entry.page_count.saturating_sub(1);
        let pages = if entry.page_count <= 1 {
            if english {
                format!("page {}", entry.page_start)
            } else {
                format!("Seite {}", entry.page_start)
            }
        } else if english {
            format!("pages {}–{last}", entry.page_start)
        } else {
            format!("Seiten {}–{last}", entry.page_start)
        };
        lines.push(format!("{}. {} ({pages})", index + 1, entry.label));
    }
    if !attachments.is_empty() {
        lines.push(String::new());
        lines.push(
            if english {
                "Attached for your information (not signed):"
            } else {
                "Zur Kenntnisnahme beigefügt (ohne Unterschrift):"
            }
            .to_string(),
        );
        for label in attachments {
            lines.push(format!("– {label}"));
        }
    }
    if let Some(note) = note.map(str::trim).filter(|note| !note.is_empty()) {
        lines.push(String::new());
        lines.push(note.to_string());
    }
    lines.join("\n")
}

/// A short staff note for the invitation: at most 500 characters, no control
/// characters except line breaks.
pub(super) fn normalize_note(note: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(note) = note.map(str::trim).filter(|note| !note.is_empty()) else {
        return Ok(None);
    };
    if note.chars().count() > 500
        || note
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r')
    {
        return Err("signature_message_invalid");
    }
    Ok(Some(note.to_string()))
}

/// The invitation language: an explicit choice, else the first supported
/// language of the patient or lead, else German.
pub(super) fn suggested_language(languages: &[String]) -> &'static str {
    for language in languages {
        let value = language.trim().to_lowercase();
        if value.starts_with("de") || value.contains("deutsch") || value.contains("german") {
            return "de";
        }
        if value.starts_with("en") || value.contains("english") || value.contains("англ") {
            return "en";
        }
        if value.starts_with("fr") || value.contains("fran") {
            return "fr";
        }
        if value.starts_with("it") || value.contains("ital") {
            return "it";
        }
    }
    "de"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_takes_the_highest_minimum_level() {
        assert_eq!(
            minimum_level(Some("privacy_consents"), "consent"),
            Level::Aes
        );
        assert_eq!(minimum_level(Some("order_cost_estimate"), "x"), Level::Aes);
        assert_eq!(minimum_level(Some("framework_contract"), "x"), Level::Qes);
        assert_eq!(
            minimum_level(Some("cost_coverage_declaration"), "x"),
            Level::Qes
        );
        assert_eq!(minimum_level(None, "other"), Level::Qes);
        // Internal GwG records are signed by a GMED staff member only.
        assert_eq!(
            minimum_level(Some("gwg_identification"), "gwg_identification"),
            Level::Aes
        );
        assert_eq!(minimum_level(None, "enhanced_due_diligence"), Level::Aes);
        assert_eq!(
            package_minimum_level([
                (Some("privacy_consents"), "consent"),
                (Some("confidentiality_release"), "consent"),
            ]),
            Level::Aes
        );
        assert_eq!(
            package_minimum_level([
                (Some("privacy_consents"), "consent"),
                (Some("single_order"), "single_order"),
            ]),
            Level::Qes
        );
        assert!(Level::Aes < Level::Qes);
    }

    #[test]
    fn electronic_form_is_refused_where_the_law_excludes_it() {
        assert_eq!(
            electronic_form_excluded(None, "Buergschaft"),
            Some("§ 766 S. 2 BGB")
        );
        assert_eq!(
            electronic_form_excluded(Some("selbstschuldnerische_bürgschaft"), "x"),
            Some("§ 766 S. 2 BGB")
        );
        assert_eq!(
            electronic_form_excluded(None, "employment_termination"),
            Some("§ 623 BGB")
        );
        assert_eq!(
            electronic_form_excluded(None, "arbeitszeugnis"),
            Some("§ 630 S. 3 BGB")
        );
        for allowed in [
            "framework_contract",
            "single_order",
            "cost_coverage_declaration",
            "privacy_consents",
        ] {
            assert_eq!(electronic_form_excluded(Some(allowed), "x"), None);
        }
    }

    #[test]
    fn invitation_texts_are_generic_and_list_the_whole_package() {
        let id = uuid::Uuid::nil();
        let title = invitation_title(id);
        assert_eq!(
            title,
            "Dokumente zur Unterschrift – GMED · 00000000-0000-0000-0000-000000000000"
        );
        let message = invitation_message(
            &[
                IndexEntry {
                    label: invitation_label(Some("framework_contract"), "x", false),
                    page_start: 1,
                    page_count: 4,
                },
                IndexEntry {
                    label: invitation_label(Some("medication_summary"), "x", true),
                    page_start: 5,
                    page_count: 1,
                },
            ],
            &["Datenschutzinformation"],
            Some("Bitte bis Freitag."),
            "de",
        );
        assert!(message.contains("1. Rahmenvertrag (Seiten 1–4)"));
        assert!(message.contains("2. Medizinische Unterlage (Seite 5)"));
        assert!(message.contains("– Datenschutzinformation"));
        assert!(message.ends_with("Bitte bis Freitag."));
        assert!(!message.contains("Medikation"));
        assert_eq!(normalize_note(Some("  ")).unwrap(), None);
        assert!(normalize_note(Some(&"x".repeat(501))).is_err());
        assert!(normalize_note(Some("a\u{7}b")).is_err());
        assert_eq!(suggested_language(&["English".into()]), "en");
        assert_eq!(suggested_language(&["ru".into(), "de".into()]), "de");
        assert_eq!(suggested_language(&["ru".into()]), "de");
    }
}
