//! Completeness and timeliness of monthly personnel documents.
//!
//! Categories marked `expected_monthly` (timesheets, payslips) are expected
//! for every month an employee was employed. A month is `open` until the
//! late threshold after its end has passed, then `missing` if nothing was
//! archived; a document that arrived after the threshold is `late`.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::{Employee, err, format_month, internal, late_days, load_employees, parse_month};
use crate::{auth::middleware::AuthUser, state::AppState};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::personnel::{ArchivePeriod, archived_late};

/// State of one expected document in one month.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CellStatus {
    NotEmployed,
    Open,
    Present,
    Late,
    Missing,
}

impl CellStatus {
    fn as_str(self) -> &'static str {
        match self {
            CellStatus::NotEmployed => "not_employed",
            CellStatus::Open => "open",
            CellStatus::Present => "present",
            CellStatus::Late => "late",
            CellStatus::Missing => "missing",
        }
    }
}

fn month_end(month: NaiveDate) -> NaiveDate {
    month
        .checked_add_months(Months::new(1))
        .and_then(|next| next.pred_opt())
        .unwrap_or(month)
}

fn employed_in(employee: &Employee, month: NaiveDate) -> bool {
    employee
        .employment_start
        .is_none_or(|start| start <= month_end(month))
        && employee.employment_end.is_none_or(|end| end >= month)
}

/// The status of one cell. `first_arrival` is the earliest receipt or
/// archive date of a document for that month and category.
pub(crate) fn cell_status(
    employed: bool,
    month: NaiveDate,
    first_arrival: Option<NaiveDate>,
    today: NaiveDate,
    late_days: i64,
) -> CellStatus {
    let period = ArchivePeriod::Month {
        year: month.year(),
        month: month.month(),
    };
    let late_days = u32::try_from(late_days).unwrap_or(0);
    match first_arrival {
        Some(arrival) if archived_late(period, arrival, late_days) => CellStatus::Late,
        Some(_) => CellStatus::Present,
        None if !employed => CellStatus::NotEmployed,
        None if archived_late(period, today, late_days) => CellStatus::Missing,
        None => CellStatus::Open,
    }
}

/// First arrival per (employee, category, month) for monthly documents in
/// `[from, to]`, deleted tombstones included (they were archived).
async fn first_arrivals(
    state: &AppState,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<HashMap<(Uuid, String, NaiveDate), NaiveDate>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT employee_id, category, period_month,
                  MIN(COALESCE(received_at, archived_at)) AS first_at
           FROM personnel_documents
           WHERE period_month BETWEEN $1 AND $2
           GROUP BY employee_id, category, period_month"#,
    )
    .bind(from)
    .bind(to)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let first_at: DateTime<Utc> = row.try_get("first_at").ok()?;
            Some((
                (
                    row.try_get("employee_id").ok()?,
                    row.try_get("category").ok()?,
                    row.try_get("period_month").ok()?,
                ),
                crate::app_time::date_of(first_at),
            ))
        })
        .collect())
}

async fn expected_categories(state: &AppState) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT code, file_label FROM personnel_document_categories
           WHERE expected_monthly ORDER BY sort_order, code"#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            (
                row.try_get("code").unwrap_or_default(),
                row.try_get("file_label").unwrap_or_default(),
            )
        })
        .collect())
}

/// Missing documents of the previous month.
pub(crate) struct MissingReport {
    pub month: NaiveDate,
    /// `(employee_id, category code)`; empty while the month is still open.
    pub missing: Vec<(Uuid, String)>,
}

pub(crate) async fn missing_for_month(
    state: &AppState,
    month: NaiveDate,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    let employees = load_employees(state).await?;
    let categories = expected_categories(state).await?;
    let arrivals = first_arrivals(state, month, month).await?;
    let late = late_days(state).await;
    let today = crate::app_time::today();
    let mut missing = Vec::new();
    for employee in &employees {
        let employed = employed_in(employee, month);
        for (code, _) in &categories {
            let arrival = arrivals.get(&(employee.id, code.clone(), month)).copied();
            if cell_status(employed, month, arrival, today, late) == CellStatus::Missing {
                missing.push((employee.id, code.clone()));
            }
        }
    }
    Ok(missing)
}

pub(crate) fn previous_month(today: NaiveDate) -> NaiveDate {
    let first = today.with_day(1).unwrap_or(today);
    first.checked_sub_months(Months::new(1)).unwrap_or(first)
}

pub(crate) async fn missing_for_previous_month(
    state: &AppState,
) -> Result<MissingReport, sqlx::Error> {
    let month = previous_month(crate::app_time::today());
    Ok(MissingReport {
        month,
        missing: missing_for_month(state, month).await?,
    })
}

#[derive(Deserialize)]
pub(crate) struct CompletenessQuery {
    from: Option<String>,
    to: Option<String>,
}

pub(crate) async fn get_completeness(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<CompletenessQuery>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    let today = crate::app_time::today();
    let current = today.with_day(1).unwrap_or(today);
    let to = query.to.as_deref().and_then(parse_month).unwrap_or(current);
    let from = query
        .from
        .as_deref()
        .and_then(parse_month)
        .unwrap_or_else(|| to.checked_sub_months(Months::new(11)).unwrap_or(to));
    if from > to {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The range starts after it ends",
        );
    }
    let mut months = Vec::new();
    let mut month = from;
    while month <= to && months.len() < 36 {
        months.push(month);
        month = match month.checked_add_months(Months::new(1)) {
            Some(next) => next,
            None => break,
        };
    }
    let (employees, categories, arrivals) = match tokio::try_join!(
        load_employees(&state),
        expected_categories(&state),
        first_arrivals(&state, from, to),
    ) {
        Ok(value) => value,
        Err(error) => return internal(error, "personnel completeness"),
    };
    let late = late_days(&state).await;
    let rows: Vec<Value> = employees
        .iter()
        .map(|employee| {
            let mut cells = serde_json::Map::new();
            for month in &months {
                let employed = employed_in(employee, *month);
                let mut by_category = serde_json::Map::new();
                for (code, _) in &categories {
                    let arrival = arrivals.get(&(employee.id, code.clone(), *month)).copied();
                    by_category.insert(
                        code.clone(),
                        json!(cell_status(employed, *month, arrival, today, late).as_str()),
                    );
                }
                cells.insert(format_month(*month), Value::Object(by_category));
            }
            json!({
                "id": employee.id,
                "display_name": employee.display_name(),
                "is_active": employee.is_active_on(today),
                "cells": cells,
            })
        })
        .collect();
    Json(json!({
        "from": format_month(from),
        "to": format_month(to),
        "late_days": late,
        "months": months.iter().map(|month| format_month(*month)).collect::<Vec<_>>(),
        "categories": categories
            .iter()
            .map(|(code, label)| json!({ "code": code, "file_label": label }))
            .collect::<Vec<_>>(),
        "employees": rows,
    }))
    .into_response()
}

/// Once the grace period of a month has passed, tells every CEO which
/// monthly documents are missing for it. Runs daily; sends at most one
/// reminder per month.
pub(crate) async fn send_monthly_reminder(state: &AppState) -> Result<u64, sqlx::Error> {
    let report = missing_for_previous_month(state).await?;
    if report.missing.is_empty() {
        return Ok(0);
    }
    let month_label = report.month.format("%m.%Y").to_string();
    let mut employees: Vec<Uuid> = report.missing.iter().map(|(id, _)| *id).collect();
    employees.sort();
    employees.dedup();
    let title = format!("Personnel files: documents missing for {month_label}");
    let body = format!(
        "{} expected monthly documents for {} employees have not been archived.",
        report.missing.len(),
        employees.len()
    );
    let rows = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type)
           SELECT u.id, 'personnel_missing_documents', $1, $2, 'personnel'
           FROM users u
           WHERE u.is_active = true AND u.role = 'ceo'
             AND NOT EXISTS (
                 SELECT 1 FROM user_notifications n
                 WHERE n.user_id = u.id AND n.kind = 'personnel_missing_documents'
                   AND n.title = $1
             )
           RETURNING id, user_id"#,
    )
    .bind(&title)
    .bind(&body)
    .fetch_all(&state.db)
    .await?;
    for row in &rows {
        crate::realtime::publish_notification_event(
            state,
            row.get::<Uuid, _>("user_id"),
            "notification.created",
            Some(row.get::<Uuid, _>("id")),
            json!({ "entity_type": "personnel" }),
        )
        .await;
    }
    Ok(rows.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn cells_move_from_open_to_missing_after_the_grace_period() {
        let may = date(2026, 5, 1);
        assert_eq!(
            cell_status(true, may, None, date(2026, 6, 7), 7),
            CellStatus::Open
        );
        assert_eq!(
            cell_status(true, may, None, date(2026, 6, 8), 7),
            CellStatus::Missing
        );
        assert_eq!(
            cell_status(false, may, None, date(2026, 7, 1), 7),
            CellStatus::NotEmployed
        );
        assert_eq!(
            cell_status(true, may, Some(date(2026, 6, 3)), date(2026, 7, 1), 7),
            CellStatus::Present
        );
        assert_eq!(
            cell_status(true, may, Some(date(2026, 6, 20)), date(2026, 7, 1), 7),
            CellStatus::Late
        );
    }

    #[test]
    fn previous_month_wraps_the_year() {
        assert_eq!(previous_month(date(2026, 1, 15)), date(2025, 12, 1));
        assert_eq!(previous_month(date(2026, 10, 1)), date(2026, 9, 1));
    }

    #[test]
    fn employment_covers_partial_months() {
        let mut employee = Employee {
            id: Uuid::nil(),
            user_id: None,
            salutation: "none".into(),
            first_name: "A".into(),
            last_name: "B".into(),
            personnel_number: None,
            employment_start: Some(date(2026, 5, 20)),
            employment_end: Some(date(2026, 8, 3)),
            notes: None,
            user_name: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert!(!employed_in(&employee, date(2026, 4, 1)));
        assert!(employed_in(&employee, date(2026, 5, 1)));
        assert!(employed_in(&employee, date(2026, 8, 1)));
        assert!(!employed_in(&employee, date(2026, 9, 1)));
        employee.employment_end = None;
        assert!(employed_in(&employee, date(2030, 1, 1)));
    }
}
