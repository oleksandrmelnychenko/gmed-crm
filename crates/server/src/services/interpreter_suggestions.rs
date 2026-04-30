use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct InterpreterSuggestion {
    pub interpreter_id: Uuid,
    pub interpreter_name: String,
    pub role: String,
    pub preference: String,
    pub language_status: String,
    pub languages: Vec<String>,
    pub previous_appointment_count: i64,
    pub completed_appointment_count: i64,
    pub approved_report_count: i64,
    pub total_report_hours: String,
    pub average_feedback_score: Option<f64>,
    pub last_worked_at: Option<String>,
    pub score: i64,
    pub reasons: Vec<String>,
}

pub async fn load_appointment_interpreter_suggestions(
    pool: &gmed_db::DbPool,
    appointment_id: Uuid,
) -> Result<Vec<InterpreterSuggestion>, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH target AS (
                SELECT a.id, a.patient_id, COALESCE(p.languages, ARRAY[]::text[]) AS patient_languages
                FROM appointments a
                JOIN patients p ON p.id = a.patient_id
                WHERE a.id = $1
           ),
           history AS (
                SELECT a.interpreter_id,
                       COUNT(*)::bigint AS previous_appointment_count,
                       COUNT(*) FILTER (WHERE a.status = 'completed')::bigint AS completed_appointment_count,
                       COUNT(ir.id) FILTER (WHERE ir.approval_status = 'approved')::bigint AS approved_report_count,
                       COALESCE(SUM(ir.hours) FILTER (WHERE ir.approval_status = 'approved'), 0) AS total_report_hours,
                       MAX(a.date) AS last_worked_at
                FROM appointments a
                LEFT JOIN interpreter_reports ir
                       ON ir.appointment_id = a.id
                      AND ir.interpreter_id = a.interpreter_id
                WHERE a.patient_id = (SELECT patient_id FROM target)
                  AND a.interpreter_id IS NOT NULL
                  AND a.id <> $1
                GROUP BY a.interpreter_id
           ),
           feedback AS (
                SELECT interpreter_id,
                       AVG(interpreter_score)::float8 AS average_feedback_score,
                       COUNT(*)::bigint AS feedback_count
                FROM patient_feedback_forms
                WHERE patient_id = (SELECT patient_id FROM target)
                  AND interpreter_id IS NOT NULL
                  AND interpreter_score IS NOT NULL
                GROUP BY interpreter_id
           ),
           languages AS (
                SELECT interpreter_id,
                       ARRAY_AGG(language_code ORDER BY language_code) AS languages
                FROM interpreter_languages
                WHERE is_active = true
                GROUP BY interpreter_id
           )
           SELECT u.id,
                  u.name,
                  u.role,
                  COALESCE(pref.preference, 'neutral') AS preference,
                  COALESCE(lang.languages, ARRAY[]::text[]) AS languages,
                  target.patient_languages,
                  COALESCE(history.previous_appointment_count, 0)::bigint AS previous_appointment_count,
                  COALESCE(history.completed_appointment_count, 0)::bigint AS completed_appointment_count,
                  COALESCE(history.approved_report_count, 0)::bigint AS approved_report_count,
                  COALESCE(history.total_report_hours, 0) AS total_report_hours,
                  feedback.average_feedback_score,
                  history.last_worked_at
           FROM target
           JOIN users u ON u.is_active = true
                       AND u.role IN ('interpreter', 'teamlead_interpreter')
           LEFT JOIN interpreter_patient_preferences pref
                  ON pref.patient_id = target.patient_id
                 AND pref.interpreter_id = u.id
           LEFT JOIN history ON history.interpreter_id = u.id
           LEFT JOIN feedback ON feedback.interpreter_id = u.id
           LEFT JOIN languages lang ON lang.interpreter_id = u.id
           WHERE COALESCE(pref.preference, 'neutral') <> 'avoid'
           ORDER BY COALESCE(history.previous_appointment_count, 0) DESC,
                    feedback.average_feedback_score DESC NULLS LAST,
                    u.name
           LIMIT 50"#,
    )
    .bind(appointment_id)
    .fetch_all(pool)
    .await?;

    let mut suggestions = Vec::with_capacity(rows.len());
    for row in rows {
        let preference = row
            .try_get::<String, _>("preference")
            .unwrap_or_else(|_| "neutral".to_string());
        let languages = row
            .try_get::<Vec<String>, _>("languages")
            .unwrap_or_default();
        let patient_languages = row
            .try_get::<Vec<String>, _>("patient_languages")
            .unwrap_or_default();
        let previous_appointment_count = row
            .try_get::<i64, _>("previous_appointment_count")
            .unwrap_or_default();
        let completed_appointment_count = row
            .try_get::<i64, _>("completed_appointment_count")
            .unwrap_or_default();
        let approved_report_count = row
            .try_get::<i64, _>("approved_report_count")
            .unwrap_or_default();
        let total_report_hours = row
            .try_get::<Decimal, _>("total_report_hours")
            .unwrap_or(Decimal::ZERO);
        let average_feedback_score = row
            .try_get::<Option<f64>, _>("average_feedback_score")
            .unwrap_or_default();
        let last_worked_at = row
            .try_get::<Option<chrono::NaiveDate>, _>("last_worked_at")
            .unwrap_or_default()
            .map(|value| value.to_string());

        let language_status = language_status(&languages, &patient_languages);
        let (score, reasons) = suggestion_score(
            &preference,
            &language_status,
            previous_appointment_count,
            completed_appointment_count,
            approved_report_count,
            total_report_hours,
            average_feedback_score,
        );

        suggestions.push(InterpreterSuggestion {
            interpreter_id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
            interpreter_name: row.try_get::<String, _>("name").unwrap_or_default(),
            role: row.try_get::<String, _>("role").unwrap_or_default(),
            preference,
            language_status,
            languages,
            previous_appointment_count,
            completed_appointment_count,
            approved_report_count,
            total_report_hours: total_report_hours.round_dp(2).normalize().to_string(),
            average_feedback_score,
            last_worked_at,
            score,
            reasons,
        });
    }

    suggestions.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.interpreter_name.cmp(&right.interpreter_name))
    });
    Ok(suggestions)
}

fn language_status(languages: &[String], patient_languages: &[String]) -> String {
    if languages.is_empty() {
        return "language unknown".to_string();
    }

    let normalized_patient_languages = patient_languages
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if normalized_patient_languages.is_empty() {
        return "patient language unknown".to_string();
    }

    let matches_patient_language = languages.iter().any(|language| {
        let normalized = language.trim().to_lowercase();
        normalized_patient_languages
            .iter()
            .any(|patient_language| patient_language == &normalized)
    });

    if matches_patient_language {
        "language match".to_string()
    } else {
        "language listed".to_string()
    }
}

fn suggestion_score(
    preference: &str,
    language_status: &str,
    previous_appointment_count: i64,
    completed_appointment_count: i64,
    approved_report_count: i64,
    total_report_hours: Decimal,
    average_feedback_score: Option<f64>,
) -> (i64, Vec<String>) {
    let mut score = 0;
    let mut reasons = Vec::new();

    if preference == "preferred" {
        score += 100;
        reasons.push("preferred for this patient".to_string());
    }
    if previous_appointment_count > 0 {
        score += previous_appointment_count.saturating_mul(10);
        reasons.push(format!("worked before ({previous_appointment_count} appointments)"));
    }
    if completed_appointment_count > 0 {
        score += completed_appointment_count.saturating_mul(4);
    }
    if approved_report_count > 0 {
        score += approved_report_count.saturating_mul(3);
    }
    let hour_bonus = total_report_hours.trunc().to_string().parse::<i64>().unwrap_or(0);
    score += hour_bonus.min(20);

    if let Some(avg) = average_feedback_score {
        if avg >= 4.5 {
            score += 25;
            reasons.push("high feedback".to_string());
        } else if avg >= 4.0 {
            score += 15;
            reasons.push("good feedback".to_string());
        }
    }

    match language_status {
        "language match" => {
            score += 15;
            reasons.push("language match".to_string());
        }
        "language unknown" => reasons.push("language unknown".to_string()),
        _ => {}
    }

    if reasons.is_empty() {
        reasons.push("available interpreter".to_string());
    }

    (score, reasons)
}
