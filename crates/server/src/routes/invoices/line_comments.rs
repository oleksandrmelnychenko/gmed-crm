//! Remarks on single invoice positions.
//!
//! A line of `invoices.line_items` may carry a `comment`: one short line that
//! says what the position covers, e.g. which supplier invoice a passed-on
//! amount belongs to, or the quarters two units of a recurring service are
//! billed for. It is printed under the position on the PDF and goes into the
//! e-invoice as the invoice line note (BT-127).
//!
//! The comment is given with the position when the invoice is created, or
//! set on the draft afterwards. Like every other part of the lines it is
//! fixed once the invoice is released (§ 14 UStG, GoBD).

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::{ensure_patient_access, err, load_invoice_detail};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// Longest comment a position can carry; about three lines of the PDF column.
pub(crate) const MAX_LINE_COMMENT_CHARS: usize = 300;

const LINE_COMMENT_KEY: &str = "comment";
pub(crate) const LINE_COMMENT_TOO_LONG: &str = "Invoice line comment is too long";

/// A comment as it is stored: a single line without control characters,
/// `None` when nothing is left. `Err` when it is longer than
/// [`MAX_LINE_COMMENT_CHARS`].
pub(crate) fn normalize_line_comment(value: Option<&str>) -> Result<Option<String>, &'static str> {
    let normalized = value
        .unwrap_or_default()
        .split(|character: char| character.is_whitespace() || character.is_control())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return Ok(None);
    }
    if normalized.chars().count() > MAX_LINE_COMMENT_CHARS {
        return Err(LINE_COMMENT_TOO_LONG);
    }
    Ok(Some(normalized))
}

/// The comment of one stored invoice line.
pub(crate) fn line_comment(item: &Value) -> Option<String> {
    item.get(LINE_COMMENT_KEY)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|comment| !comment.is_empty())
        .map(str::to_string)
}

/// Sets or clears the comment of one line.
pub(crate) fn set_line_comment(item: &mut Value, comment: Option<String>) {
    let Some(map) = item.as_object_mut() else {
        return;
    };
    match comment {
        Some(comment) => {
            map.insert(LINE_COMMENT_KEY.to_string(), Value::String(comment));
        }
        None => {
            map.remove(LINE_COMMENT_KEY);
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct LineCommentInput {
    line_index: usize,
    comment: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateLineCommentsRequest {
    comments: Vec<LineCommentInput>,
}

/// `POST /invoices/{id}/line-comments`: sets or clears the comments of the
/// named positions of a draft invoice. The row is locked, so a concurrent
/// release either sees the new comments or makes this request fail; the audit
/// row (old and new comment per changed position) commits with the change.
pub(crate) async fn update_invoice_line_comments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<UpdateLineCommentsRequest>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to update invoice line comments";
    if !auth.can(Capability::InvoicesCreate) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let patient_id =
        match sqlx::query_scalar::<_, Uuid>("SELECT patient_id FROM invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(Some(patient_id)) => patient_id,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
            Err(error) => {
                tracing::error!(%error, %invoice_id, "load invoice line comment context");
                return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
            }
        };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }

    let mut requested = Vec::with_capacity(body.comments.len());
    for input in &body.comments {
        let Ok(comment) = normalize_line_comment(input.comment.as_deref()) else {
            return err(StatusCode::UNPROCESSABLE_ENTITY, LINE_COMMENT_TOO_LONG);
        };
        if requested
            .iter()
            .any(|(line_index, _)| *line_index == input.line_index)
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invoice line was given more than once",
            );
        }
        requested.push((input.line_index, comment));
    }

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "begin invoice line comment transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let locked = match sqlx::query(
        r#"SELECT patient_id, released_at IS NOT NULL AS released, status::text AS status, line_items
           FROM invoices WHERE id = $1 FOR UPDATE"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "lock invoice line comments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if locked.try_get::<Uuid, _>("patient_id").ok() != Some(patient_id) {
        return err(
            StatusCode::CONFLICT,
            "Invoice changed; reload and try again",
        );
    }
    // The positions are part of the issued document (§ 14 UStG, GoBD).
    if locked.try_get::<bool, _>("released").unwrap_or(false)
        || locked.try_get::<String, _>("status").ok().as_deref() != Some("draft")
    {
        return err(
            StatusCode::CONFLICT,
            "The positions of a released invoice cannot change; cancel the invoice and issue a new one",
        );
    }

    let mut lines = match locked.try_get::<Value, _>("line_items") {
        Ok(Value::Array(lines)) => lines,
        _ => Vec::new(),
    };
    let mut before = Vec::new();
    let mut after = Vec::new();
    for (line_index, comment) in requested {
        let Some(line) = lines.get_mut(line_index) else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invoice line does not exist",
            );
        };
        let previous = line_comment(line);
        if previous == comment {
            continue;
        }
        before.push(json!({ "line_index": line_index, "comment": previous }));
        after.push(json!({ "line_index": line_index, "comment": comment }));
        set_line_comment(line, comment);
    }

    if !after.is_empty() {
        if let Err(error) =
            sqlx::query("UPDATE invoices SET line_items = $2, updated_at = now() WHERE id = $1")
                .bind(invoice_id)
                .bind(Value::Array(lines))
                .execute(&mut *transaction)
                .await
        {
            tracing::error!(%error, %invoice_id, "update invoice line comments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
        let mut event = audit::domain_diff_event(
            "invoice_line_comments_changed",
            Some(auth.user_id),
            "invoice",
            Some(invoice_id),
            json!({ "comments": before }),
            json!({ "comments": after }),
        );
        event.context = json!({ "patient_id": patient_id });
        if let Err(error) = audit::write_in_transaction(&mut transaction, &event).await {
            tracing::error!(%error, %invoice_id, "audit invoice line comments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %invoice_id, "commit invoice line comments");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(invoice).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments_are_stored_as_one_trimmed_line() {
        assert_eq!(normalize_line_comment(None), Ok(None));
        assert_eq!(normalize_line_comment(Some("  \n\t ")), Ok(None));
        assert_eq!(
            normalize_line_comment(Some("  2. und 3.\nQuartal\u{7}  2026 ")),
            Ok(Some("2. und 3. Quartal 2026".to_string()))
        );
        assert_eq!(
            normalize_line_comment(Some(&"ä".repeat(MAX_LINE_COMMENT_CHARS))),
            Ok(Some("ä".repeat(MAX_LINE_COMMENT_CHARS)))
        );
        assert_eq!(
            normalize_line_comment(Some(&"ä".repeat(MAX_LINE_COMMENT_CHARS + 1))),
            Err(LINE_COMMENT_TOO_LONG)
        );
    }

    #[test]
    fn a_line_keeps_its_other_fields_when_the_comment_changes() {
        let mut line = json!({ "description": "Dolmetscher", "quantity": "2" });
        assert_eq!(line_comment(&line), None);
        set_line_comment(&mut line, Some("2. und 3. Quartal".to_string()));
        assert_eq!(line_comment(&line).as_deref(), Some("2. und 3. Quartal"));
        assert_eq!(line["description"], "Dolmetscher");
        set_line_comment(&mut line, None);
        assert_eq!(
            line,
            json!({ "description": "Dolmetscher", "quantity": "2" })
        );
    }
}
