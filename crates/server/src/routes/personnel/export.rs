//! Export of personnel files for an audit (Betriebsprüfung) or the payroll
//! office: a ZIP with the archived files under their archive names, an
//! index, a SHA-256 manifest, a verification report and the daily anchors
//! with their RFC 3161 time stamps.

use std::io::{Cursor, Write};

use axum::{
    Json,
    extract::{Extension, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::documents::read_verified;
use super::integrity::{load_chain_rows, verify_links};
use super::{err, format_month, internal, load_employees, parse_month, record_event_logged};
use crate::{auth::middleware::AuthUser, state::AppState};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::personnel::name_token;

/// Upper bound of the plaintext put into one export.
const MAX_EXPORT_BYTES: i64 = 1024 * 1024 * 1024;

#[derive(Deserialize)]
pub(crate) struct ExportRequest {
    /// Empty or missing: every employee.
    employee_ids: Option<Vec<Uuid>>,
    /// `YYYY-MM`, inclusive; filters by period or document date.
    from: Option<String>,
    to: Option<String>,
    /// Superseded versions too (default true; an auditor sees corrections).
    include_versions: Option<bool>,
}

struct ExportDocument {
    id: Uuid,
    employee_id: Uuid,
    category: String,
    period: Option<NaiveDate>,
    document_date: Option<NaiveDate>,
    archive_file_name: String,
    original_file_name: String,
    mime_type: String,
    sha256: String,
    storage_key: String,
    version_number: i32,
    supersedes_name: Option<String>,
    correction_reason: Option<String>,
    source: String,
    received_at: Option<DateTime<Utc>>,
    archived_at: DateTime<Utc>,
    archived_by: String,
    chain_seq: i64,
    chain_hash: String,
}

fn csv_field(value: &str) -> String {
    // Semicolon-separated for German spreadsheet defaults; neutralise
    // formula prefixes.
    let value = if value.starts_with(['=', '+', '-', '@']) {
        format!("'{value}")
    } else {
        value.to_string()
    };
    if value.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

fn folder_name(last: &str, first: &str, number: Option<&str>) -> String {
    let mut parts = vec![name_token(last), name_token(first)];
    if let Some(number) = number {
        parts.push(name_token(number));
    }
    let name = parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    if name.is_empty() {
        "Mitarbeiter".into()
    } else {
        name
    }
}

const README: &str = "Personalakten-Export (GMed)\n\
\n\
Inhalt\n\
- <Mitarbeiter>/: archivierte Dokumente unter ihrem Archivnamen.\n\
- Index.csv: ein Eintrag je Dokument mit Kategorie, Zeitraum, Version,\n\
  Archivierungszeitpunkt, Quelle, SHA-256 und Kettenposition.\n\
- Manifest.sha256: Pruefsummen aller Dateien (pruefbar mit `sha256sum -c Manifest.sha256`).\n\
- Pruefbericht.txt: Ergebnis der Ketten- und Dateipruefung zum Exportzeitpunkt.\n\
- Zeitstempel/: taegliche Anker der Hash-Ketten. <Datum>.txt enthaelt die\n\
  Kettenkoepfe und den Ankerhash, <Datum>.tsr die Antwort des Zeitstempeldienstes\n\
  (RFC 3161). Pruefung: openssl ts -verify -digest <Ankerhash> -in <Datum>.tsr\n\
  -CAfile <Zertifikatskette des Zeitstempeldienstes>.\n\
\n\
Unveraenderbarkeit\n\
Ein archiviertes Dokument wird nie geaendert. Korrekturen sind neue Versionen\n\
(Suffix _V2, _V3 ...) mit Begruendung; die vorherige Version bleibt erhalten.\n\
Jedes Dokument ist ueber seinen SHA-256 in die Hash-Kette des Mitarbeiters\n\
eingebunden; eine nachtraegliche Aenderung oder Entfernung bricht die Kette.\n";

pub(crate) async fn export_archive(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<ExportRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelExport) {
        return response;
    }
    let from = match body
        .from
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        None => None,
        Some(value) => match parse_month(value) {
            Some(month) => Some(month),
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "From must be YYYY-MM"),
        },
    };
    let to = match body.to.as_deref().filter(|value| !value.trim().is_empty()) {
        None => None,
        Some(value) => match parse_month(value).and_then(|month| {
            month
                .checked_add_months(chrono::Months::new(1))
                .and_then(|next| next.pred_opt())
        }) {
            Some(end) => Some(end),
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "To must be YYYY-MM"),
        },
    };
    let include_health = auth.can(Capability::PersonnelHealthView);
    let include_versions = body.include_versions.unwrap_or(true);
    let employee_filter = body.employee_ids.filter(|ids| !ids.is_empty());

    let employees = match load_employees(&state).await {
        Ok(value) => value
            .into_iter()
            .filter(|employee| {
                employee_filter
                    .as_ref()
                    .is_none_or(|ids| ids.contains(&employee.id))
            })
            .collect::<Vec<_>>(),
        Err(error) => return internal(error, "load employees for export"),
    };
    if employees.is_empty() {
        return err(
            StatusCode::NOT_FOUND,
            "No personnel file matches the export",
        );
    }
    let employee_ids: Vec<Uuid> = employees.iter().map(|employee| employee.id).collect();

    let rows = match sqlx::query(
        r#"SELECT d.id, d.employee_id, d.category, d.period_month, d.document_date,
                  d.archive_file_name, d.original_file_name, d.mime_type, d.sha256, d.storage_key,
                  d.version_number, d.correction_reason, d.source, d.received_at, d.archived_at,
                  d.chain_seq, d.chain_hash, d.file_size,
                  prev.archive_file_name AS supersedes_name,
                  u.name AS archived_by_name
           FROM personnel_documents d
           JOIN personnel_document_categories c ON c.code = d.category
           LEFT JOIN personnel_documents prev ON prev.id = d.supersedes_id
           LEFT JOIN users u ON u.id = d.archived_by
           WHERE d.employee_id = ANY($1)
             AND d.deleted_at IS NULL
             AND ($2 OR NOT c.is_health)
             AND ($3::date IS NULL OR COALESCE(d.period_month, d.document_date) >= $3)
             AND ($4::date IS NULL OR COALESCE(d.period_month, d.document_date) <= $4)
             AND ($5 OR NOT EXISTS (SELECT 1 FROM personnel_documents n WHERE n.supersedes_id = d.id))
           ORDER BY d.employee_id, d.chain_seq"#,
    )
    .bind(&employee_ids)
    .bind(include_health)
    .bind(from)
    .bind(to)
    .bind(include_versions)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "load documents for export"),
    };
    let total: i64 = rows
        .iter()
        .map(|row| row.try_get::<i64, _>("file_size").unwrap_or(0))
        .sum();
    if total > MAX_EXPORT_BYTES {
        return err(
            StatusCode::PAYLOAD_TOO_LARGE,
            "The export is larger than 1 GB; choose fewer employees or a shorter period",
        );
    }
    let documents: Vec<ExportDocument> = rows
        .iter()
        .map(|row| ExportDocument {
            id: row.try_get("id").unwrap_or_default(),
            employee_id: row.try_get("employee_id").unwrap_or_default(),
            category: row.try_get("category").unwrap_or_default(),
            period: row.try_get("period_month").unwrap_or_default(),
            document_date: row.try_get("document_date").unwrap_or_default(),
            archive_file_name: row.try_get("archive_file_name").unwrap_or_default(),
            original_file_name: row.try_get("original_file_name").unwrap_or_default(),
            mime_type: row.try_get("mime_type").unwrap_or_default(),
            sha256: row.try_get("sha256").unwrap_or_default(),
            storage_key: row.try_get("storage_key").unwrap_or_default(),
            version_number: row.try_get("version_number").unwrap_or(1),
            supersedes_name: row.try_get("supersedes_name").unwrap_or_default(),
            correction_reason: row.try_get("correction_reason").unwrap_or_default(),
            source: row.try_get("source").unwrap_or_default(),
            received_at: row.try_get("received_at").unwrap_or_default(),
            archived_at: row.try_get("archived_at").unwrap_or_else(|_| Utc::now()),
            archived_by: row
                .try_get::<Option<String>, _>("archived_by_name")
                .ok()
                .flatten()
                .unwrap_or_default(),
            chain_seq: row.try_get("chain_seq").unwrap_or_default(),
            chain_hash: row.try_get("chain_hash").unwrap_or_default(),
        })
        .collect();

    // Chains are verified in full (all documents of the exported employees),
    // independent of the filter.
    let chain_rows = match load_chain_rows(&state, Some(&employee_ids)).await {
        Ok(value) => value,
        Err(error) => return internal(error, "load chains for export"),
    };
    let chain_failures = verify_links(&chain_rows);

    let mut files: Vec<(String, Vec<u8>)> = Vec::with_capacity(documents.len() + 8);
    let mut index = String::from(
        "Mitarbeiter;Personalnummer;Kategorie;Zeitraum;Dokumentdatum;Archivname;Originalname;\
         Version;Korrektur_von;Korrekturgrund;Quelle;Eingang;Archiviert;Archiviert_von;SHA256;\
         Kettenposition;Kettenhash;Pfad\n",
    );
    let mut blob_problems: Vec<String> = Vec::new();
    for document in &documents {
        let Some(employee) = employees
            .iter()
            .find(|item| item.id == document.employee_id)
        else {
            continue;
        };
        let folder = folder_name(
            &employee.last_name,
            &employee.first_name,
            employee.personnel_number.as_deref(),
        );
        let path = format!("{folder}/{}", document.archive_file_name);
        match read_verified(
            document.id,
            &document.storage_key,
            &document.mime_type,
            &document.archive_file_name,
            &document.sha256,
        )
        .await
        {
            Ok(bytes) => files.push((path.clone(), bytes)),
            Err(problem) => {
                blob_problems.push(format!("{path}: {problem}"));
                continue;
            }
        }
        let line = [
            employee.display_name(),
            employee.personnel_number.clone().unwrap_or_default(),
            document.category.clone(),
            document.period.map(format_month).unwrap_or_default(),
            document
                .document_date
                .map(|date| date.format("%d.%m.%Y").to_string())
                .unwrap_or_default(),
            document.archive_file_name.clone(),
            document.original_file_name.clone(),
            document.version_number.to_string(),
            document.supersedes_name.clone().unwrap_or_default(),
            document.correction_reason.clone().unwrap_or_default(),
            document.source.clone(),
            document
                .received_at
                .map(|value| {
                    crate::app_time::local(value)
                        .format("%d.%m.%Y %H:%M:%S")
                        .to_string()
                })
                .unwrap_or_default(),
            crate::app_time::local(document.archived_at)
                .format("%d.%m.%Y %H:%M:%S")
                .to_string(),
            document.archived_by.clone(),
            document.sha256.clone(),
            document.chain_seq.to_string(),
            document.chain_hash.clone(),
            path,
        ]
        .iter()
        .map(|value| csv_field(value))
        .collect::<Vec<_>>()
        .join(";");
        index.push_str(&line);
        index.push('\n');
    }

    // Anchors and their time stamps.
    let anchors = match sqlx::query(
        r#"SELECT anchor_date, anchor_hash, heads, tsa_status, tsa_gen_time, tsa_url, tsa_token
           FROM personnel_chain_anchors ORDER BY anchor_date"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "load anchors for export"),
    };
    let mut stamped = 0usize;
    for anchor in &anchors {
        let date: NaiveDate = anchor.try_get("anchor_date").unwrap_or_default();
        let hash: String = anchor.try_get("anchor_hash").unwrap_or_default();
        let heads: serde_json::Value = anchor.try_get("heads").unwrap_or_default();
        let status: String = anchor.try_get("tsa_status").unwrap_or_default();
        let gen_time: Option<DateTime<Utc>> = anchor.try_get("tsa_gen_time").unwrap_or_default();
        let lines: Vec<String> = heads
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let stamp = date.format("%Y%m%d");
        let text = format!(
            "Anker vom {}\nAnkerhash (SHA-256 ueber die Zeilen unten, getrennt durch \\n): {hash}\nZeitstempel: {status}{}\n\nKettenkoepfe (Mitarbeiter:Position:Hash):\n{}\n",
            date.format("%d.%m.%Y"),
            gen_time
                .map(|value| format!(" ({})", value.to_rfc3339()))
                .unwrap_or_default(),
            lines.join("\n"),
        );
        files.push((format!("Zeitstempel/{stamp}.txt"), text.into_bytes()));
        if let Some(token) = anchor
            .try_get::<Option<Vec<u8>>, _>("tsa_token")
            .ok()
            .flatten()
        {
            files.push((format!("Zeitstempel/{stamp}.tsr"), token));
            stamped += 1;
        }
    }

    let now = Utc::now();
    let actor_name = sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = $1")
        .bind(auth.user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let mut report = format!(
        "Pruefbericht Personalakten-Export\n\
         Erstellt: {} von {}\n\
         Mitarbeiter: {}\n\
         Dokumente im Export: {}\n\
         Zeitraum: {} bis {}\n\
         Fruehere Versionen enthalten: {}\n\
         Gesundheitsdaten enthalten: {}\n\
         Anker: {} (davon mit Zeitstempel: {stamped})\n\n",
        crate::app_time::local(now).format("%d.%m.%Y %H:%M:%S"),
        actor_name,
        employees.len(),
        files
            .iter()
            .filter(|(path, _)| !path.starts_with("Zeitstempel/"))
            .count(),
        from.map(format_month).unwrap_or_else(|| "-".into()),
        to.map(format_month).unwrap_or_else(|| "-".into()),
        if include_versions { "ja" } else { "nein" },
        if include_health { "ja" } else { "nein" },
        anchors.len(),
    );
    if chain_failures.is_empty() && blob_problems.is_empty() {
        report.push_str(
            "Ergebnis: Alle Hash-Ketten sind vollstaendig und unveraendert; alle Dateien\n\
             entsprechen ihrer bei der Archivierung gespeicherten SHA-256-Pruefsumme.\n",
        );
    } else {
        report.push_str("Ergebnis: PROBLEME GEFUNDEN\n");
        for failure in &chain_failures {
            report.push_str(&format!(
                "- Kette {}: Dokument {}: {}\n",
                failure
                    .employee_id
                    .map(|id| id.to_string())
                    .unwrap_or_default(),
                failure
                    .document_id
                    .map(|id| id.to_string())
                    .unwrap_or_default(),
                failure.problem
            ));
        }
        for problem in &blob_problems {
            report.push_str(&format!("- Datei {problem}\n"));
        }
    }

    files.push(("Index.csv".into(), index.into_bytes()));
    files.push(("Pruefbericht.txt".into(), report.into_bytes()));
    files.push(("LIESMICH.txt".into(), README.as_bytes().to_vec()));
    // Every file but the manifest itself, metadata included, so an edited
    // index or report fails `sha256sum -c`.
    let manifest = manifest_lines(&files);
    files.push(("Manifest.sha256".into(), manifest.into_bytes()));

    let document_count = documents.len();
    let zip = match tokio::task::spawn_blocking(move || build_zip(files)).await {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(error)) => return internal(error, "build personnel export"),
        Err(error) => return internal(error, "build personnel export"),
    };
    for employee in &employees {
        record_event_logged(
            &state,
            Some(employee.id),
            None,
            Some(auth.user_id),
            "export_created",
            json!({
                "from": from.map(format_month),
                "to": to.map(format_month),
                "include_versions": include_versions,
                "include_health": include_health,
                "employees": employees.len(),
                "documents": document_count,
                "problems": chain_failures.len() + blob_problems.len(),
            }),
        )
        .await;
    }
    let file_name = format!(
        "Personalakten_Export_{}.zip",
        crate::app_time::local(now).format("%Y%m%d_%H%M")
    );
    (
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{file_name}\""),
            ),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        zip,
    )
        .into_response()
}

/// `sha256sum` lines for every file in the export.
fn manifest_lines(files: &[(String, Vec<u8>)]) -> String {
    files
        .iter()
        .map(|(path, bytes)| {
            format!(
                "{}  {path}
",
                super::documents::sha256_hex(bytes)
            )
        })
        .collect()
}

fn build_zip(files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (path, bytes) in files {
        writer
            .start_file(path, options)
            .map_err(|error| error.to_string())?;
        writer
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_fields_are_quoted_and_formula_safe() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a;b"), "\"a;b\"");
        assert_eq!(csv_field("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_field("=SUM(A1)"), "'=SUM(A1)");
    }

    #[test]
    fn folders_use_archive_safe_names() {
        assert_eq!(
            folder_name("Müller", "Jörg", Some("1001")),
            "Mueller_Joerg_1001"
        );
        assert_eq!(folder_name("Doe", "", None), "Doe");
        assert_eq!(folder_name("", "", None), "Mitarbeiter");
    }

    #[test]
    fn manifest_covers_metadata_files() {
        let manifest = manifest_lines(&[
            ("A/one.pdf".into(), b"%PDF-1.7".to_vec()),
            ("Index.csv".into(), b"x".to_vec()),
            ("Pruefbericht.txt".into(), b"ok".to_vec()),
        ]);
        assert_eq!(manifest.lines().count(), 3);
        assert!(manifest.contains(
            "  Index.csv
"
        ));
        assert!(manifest.contains(
            "  Pruefbericht.txt
"
        ));
        assert!(!manifest.contains("Manifest.sha256"));
    }

    #[test]
    fn zip_contains_every_file() {
        let bytes = build_zip(vec![
            ("A/one.pdf".into(), b"%PDF-1.7".to_vec()),
            ("Index.csv".into(), b"x".to_vec()),
        ])
        .unwrap();
        let archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<&str> = archive.file_names().collect();
        assert!(names.contains(&"A/one.pdf"));
        assert!(names.contains(&"Index.csv"));
    }
}
