# Analyse: 000_ReKo_Digital_Future_V02.xlsm

Quelle: `000_ReKo_Digital_Future_V02.xlsm` (SharePoint-Vorlage ReKo Digital Future)

Hinweis: Das Sheet heißt in der Vorlage **Jahresdetail-Plan** (nicht „Jahres-Dateiplan“).

## Sheets in der Vorlage

| Sheet | Übernahme |
|-------|-----------|
| **Minutes** | Ja – Kernfunktion |
| **Jahresdetail-Plan** | Ja – Jahresplanung |
| Urlaubsübersicht | Nein (Abwesenheiten im Jahresplan derzeit manuell / später) |
| Parameter | Teilweise – Lookup-Werte (Kategorien, Team) |
| Parameter_Kal | Teilweise – Schulferien für `istferien()` |
| Standard-Agenda, Fach-Topic-List, Kandidatenliste | Später |

---

## Sheet: Minutes

### Kopfbereich (Zeile 1–3)

| Zelle | Inhalt |
|-------|--------|
| A1 | „Project:“ |
| C1 | Projektname (z. B. „Digital Future Reko Führungsteam“) |
| D1/E1/F1 | Team, Meeting-Rhythmus, Teilnehmerkürzel |
| H1 | `=TODAY()` |
| Zeile 3 | Spaltenüberschriften |

### Spalten

| Spalte | Feld | Validierung / Hinweis |
|--------|------|---------------------|
| A | # | Laufende Nummer |
| B | Typ | `T`, `D`, `I`, `Part.`, `A` |
| C | Inhalt | Task / Decision / Information / Agenda / Teilnehmer |
| D | responsible | Verantwortlich |
| E | along with | Mitverantwortlich |
| F | since when | Datum |
| G | until when | Datum (Meeting-Datum bei `Part.`) |
| H | remarks | Bemerkungen |
| I | category | Dropdown `_kategorie` |
| J | Status | `done`, `i/w`, `open` |
| K–M | Links | Referenzen |

### Zeilentypen

- **Part.** – Meeting-Abschnitt (Teilnehmer in C, Datum in G)
- **A** – Agenda-Punkt
- **T** – Task (mit Verantwortlichem, Fristen, Status)
- **D** – Decision
- **I** – Information

### VBA-Buttons (Modul `Protokoll_Tool`)

| Button | Funktion |
|--------|----------|
| CB_Neue_Meeting | Neues Meeting (`Part.`) |
| CB_Neuer_Task | Neue Task-Zeile (`T`) |
| CB_Neue_Decision | Neue Decision (`D`) |
| CB_Neue_Information | Neue Information (`I`) |
| CB_Neue_AgendaPunkt | Neuer Agenda-Punkt (`A`) |
| CB_Offene_Aufgaben | Filter: offene Tasks |
| CB_NormalansichtAnzeigen | Alle Zeilen anzeigen |
| CB_Today | Heute markieren / springen |

### Weitere Excel-Features

- AutoFilter auf Datenbereich
- Druckbereich A1:J186, Wiederholungszeile 3
- Datums- und Listenvalidierung

---

## Sheet: Jahresdetail-Plan

Wöchentlicher Plan (Dienstag-Meetings) für ein Jahr.

### Spalten

| Spalte | Feld | Hinweis |
|--------|------|---------|
| A | Wochentag | „Dienstag“ |
| B | Datum | Wochentermine (+7-Tage-Logik) |
| C | Schulferien | `=istferien(B)` – aus Parameter_Kal |
| D | Schwerpunktsthema | Rotierende Themen (Kategorien) |
| E | Fach-Topic / Mitarbeiter | Optionales Detailthema |
| F | Ort | FB, Böblingen, … |
| G–O | Team-Kürzel | Abwesenheit mit „X“ (AO, CN, DK, JS, GV, JB, SM, RE, AK) |

In Excel werden G–O per Formel aus **Urlaubsübersicht** befüllt. Im Web-Tool sind sie editierbar; automatische Übernahme folgt später.

### VBA (Modul `Kalender_Tools`)

- `istferien(datum)` – prüft Schulferienzeiträume aus Parameter_Kal

---

## Parameter-Lookups

**Kategorien** (Parameter!A2:A15): Strategie, Operative Steuerung, Strategie-WS, Kunde/Vertrieb, HR, Interne Prozesse, Finanzen, …

**Status**: `done`, `i/w`, `open`

**Team** (Jahresdetail-Plan): AO, CN, DK, JS, GV, JB, SM, RE, AK
