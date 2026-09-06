from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.orm import Query

from app.models import MinuteEntry


def apply_open_tasks_filter(query: Query, *, due_by: date | None = None) -> Query:
    """Tasks (T) whose status is not 'done' (case-insensitive).

    If due_by is set, only tasks with until_when on or before that date.
    """
    filtered = query.filter(
        MinuteEntry.entry_type == "T",
        or_(
            MinuteEntry.status.is_(None),
            MinuteEntry.status == "",
            func.lower(MinuteEntry.status) != "done",
        ),
    )
    if due_by is not None:
        filtered = filtered.filter(
            MinuteEntry.until_when.isnot(None),
            MinuteEntry.until_when <= due_by,
        )
    return filtered
