//! GMed works in German time only. "Today", document and booking dates and
//! every date-only business rule follow Europe/Berlin, whatever zone the host
//! or the viewer's browser runs in. Database sessions use the same zone (see
//! `gmed_db::SESSION_TIME_ZONE`), so `CURRENT_DATE` and `timestamptz::date`
//! agree with these helpers.

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, TimeZone, Utc};

pub const APP_TIME_ZONE: chrono_tz::Tz = chrono_tz::Europe::Berlin;

/// Current calendar date in Germany.
pub fn today() -> NaiveDate {
    date_of(Utc::now())
}

/// German wall-clock time of an instant, for dates and times printed on
/// documents, numbers and notifications.
pub fn local(instant: DateTime<Utc>) -> DateTime<chrono_tz::Tz> {
    instant.with_timezone(&APP_TIME_ZONE)
}

/// Calendar date of an instant in Germany: a payment booked at 00:30 local
/// time (22:30 UTC the evening before) belongs to the local day.
pub fn date_of(instant: DateTime<Utc>) -> NaiveDate {
    instant.with_timezone(&APP_TIME_ZONE).date_naive()
}

/// Instant of a German wall-clock time, such as a naive `datetime-local`
/// value or an appointment date and time. In the autumn overlap the earlier
/// instant wins; a time inside the spring-forward gap (02:00–03:00) moves to
/// the first valid local instant instead of being read as UTC.
pub fn from_local(local: NaiveDateTime) -> DateTime<Utc> {
    for minutes in 0..=180 {
        let candidate = local + Duration::minutes(minutes);
        if let Some(value) = APP_TIME_ZONE.from_local_datetime(&candidate).earliest() {
            return value.with_timezone(&Utc);
        }
    }
    unreachable!("Europe/Berlin must have a valid local instant within three hours")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instants_after_german_midnight_belong_to_the_next_day() {
        // Summer time: UTC+2.
        let summer = Utc.with_ymd_and_hms(2026, 9, 27, 22, 30, 0).unwrap();
        assert_eq!(date_of(summer), NaiveDate::from_ymd_opt(2026, 9, 28).unwrap());
        // Winter time: UTC+1.
        let winter = Utc.with_ymd_and_hms(2026, 12, 31, 23, 30, 0).unwrap();
        assert_eq!(date_of(winter), NaiveDate::from_ymd_opt(2027, 1, 1).unwrap());
        let before = Utc.with_ymd_and_hms(2026, 12, 31, 22, 59, 0).unwrap();
        assert_eq!(date_of(before), NaiveDate::from_ymd_opt(2026, 12, 31).unwrap());
    }

    fn wall(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").unwrap()
    }

    #[test]
    fn german_wall_clock_times_resolve_across_daylight_saving_changes() {
        assert_eq!(
            from_local(wall("2026-09-27T10:00")),
            Utc.with_ymd_and_hms(2026, 9, 27, 8, 0, 0).unwrap()
        );
        assert_eq!(
            from_local(wall("2026-12-01T10:00")),
            Utc.with_ymd_and_hms(2026, 12, 1, 9, 0, 0).unwrap()
        );
        // 2026-03-29 02:30 does not exist; the clock jumps to 03:00 (01:00 UTC).
        assert_eq!(
            from_local(wall("2026-03-29T02:30")),
            Utc.with_ymd_and_hms(2026, 3, 29, 1, 0, 0).unwrap()
        );
        // 2026-10-25 02:30 happens twice; the first one (still summer time) wins.
        assert_eq!(
            from_local(wall("2026-10-25T02:30")),
            Utc.with_ymd_and_hms(2026, 10, 25, 0, 30, 0).unwrap()
        );
    }
}
