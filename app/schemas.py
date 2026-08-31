from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.config import CATEGORIES, ENTRY_TYPES, LOCATIONS, SCHOOL_HOLIDAY_LABELS, STATUSES, TEAM_MEMBERS


class ProjectSettingsOut(BaseModel):
    id: int
    name: str
    team_label: str
    meeting: str
    participants: str

    model_config = {"from_attributes": True}


class ProjectSettingsUpdate(BaseModel):
    name: str | None = None
    team_label: str | None = None
    meeting: str | None = None
    participants: str | None = None


class MinuteEntryOut(BaseModel):
    id: int
    row_nr: int
    entry_type: str
    content: str | None = None
    responsible: str | None = None
    along_with: str | None = None
    since_when: date | None = None
    until_when: date | None = None
    remarks: str | None = None
    category: str | None = None
    status: str | None = None
    link: str | None = None

    model_config = {"from_attributes": True}


class MinuteEntryUpdate(BaseModel):
    row_nr: int | None = None
    entry_type: str | None = None
    content: str | None = None
    responsible: str | None = None
    along_with: str | None = None
    since_when: date | None = None
    until_when: date | None = None
    remarks: str | None = None
    category: str | None = None
    status: str | None = None
    link: str | None = None


class MinuteEntryCreate(BaseModel):
    entry_type: Literal["T", "D", "I", "Part.", "A"]
    content: str | None = None
    responsible: str | None = None
    along_with: str | None = None
    since_when: date | None = None
    until_when: date | None = None
    remarks: str | None = None
    category: str | None = None
    status: str | None = None
    before_row_nr: int | None = None
    after_row_nr: int | None = None


class MinuteRowInsert(BaseModel):
    entry_type: Literal["T", "D", "I", "Part.", "A"] = "A"
    before_row_nr: int | None = None
    after_row_nr: int | None = None


class MinuteRowsDelete(BaseModel):
    entry_ids: list[int]


class MeetingCreate(BaseModel):
    with_agenda: bool = False
    meeting_date: date | None = None


class MeetingCreateSuggestionOut(BaseModel):
    suggested_date: date
    previous_meeting_date: date | None = None
    agenda_items: int = 0


class YearPlanEntryOut(BaseModel):
    id: int
    row_nr: int
    weekday: str
    meeting_date: date
    school_holiday: str | None = None
    focus_topic: str | None = None
    fach_topic: str | None = None
    location: str | None = None
    absence_ao: str | None = None
    absence_cn: str | None = None
    absence_dk: str | None = None
    absence_js: str | None = None
    absence_gv: str | None = None
    absence_jb: str | None = None
    absence_sm: str | None = None
    absence_re: str | None = None
    absence_ak: str | None = None

    model_config = {"from_attributes": True}


class YearPlanEntryUpdate(BaseModel):
    weekday: str | None = None
    meeting_date: date | None = None
    school_holiday: str | None = None
    focus_topic: str | None = None
    fach_topic: str | None = None
    location: str | None = None
    absence_ao: str | None = None
    absence_cn: str | None = None
    absence_dk: str | None = None
    absence_js: str | None = None
    absence_gv: str | None = None
    absence_jb: str | None = None
    absence_sm: str | None = None
    absence_re: str | None = None
    absence_ak: str | None = None


class LookupsOut(BaseModel):
    entry_types: list[str] = Field(default_factory=lambda: list(ENTRY_TYPES))
    statuses: list[str] = Field(default_factory=lambda: list(STATUSES))
    categories: list[str] = Field(default_factory=lambda: list(CATEGORIES))
    team_members: list[str] = Field(default_factory=lambda: list(TEAM_MEMBERS))
    locations: list[str] = Field(default_factory=lambda: list(LOCATIONS))
    school_holiday_labels: list[str] = Field(default_factory=lambda: list(SCHOOL_HOLIDAY_LABELS))


class ImportResult(BaseModel):
    minute_rows: int
    year_plan_rows: int
    year_plan_included: bool = True
    source_file: str


class MeetingSummaryOut(BaseModel):
    id: int
    meeting_date: date | None = None
    label: str
    participants: str | None = None
