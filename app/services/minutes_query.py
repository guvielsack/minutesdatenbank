from sqlalchemy import func, or_
from sqlalchemy.orm import Query

from app.models import MinuteEntry


def apply_open_tasks_filter(query: Query) -> Query:
    """Tasks (T) whose status is not 'done' (case-insensitive)."""
    return query.filter(
        MinuteEntry.entry_type == "T",
        or_(
            MinuteEntry.status.is_(None),
            MinuteEntry.status == "",
            func.lower(MinuteEntry.status) != "done",
        ),
    )
