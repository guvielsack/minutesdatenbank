# minutesdatenbank

Lokales Projektgrundgerüst für die Minutes-Datenbank.

## Struktur

```
minutesdatenbank/
├── app/              # Anwendungscode
├── docs/             # Dokumentation
├── .gitignore
├── README.md
└── requirements.txt
```

## Start

Doppelklick oder in der Konsole:

```bat
start-minutes-tool.bat
```

Alternativ per PowerShell:

```powershell
.\start-minutes-tool.ps1
```

Das Skript richtet bei Bedarf `.venv` ein, installiert Abhängigkeiten und öffnet http://127.0.0.1:8002

## Manuelles Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8002
```

## Funktionen (Stand MVP)

- **Minutes**: Excel-ähnliche Tabelle mit Typen `T`, `D`, `I`, `Part.`, `A`
- **Jahresdetail-Plan**: Wochenplan mit Schwerpunktsthemen, Ort und Abwesenheitsmarkern
- Toolbar-Buttons wie in der Excel-Vorlage (Meeting, Task, Decision, …)
- Import aus `000_ReKo_Digital_Future_V02.xlsm`

Details zur Vorlage: [docs/vorlage-analyse.md](docs/vorlage-analyse.md)
