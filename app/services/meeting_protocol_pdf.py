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


_ALLOWED_PDF_COLORS = {
    "#111111",
    "#b91c1c",
    "#c2410c",
    "#15803d",
    "#1d4ed8",
    "#7e22ce",
}


def _normalize_pdf_color(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip().lower()
    if text.startswith("rgb"):
        return None
    if not text.startswith("#") and len(text) == 6:
        text = f"#{text}"
    if text in _ALLOWED_PDF_COLORS:
        return text
    return None


def _html_to_reportlab(text: str) -> str:
    """Convert plain text or limited rich HTML to ReportLab Paragraph markup."""
    import html
    import re
    from html.parser import HTMLParser

    source = _plain(text)
    if not source:
        return " "

    if not re.search(r"</?[a-z][\s\S]*>", source, flags=re.I):
        return (
            html.escape(source)
            .replace("\n", "<br/>")
            or " "
        )

    class _RichToReportLab(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.parts: list[str] = []
            self._bold = 0
            self._colors: list[str] = []

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            name = tag.lower()
            attr_map = {key.lower(): (value or "") for key, value in attrs}
            if name in {"b", "strong"}:
                self._bold += 1
                self.parts.append("<b>")
            elif name == "br":
                self.parts.append("<br/>")
            elif name in {"span", "font"}:
                color = _normalize_pdf_color(attr_map.get("color"))
                if not color:
                    style = attr_map.get("style", "")
                    match = re.search(r"color\s*:\s*([^;]+)", style, flags=re.I)
                    if match:
                        color = _normalize_pdf_color(match.group(1))
                if color:
                    self._colors.append(color)
                    self.parts.append(f'<font color="{color}">')
                else:
                    self._colors.append("")
            elif name in {"div", "p"}:
                if self.parts and not self.parts[-1].endswith("<br/>"):
                    self.parts.append("<br/>")

        def handle_endtag(self, tag: str) -> None:
            name = tag.lower()
            if name in {"b", "strong"} and self._bold > 0:
                self._bold -= 1
                self.parts.append("</b>")
            elif name in {"span", "font"} and self._colors:
                color = self._colors.pop()
                if color:
                    self.parts.append("</font>")
            elif name in {"div", "p"}:
                self.parts.append("<br/>")

        def handle_data(self, data: str) -> None:
            if data:
                self.parts.append(html.escape(data))

    parser = _RichToReportLab()
    try:
        parser.feed(source)
        parser.close()
    except Exception:
        return html.escape(source).replace("\n", "<br/>") or " "

    markup = "".join(parser.parts)
    markup = re.sub(r"(?:<br/>\s*)+$", "", markup).strip()
    return markup or " "


def _pdf_paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(_html_to_reportlab(text), style)


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
