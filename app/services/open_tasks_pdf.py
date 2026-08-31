from datetime import date, timedelta
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import MinuteEntry, ProjectSettings
from app.services.meeting_protocol_pdf import (
    _FooterCanvas,
    _format_date,
    _pdf_paragraph,
    _plain,
)


def _pdf_date_paragraph(value: date | None, style: ParagraphStyle) -> Paragraph:
    text = _format_date(value)
    if not text:
        return _pdf_paragraph(" ", style)
    safe = text.replace("&", "&amp;")
    return Paragraph(f"<nobr>{safe}</nobr>", style)


def task_faelligkeit_days(entry: MinuteEntry) -> int | None:
    if entry.until_when is None:
        return None
    return (entry.until_when - date.today()).days


def format_task_faelligkeit(entry: MinuteEntry) -> str:
    days = task_faelligkeit_days(entry)
    if days is None:
        return ""
    return str(days)


def sort_open_tasks_by_faelligkeit(entries: list[MinuteEntry]) -> list[MinuteEntry]:
    return sorted(
        entries,
        key=lambda entry: (
            task_faelligkeit_days(entry) is None,
            task_faelligkeit_days(entry) if task_faelligkeit_days(entry) is not None else 999_999,
            entry.row_nr,
            entry.id,
        ),
    )


def _task_row_background(entry: MinuteEntry) -> colors.Color | None:
    until = entry.until_when
    if until is None:
        return None

    today = date.today()
    if until < today:
        return colors.HexColor("#fde9e9")
    if until <= today + timedelta(days=7):
        return colors.HexColor("#fff4ce")
    return None


def build_open_tasks_pdf(
    project: ProjectSettings | None,
    entries: list[MinuteEntry],
) -> bytes:
    buffer = BytesIO()
    margin_h = 10 * mm
    margin_top = 8 * mm
    margin_bottom = 14 * mm
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=margin_h,
        rightMargin=margin_h,
        topMargin=margin_top,
        bottomMargin=margin_bottom,
        title="Offene Aufgaben",
    )

    styles = getSampleStyleSheet()
    header_left_style = ParagraphStyle(
        "OpenTasksHeaderLeft",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=11,
    )
    header_right_style = ParagraphStyle(
        "OpenTasksHeaderRight",
        parent=header_left_style,
        alignment=TA_RIGHT,
    )
    cell_style = ParagraphStyle(
        "OpenTasksCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=12,
    )
    header_style = ParagraphStyle(
        "OpenTasksTableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12,
        textColor=colors.white,
    )

    project_name = _plain(project.name if project else "Minutes")
    today_label = _format_date(date.today())
    sorted_entries = sort_open_tasks_by_faelligkeit(entries)

    left_lines = [
        "<font size='13'><b>Offene Aufgaben</b></font>",
        f"<b>Projekt:</b> {project_name}",
    ]
    if project and project.meeting:
        left_lines.append(f"<b>Meeting:</b> {_plain(project.meeting)}")

    right_lines = [
        f"<b>Stand:</b> {today_label}",
        f"<b>Anzahl:</b> {len(sorted_entries)}",
    ]

    header_table = Table(
        [
            [
                Paragraph("<br/>".join(left_lines), header_left_style),
                Paragraph("<br/>".join(right_lines), header_right_style),
            ]
        ],
        colWidths=[doc.width * 0.58, doc.width * 0.42],
        hAlign="LEFT",
    )
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    story = [header_table, Spacer(1, 3 * mm)]

    headers = ["#", "Inhalt", "Verantwortlich", "Mit", "Seit", "Bis", "Status", "Kategorie", "Fälligkeit"]
    table_data = [[Paragraph(label, header_style) for label in headers]]

    if sorted_entries:
        for entry in sorted_entries:
            table_data.append(
                [
                    _pdf_paragraph(str(entry.row_nr), cell_style),
                    _pdf_paragraph(entry.content, cell_style),
                    _pdf_paragraph(entry.responsible, cell_style),
                    _pdf_paragraph(entry.along_with, cell_style),
                    _pdf_date_paragraph(entry.since_when, cell_style),
                    _pdf_date_paragraph(entry.until_when, cell_style),
                    _pdf_paragraph(entry.status, cell_style),
                    _pdf_paragraph(entry.category, cell_style),
                    _pdf_paragraph(format_task_faelligkeit(entry), cell_style),
                ]
            )
    else:
        empty_style = ParagraphStyle(
            "OpenTasksEmpty",
            parent=cell_style,
            textColor=colors.HexColor("#666666"),
        )
        table_data.append(
            [
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("Keine offenen Aufgaben", empty_style),
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("", empty_style),
                _pdf_paragraph("", empty_style),
            ]
        )

    nr_w = 12 * mm
    resp_w = 26 * mm
    mit_w = 20 * mm
    since_w = 26 * mm
    until_w = 26 * mm
    status_w = 18 * mm
    category_w = 32 * mm
    duration_w = 18 * mm
    fixed_width = nr_w + resp_w + mit_w + since_w + until_w + status_w + category_w + duration_w
    content_w = max(70 * mm, doc.width - fixed_width)

    table = Table(
        table_data,
        colWidths=[nr_w, content_w, resp_w, mit_w, since_w, until_w, status_w, category_w, duration_w],
        repeatRows=1,
        hAlign="LEFT",
    )

    table_style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#217346")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#bdbdbd")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
    )

    if sorted_entries:
        row_backgrounds = [colors.white, colors.HexColor("#f7f7f7")]
        for idx, entry in enumerate(sorted_entries, start=1):
            highlight = _task_row_background(entry)
            if highlight is not None:
                table_style.add("BACKGROUND", (0, idx), (-1, idx), highlight)
            else:
                table_style.add("BACKGROUND", (0, idx), (-1, idx), row_backgrounds[idx % 2])

    table.setStyle(table_style)
    story.append(table)

    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: _FooterCanvas(
            *args,
            team_name=project_name,
            footer_prefix="Offene Aufgaben",
            left_margin=margin_h,
            right_margin=margin_h,
            **kwargs,
        ),
    )
    return buffer.getvalue()
