from datetime import date, timedelta

from app.config import SCHOOL_HOLIDAY_PERIODS


def excel_serial_to_date(serial: int | float) -> date:
    base = date(1899, 12, 30)
    return base + timedelta(days=int(serial))


def date_to_excel_serial(value: date) -> int:
    base = date(1899, 12, 30)
    return (value - base).days


def schulferien_label(value: date) -> str | None:
    for label, start, end in SCHOOL_HOLIDAY_PERIODS:
        if start <= value <= end:
            return label
    return None


def istferien(value: date) -> bool:
    return schulferien_label(value) is not None
