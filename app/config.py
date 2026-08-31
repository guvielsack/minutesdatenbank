from datetime import date
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'minutesdatenbank.db'}")

DEFAULT_PROJECT = {
    "name": "Digital Future Reko Führungsteam",
    "team_label": "Team:",
    "meeting": "Di. Regel-meeting",
    "participants": "AO, AK, DK, CN, JS, GV, JB, RE, SM",
}

ENTRY_TYPES = ["T", "D", "I", "Part.", "A"]
STATUSES = ["done", "i/w", "open"]

CATEGORIES = [
    "(1) Strategie / Planung",
    "(2) Operative Steuerung",
    "Strategie-WS",
    "Kunde / Vertrieb",
    "HR / Personal",
    "Interne Prozesse / Organisation",
    "Finanzen",
]

FOCUS_TOPICS = [
    "Interne Prozesse / Organisation",
    "Kunde / Vertrieb",
    "Finanzen / Monatsabschluss",
    "HR / Mitarbeiter",
    "ohne",
    "entfällt",
]

TEAM_MEMBERS = ["AO", "CN", "DK", "JS", "GV", "JB", "SM", "RE", "AK"]
LOCATIONS = ["FB", "Böblingen"]

# Schulferien Baden-Württemberg (Landesferien, gilt auch für Rems-Murr-Kreis)
# Labels wie in der Excel-Vorlage: Weihnachtsferien -> Weihnachten, Sommerferien -> Sommer, ...
SCHOOL_HOLIDAY_PERIODS: list[tuple[str, date, date]] = [
    ("Weihnachten", date(2025, 12, 22), date(2026, 1, 5)),
    ("Fasching", date(2026, 2, 16), date(2026, 2, 20)),
    ("Ostern", date(2026, 3, 30), date(2026, 4, 11)),
    ("Pfingsten", date(2026, 5, 26), date(2026, 6, 5)),
    ("Sommer", date(2026, 7, 30), date(2026, 9, 12)),
    ("Herbst", date(2026, 10, 26), date(2026, 10, 31)),
    ("Weihnachten", date(2026, 12, 23), date(2027, 1, 9)),
    ("Ostern", date(2027, 3, 25), date(2027, 4, 3)),
    ("Pfingsten", date(2027, 5, 18), date(2027, 5, 29)),
    ("Sommer", date(2027, 7, 29), date(2027, 9, 11)),
    ("Herbst", date(2027, 11, 2), date(2027, 11, 6)),
    ("Weihnachten", date(2027, 12, 23), date(2028, 1, 8)),
]

SCHOOL_HOLIDAY_LABELS = ["Weihnachten", "Fasching", "Ostern", "Pfingsten", "Sommer", "Herbst"]
