from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProjectSettings(Base):
    __tablename__ = "project_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    team_label: Mapped[str] = mapped_column(String(50), default="Team:")
    meeting: Mapped[str] = mapped_column(String(100))
    participants: Mapped[str] = mapped_column(String(200))


class MinuteEntry(Base):
    __tablename__ = "minute_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    row_nr: Mapped[int] = mapped_column(Integer, index=True)
    entry_type: Mapped[str] = mapped_column(String(10))
    content: Mapped[str | None] = mapped_column(Text)
    responsible: Mapped[str | None] = mapped_column(String(100))
    along_with: Mapped[str | None] = mapped_column(String(100))
    since_when: Mapped[date | None] = mapped_column(Date)
    until_when: Mapped[date | None] = mapped_column(Date)
    remarks: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str | None] = mapped_column(String(20))
    link: Mapped[str | None] = mapped_column(String(300))


class YearPlanEntry(Base):
    __tablename__ = "year_plan_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    row_nr: Mapped[int] = mapped_column(Integer, index=True)
    weekday: Mapped[str] = mapped_column(String(20), default="Dienstag")
    meeting_date: Mapped[date] = mapped_column(Date)
    school_holiday: Mapped[str | None] = mapped_column(String(50))
    focus_topic: Mapped[str | None] = mapped_column(String(100))
    fach_topic: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(50))
    absence_ao: Mapped[str | None] = mapped_column(String(5))
    absence_cn: Mapped[str | None] = mapped_column(String(5))
    absence_dk: Mapped[str | None] = mapped_column(String(5))
    absence_js: Mapped[str | None] = mapped_column(String(5))
    absence_gv: Mapped[str | None] = mapped_column(String(5))
    absence_jb: Mapped[str | None] = mapped_column(String(5))
    absence_sm: Mapped[str | None] = mapped_column(String(5))
    absence_re: Mapped[str | None] = mapped_column(String(5))
    absence_ak: Mapped[str | None] = mapped_column(String(5))


class ImportLog(Base):
    __tablename__ = "import_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_file: Mapped[str] = mapped_column(String(300))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    minute_rows: Mapped[int] = mapped_column(Integer, default=0)
    year_plan_rows: Mapped[int] = mapped_column(Integer, default=0)
