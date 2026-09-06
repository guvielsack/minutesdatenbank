from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from app.auth import require_admin_user, require_write_user
from app.config import DEFAULT_PROJECT, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_USERNAME, SESSION_SECRET
from app.database import Base, engine, get_db, migrate_schema
from app.importers.xlsm_import import import_workbook_bytes, year_plan_with_holidays
from app.models import AppUser, MinuteEntry, ProjectSettings, YearPlanEntry
from app.routers.admin_users import router as admin_users_router
from app.routers.auth import router as auth_router
from app.schemas import (
    ImportResult,
    LookupsOut,
    MeetingCreate,
    MeetingCreateSuggestionOut,
    MeetingSummaryOut,
    MinuteEntryCreate,
    MinuteEntryOut,
    MinuteEntryUpdate,
    MinuteRowInsert,
    MinuteRowMove,
    MinuteRowsDelete,
    ProjectSettingsOut,
    ProjectSettingsUpdate,
    YearPlanEntryOut,
    YearPlanEntryUpdate,
)
from app.services.meeting_protocol_pdf import build_meeting_protocol_pdf
from app.services.open_tasks_pdf import build_open_tasks_pdf
from app.services.minutes_actions import (
    create_meeting,
    create_meeting_with_agenda,
    create_minute_entry,
    delete_minute_entries,
    delete_minute_entry,
    get_last_meeting_block,
    insert_blank_row,
    move_minute_entry,
    suggest_next_meeting_date,
)
from app.services.minutes_meetings import get_meeting_by_part_id, list_meeting_summaries
from app.services.minutes_query import apply_open_tasks_filter
from app.services.user_service import seed_initial_admin

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="minutesdatenbank", version="0.2.0")
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="minutes_session",
    same_site="lax",
    max_age=14 * 24 * 3600,
)
app.include_router(auth_router)
app.include_router(admin_users_router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_schema()
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        if not db.query(ProjectSettings).first():
            db.add(ProjectSettings(**DEFAULT_PROJECT))
            db.commit()
        seed_initial_admin(
            db,
            username=INITIAL_ADMIN_USERNAME,
            password=INITIAL_ADMIN_PASSWORD or None,
        )
    finally:
        db.close()


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/admin")
def admin_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "admin.html")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/lookups", response_model=LookupsOut)
def get_lookups() -> LookupsOut:
    return LookupsOut()


@app.get("/api/project", response_model=ProjectSettingsOut)
def get_project(db: Session = Depends(get_db)) -> ProjectSettings:
    settings = db.query(ProjectSettings).first()
    if not settings:
        raise HTTPException(status_code=404, detail="Project settings not found")
    return settings


@app.put("/api/project", response_model=ProjectSettingsOut)
def update_project(
    payload: ProjectSettingsUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin_user),
) -> ProjectSettings:
    settings = db.query(ProjectSettings).first()
    if not settings:
        raise HTTPException(status_code=404, detail="Project settings not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return settings


@app.get("/api/minutes", response_model=list[MinuteEntryOut])
def list_minutes(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[MinuteEntry]:
    query = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id)
    if status:
        query = query.filter(MinuteEntry.status == status)
    return query.all()


@app.get("/api/minutes/open-tasks", response_model=list[MinuteEntryOut])
def list_open_tasks(
    due: Literal["all", "next-meeting"] = Query(default="all"),
    db: Session = Depends(get_db),
) -> list[MinuteEntry]:
    query = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id)
    due_by = None
    if due == "next-meeting":
        last_meeting = get_last_meeting_block(db)
        last_date = last_meeting.meeting_date if last_meeting else None
        due_by = suggest_next_meeting_date(last_date)
    return apply_open_tasks_filter(query, due_by=due_by).all()


@app.get("/api/minutes/open-tasks.pdf")
def open_tasks_pdf(
    due: Literal["all", "next-meeting"] = Query(default="all"),
    db: Session = Depends(get_db),
) -> Response:
    query = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id)
    due_by = None
    if due == "next-meeting":
        last_meeting = get_last_meeting_block(db)
        last_date = last_meeting.meeting_date if last_meeting else None
        due_by = suggest_next_meeting_date(last_date)
    entries = apply_open_tasks_filter(query, due_by=due_by).all()
    project = db.query(ProjectSettings).first()
    pdf_bytes = build_open_tasks_pdf(project, entries)
    filename_date = date.today().isoformat()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="offene-aufgaben-{filename_date}.pdf"'},
    )


@app.get("/api/minutes/meetings/suggest-next", response_model=MeetingCreateSuggestionOut)
def suggest_next_meeting(db: Session = Depends(get_db)) -> dict:
    last_meeting = get_last_meeting_block(db)
    last_date = last_meeting.meeting_date if last_meeting else None
    agenda_items = (
        len([entry for entry in last_meeting.entries if entry.entry_type == "A"])
        if last_meeting
        else 0
    )
    return {
        "suggested_date": suggest_next_meeting_date(last_date),
        "previous_meeting_date": last_date,
        "agenda_items": agenda_items,
    }


@app.get("/api/minutes/meetings", response_model=list[MeetingSummaryOut])
def list_meetings(db: Session = Depends(get_db)) -> list[dict]:
    entries = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id).all()
    return list_meeting_summaries(entries)


@app.get("/api/minutes/meetings/{part_entry_id}/protocol.pdf")
def meeting_protocol_pdf(part_entry_id: int, db: Session = Depends(get_db)) -> Response:
    entries = db.query(MinuteEntry).order_by(MinuteEntry.row_nr, MinuteEntry.id).all()
    meeting = get_meeting_by_part_id(entries, part_entry_id, for_protocol=True)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")

    project = db.query(ProjectSettings).first()
    pdf_bytes = build_meeting_protocol_pdf(project, meeting)
    filename_date = meeting.meeting_date.isoformat() if meeting.meeting_date else "ohne-datum"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="meeting-protokoll-{filename_date}.pdf"'},
    )


@app.post("/api/minutes/insert-row", response_model=MinuteEntryOut)
def insert_minute_row(
    payload: MinuteRowInsert,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> MinuteEntry:
    return insert_blank_row(
        db,
        before_row_nr=payload.before_row_nr,
        after_row_nr=payload.after_row_nr,
        entry_type=payload.entry_type,
    )


@app.post("/api/minutes/delete-rows")
def delete_minute_rows(
    payload: MinuteRowsDelete,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> dict:
    if not payload.entry_ids:
        raise HTTPException(status_code=400, detail="Keine Zeilen ausgewählt")
    deleted = delete_minute_entries(db, payload.entry_ids)
    return {"ok": True, "deleted": deleted}


@app.post("/api/minutes/{entry_id}/move", response_model=MinuteEntryOut)
def move_minute_row(
    entry_id: int,
    payload: MinuteRowMove,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> MinuteEntry:
    try:
        return move_minute_entry(db, entry_id, payload.direction)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/minutes", response_model=MinuteEntryOut)
def add_minute(
    payload: MinuteEntryCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> MinuteEntry:
    return create_minute_entry(db, payload)


@app.post("/api/minutes/meeting", response_model=MinuteEntryOut)
def add_meeting(
    payload: MeetingCreate = MeetingCreate(),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> MinuteEntry:
    settings = db.query(ProjectSettings).first()
    participants = settings.participants if settings else None

    if payload.with_agenda:
        last_meeting = get_last_meeting_block(db)
        last_date = last_meeting.meeting_date if last_meeting else None
        meeting_date = payload.meeting_date or suggest_next_meeting_date(last_date)
        return create_meeting_with_agenda(
            db,
            meeting_date=meeting_date,
            participants=participants,
        )

    return create_meeting(db, meeting_date=date.today(), participants=participants)


@app.patch("/api/minutes/{entry_id}", response_model=MinuteEntryOut)
def update_minute(
    entry_id: int,
    payload: MinuteEntryUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> MinuteEntry:
    entry = db.query(MinuteEntry).filter(MinuteEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return entry


@app.delete("/api/minutes/{entry_id}")
def delete_minute(
    entry_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> dict:
    try:
        delete_minute_entry(db, entry_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/year-plan", response_model=list[YearPlanEntryOut])
def list_year_plan(db: Session = Depends(get_db)) -> list[dict]:
    entries = db.query(YearPlanEntry).order_by(YearPlanEntry.row_nr).all()
    return [year_plan_with_holidays(entry) for entry in entries]


@app.patch("/api/year-plan/{entry_id}", response_model=YearPlanEntryOut)
def update_year_plan(
    entry_id: int,
    payload: YearPlanEntryUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_write_user),
) -> dict:
    entry = db.query(YearPlanEntry).filter(YearPlanEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return year_plan_with_holidays(entry)


ALLOWED_IMPORT_SUFFIXES = {".xlsx", ".xlsm"}


def _import_result(log, year_plan_included: bool) -> ImportResult:
    return ImportResult(
        minute_rows=log.minute_rows,
        year_plan_rows=log.year_plan_rows,
        year_plan_included=year_plan_included,
        source_file=log.source_file,
    )


@app.post("/api/import/upload", response_model=ImportResult)
async def import_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin_user),
) -> ImportResult:
    filename = (file.filename or "upload.xlsx").strip()
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_IMPORT_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Ungültiger Dateityp „{suffix or '(ohne Endung)'}“. Erlaubt: .xlsx, .xlsm",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Leere Datei")

    try:
        log, year_plan_included = import_workbook_bytes(db, content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Excel-Datei konnte nicht gelesen werden: {exc}",
        ) from exc

    return _import_result(log, year_plan_included)
