from datetime import date
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import ProjectSettings
from app.services.minutes_meetings import MeetingBlock

ENTRY_TYPE_LABELS = {
    "Part.": "Meeting",
    "A": "Agenda",
    "T": "Task",
    "D": "Decision",
    "I": "Information",
}


def _format_date(value: date | None) -> str:
    if value is None:
        return ""
    return value.strftime("%d.%m.%Y")


def _plain(value: object | None) -> str:
    if value is None:
        return ""
    return str(value).replace("\r\n", "\n").strip()


def _pdf_paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    safe = (
        _plain(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(safe or " ", style)


class _FooterCanvas(canvas.Canvas):
    def __init__(
        self,
        *args,
        team_name: str = "Team",
        footer_prefix: str = "Minutes-Protokolle",
        left_margin: float = 10 * mm,
        right_margin: float = 10 * mm,
        **kwargs,
    ):
        self._team_name = team_name
        self._footer_prefix = footer_prefix
        self._left_margin = left_margin
        self._right_margin = right_margin
        super().__init__(*args, **kwargs)
        self._page_states: list[dict] = []

    def showPage(self):
        self._page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        page_count = len(self._page_states)
        for state in self._page_states:
            self.__dict__.update(state)
            self._draw_footer(page_count)
            super().showPage()
        super().save()

    def _draw_footer(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 7)
        self.setFillColor(colors.HexColor("#666666"))
        y = 6 * mm
        self.drawString(self._left_margin, y, f"{self._footer_prefix} {self._team_name}")
        self.drawRightString(
            self._pagesize[0] - self._right_margin,
            y,
            f"Seite {self._pageNumber} von {page_count}",
        )
        self.restoreState()


def build_meeting_protocol_pdf(
    project: ProjectSettings | None,
    meeting: MeetingBlock,
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
        title="Meeting-Protokoll",
    )

    styles = getSampleStyleSheet()
    header_left_style = ParagraphStyle(
        "ProtocolHeaderLeft",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=11,
    )
    header_right_style = ParagraphStyle(
        "ProtocolHeaderRight",
        parent=header_left_style,
        alignment=TA_RIGHT,
    )
    cell_style = ParagraphStyle(
        "ProtocolCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=12,
    )
    header_style = ParagraphStyle(
        "ProtocolHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12,
        textColor=colors.white,
    )

    project_name = _plain(project.name if project else "Minutes")
    team_name = project_name
    meeting_label = _format_date(meeting.meeting_date) or "Ohne Datum"
    participants = _plain(meeting.participants)

    left_lines = [
        "<font size='13'><b>Meeting-Protokoll</b></font>",
        f"<b>Projekt:</b> {project_name}",
    ]
    if project and project.meeting:
        left_lines.append(f"<b>Meeting:</b> {_plain(project.meeting)}")

    right_lines = [f"<b>Datum:</b> {meeting_label}"]
    if participants:
        right_lines.append(f"<b>Teilnehmer:</b> {participants.replace(chr(10), '<br/>')}")

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

    headers = ["Typ", "Inhalt", "Verantwortlich", "Mit", "Seit", "Bis", "Status"]
    table_data = [[Paragraph(label, header_style) for label in headers]]

    for entry in meeting.entries:
        table_data.append(
            [
                _pdf_paragraph(ENTRY_TYPE_LABELS.get(entry.entry_type, entry.entry_type), cell_style),
                _pdf_paragraph(entry.content, cell_style),
                _pdf_paragraph(entry.responsible, cell_style),
                _pdf_paragraph(entry.along_with, cell_style),
                _pdf_paragraph(_format_date(entry.since_when), cell_style),
                _pdf_paragraph(_format_date(entry.until_when), cell_style),
                _pdf_paragraph(entry.status, cell_style),
            ]
        )

    typ_w = 18 * mm
    resp_w = 28 * mm
    mit_w = 22 * mm
    since_w = 22 * mm
    until_w = 22 * mm
    status_w = 20 * mm
    fixed_width = typ_w + resp_w + mit_w + since_w + until_w + status_w
    content_w = max(80 * mm, doc.width - fixed_width)

    table = Table(
        table_data,
        colWidths=[typ_w, content_w, resp_w, mit_w, since_w, until_w, status_w],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#217346")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#bdbdbd")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f7f7")]),
            ]
        )
    )
    story.append(table)

    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: _FooterCanvas(
            *args,
            team_name=team_name,
            left_margin=margin_h,
            right_margin=margin_h,
            **kwargs,
        ),
    )
    return buffer.getvalue()
