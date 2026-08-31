from dataclasses import dataclass
from datetime import date

from app.models import MinuteEntry


@dataclass
class MeetingBlock:
    part_entry_id: int
    meeting_date: date | None
    participants: str | None
    entries: list[MinuteEntry]


def entry_belongs_to_meeting(entry: MinuteEntry, meeting_date: date | None) -> bool:
    if entry.entry_type == "Part.":
        return True
    if meeting_date is None:
        return True
    if entry.entry_type == "T":
        return entry.since_when == meeting_date
    return entry.until_when == meeting_date


def filter_meeting_entries(entries: list[MinuteEntry], meeting_date: date | None) -> list[MinuteEntry]:
    return [entry for entry in entries if entry_belongs_to_meeting(entry, meeting_date)]


def group_minutes_into_meetings(entries: list[MinuteEntry]) -> list[MeetingBlock]:
    meetings: list[MeetingBlock] = []
    current: MeetingBlock | None = None

    for entry in entries:
        if entry.entry_type == "Part.":
            if current is not None:
                meetings.append(current)
            current = MeetingBlock(
                part_entry_id=entry.id,
                meeting_date=entry.until_when or entry.since_when,
                participants=entry.content,
                entries=[entry],
            )
            continue
        if current is not None:
            current.entries.append(entry)

    if current is not None:
        meetings.append(current)

    return meetings

def format_meeting_label(meeting_date: date | None, duplicate_index: int = 0) -> str:
    if meeting_date is None:
        return "Ohne Datum"
    label = meeting_date.strftime("%d.%m.%Y")
    if duplicate_index > 0:
        label = f"{label} ({duplicate_index + 1})"
    return label


def list_meeting_summaries(entries: list[MinuteEntry]) -> list[dict]:
    meetings = group_minutes_into_meetings(entries)
    date_counts: dict[date, int] = {}

    summaries: list[dict] = []
    for meeting in meetings:
        meeting_date = meeting.meeting_date
        duplicate_index = 0
        if meeting_date is not None:
            duplicate_index = date_counts.get(meeting_date, 0)
            date_counts[meeting_date] = duplicate_index + 1

        summaries.append(
            {
                "id": meeting.part_entry_id,
                "meeting_date": meeting_date,
                "label": format_meeting_label(meeting_date, duplicate_index),
                "participants": meeting.participants,
            }
        )

    summaries.sort(
        key=lambda item: (item["meeting_date"] is not None, item["meeting_date"] or date.min, item["id"]),
        reverse=True,
    )
    return summaries


def get_meeting_by_part_id(
    entries: list[MinuteEntry],
    part_entry_id: int,
    *,
    for_protocol: bool = False,
) -> MeetingBlock | None:
    for meeting in group_minutes_into_meetings(entries):
        if meeting.part_entry_id != part_entry_id:
            continue
        if not for_protocol:
            return meeting
        return MeetingBlock(
            part_entry_id=meeting.part_entry_id,
            meeting_date=meeting.meeting_date,
            participants=meeting.participants,
            entries=filter_meeting_entries(meeting.entries, meeting.meeting_date),
        )
    return None