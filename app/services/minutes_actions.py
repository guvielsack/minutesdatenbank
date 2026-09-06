from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import MinuteEntry
from app.schemas import MinuteEntryCreate
from app.services.minutes_meetings import group_minutes_into_meetings


def _normalize_type(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    mapping = {
        "T": "T",
        "D": "D",
        "I": "I",
        "A": "A",
        "Part.": "Part.",
        "Pt": "Part.",
        "PT": "Part.",
    }
    return mapping.get(cleaned, cleaned)


def renumber_entries(db: Session) -> None:
    entries = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id).all()
    for index, entry in enumerate(entries, start=0):
        entry.row_nr = index


def _resolve_insert_at(db: Session, before_row_nr: int | None, after_row_nr: int | None) -> int:
    if before_row_nr is not None:
        return before_row_nr
    if after_row_nr is not None:
        return after_row_nr + 1
    max_row = db.query(MinuteEntry.row_nr).order_by(MinuteEntry.row_nr.desc()).first()
    return (max_row[0] + 1) if max_row else 0


def create_minute_entry(db: Session, payload: MinuteEntryCreate) -> MinuteEntry:
    insert_at = _resolve_insert_at(db, payload.before_row_nr, payload.after_row_nr)
    if insert_at > 0 or db.query(MinuteEntry).count() > 0:
        db.query(MinuteEntry).filter(MinuteEntry.row_nr >= insert_at).update(
            {MinuteEntry.row_nr: MinuteEntry.row_nr + 1},
            synchronize_session=False,
        )

    status = payload.status
    if payload.entry_type == "T" and not status:
        status = "open"

    today = date.today()
    if payload.entry_type == "T":
        since_when = payload.since_when or today
        until_when = payload.until_when or (today + timedelta(days=7))
    elif payload.entry_type in {"A", "I", "D"}:
        since_when = payload.since_when
        until_when = payload.until_when or today
    else:
        since_when = payload.since_when
        until_when = payload.until_when or (today if payload.entry_type == "Part." else None)

    entry = MinuteEntry(
        row_nr=insert_at,
        entry_type=payload.entry_type,
        content=payload.content,
        responsible=payload.responsible,
        along_with=payload.along_with,
        since_when=since_when,
        until_when=until_when,
        remarks=payload.remarks,
        category=payload.category,
        status=status,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    renumber_entries(db)
    db.commit()
    return db.query(MinuteEntry).filter(MinuteEntry.id == entry.id).one()


def insert_blank_row(
    db: Session,
    *,
    before_row_nr: int | None = None,
    after_row_nr: int | None = None,
    entry_type: str = "A",
) -> MinuteEntry:
    return create_minute_entry(
        db,
        MinuteEntryCreate(
            entry_type=entry_type,
            before_row_nr=before_row_nr,
            after_row_nr=after_row_nr,
        ),
    )


def delete_minute_entry(db: Session, entry_id: int) -> None:
    entry = db.query(MinuteEntry).filter(MinuteEntry.id == entry_id).first()
    if not entry:
        raise ValueError("Entry not found")
    db.delete(entry)
    db.commit()
    renumber_entries(db)
    db.commit()


def delete_minute_entries(db: Session, entry_ids: list[int]) -> int:
    if not entry_ids:
        return 0
    db.query(MinuteEntry).filter(MinuteEntry.id.in_(entry_ids)).delete(synchronize_session=False)
    db.commit()
    renumber_entries(db)
    db.commit()
    return len(entry_ids)


def move_minute_entry(db: Session, entry_id: int, direction: str) -> MinuteEntry:
    entries = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id).all()
    index = next((i for i, entry in enumerate(entries) if entry.id == entry_id), None)
    if index is None:
        raise ValueError("Entry not found")
    if direction == "up":
        swap_index = index - 1
    elif direction == "down":
        swap_index = index + 1
    else:
        raise ValueError("Ungültige Richtung")
    if swap_index < 0 or swap_index >= len(entries):
        return entries[index]

    entries[index].row_nr, entries[swap_index].row_nr = (
        entries[swap_index].row_nr,
        entries[index].row_nr,
    )
    db.commit()
    renumber_entries(db)
    db.commit()
    return db.query(MinuteEntry).filter(MinuteEntry.id == entry_id).one()


def suggest_next_meeting_date(last_date: date | None) -> date:
    if last_date is not None:
        return last_date + timedelta(days=7)
    return date.today()


def get_last_meeting_block(db: Session):
    entries = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id).all()
    meetings = group_minutes_into_meetings(entries)
    return meetings[-1] if meetings else None


def create_meeting_with_agenda(
    db: Session,
    meeting_date: date,
    participants: str | None = None,
) -> MinuteEntry:
    last_meeting = get_last_meeting_block(db)
    part = create_meeting(db, meeting_date=meeting_date, participants=participants)

    if last_meeting is None:
        return part

    agenda_templates = [entry for entry in last_meeting.entries if entry.entry_type == "A"]
    last_row_nr = part.row_nr
    for template in agenda_templates:
        created = create_minute_entry(
            db,
            MinuteEntryCreate(
                entry_type="A",
                content=template.content,
                responsible=template.responsible,
                along_with=template.along_with,
                until_when=meeting_date,
                remarks=template.remarks,
                category=template.category,
                after_row_nr=last_row_nr,
            ),
        )
        last_row_nr = created.row_nr

    return db.query(MinuteEntry).filter(MinuteEntry.id == part.id).one()


def create_meeting(db: Session, meeting_date: date | None = None, participants: str | None = None) -> MinuteEntry:
    return create_minute_entry(
        db,
        MinuteEntryCreate(
            entry_type="Part.",
            content=participants,
            until_when=meeting_date or date.today(),
        ),
    )
