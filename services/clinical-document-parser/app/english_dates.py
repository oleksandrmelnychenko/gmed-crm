"""Unambiguous dates only: a slash date does not establish US/UK ordering."""
import re
from datetime import date

MONTHS = {name: index for index, name in enumerate(
    ("january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"), start=1)}
MONTHS.update({name[:3]: index for name, index in list(MONTHS.items())})


def normalize_english_date(value: str) -> str | None:
    value = value.strip().rstrip(".,;")
    parts: tuple[int, int, int] | None = None
    if match := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", value):
        parts = tuple(map(int, match.groups()))
    elif match := re.fullmatch(r"(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})", value):
        day, month, year = match.groups()
        parts = (int(year), MONTHS.get(month.lower(), 0), int(day))
    elif match := re.fullmatch(r"([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", value):
        month, day, year = match.groups()
        parts = (int(year), MONTHS.get(month.lower(), 0), int(day))
    elif match := re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", value):
        first, second, year = map(int, match.groups())
        if first > 12 or first == second:
            parts = (year, second, first)
        elif second > 12:
            parts = (year, first, second)
    if parts is None:
        return None
    try:
        return date(*parts).isoformat()
    except ValueError:
        return None
