# Deploy auf Ubuntu-Server (Docker)

Getrennt von **kundendatenbank** (eigener Container, Port, Volume, Pfad).

| | minutesdatenbank | kundendatenbank |
|---|---|---|
| Port | **8002** | 8000 |
| Pfad | `~/apps/minutesdatenbank` | `~/apps/kundendatenbank` |
| Container | `minutesdatenbank` | `kundendatenbank` |

## Voraussetzungen

- VPN/Firmennetz zum Server `172.24.4.13`
- Docker + Compose auf dem Server (bereits vorhanden, wenn kundendatenbank läuft)
- SSH-Zugang als `gvielsack`
- GitHub-Repo: `https://github.com/guvielsack/minutesdatenbank.git`

## Erst-Deploy (automatisch)

Doppelklick auf **`Deploy_Server.bat`** (Windows) oder:

```powershell
.\scripts\deploy.ps1 -IdentityFile "C:\Users\guido.vielsack\.ssh\id_ed25519_kundendatenbank"
```

Das Skript:

1. pusht den aktuellen Branch nach GitHub
2. klont das Repo auf dem Server (falls noch nicht vorhanden)
3. baut und startet den Container

App-URL: **http://172.24.4.13:8002/**

## Erst-Deploy (manuell auf dem Server)

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/guvielsack/minutesdatenbank.git
cd minutesdatenbank
docker compose up -d --build
docker compose ps
```

## Updates

Nach lokalem Commit:

```powershell
.\scripts\deploy.ps1 -IdentityFile "C:\Users\guido.vielsack\.ssh\id_ed25519_kundendatenbank"
```

Oder auf dem Server:

```bash
cd ~/apps/minutesdatenbank
git pull
docker compose up -d --build
```

## Datenbank / Erstbefüllung

Die SQLite-DB liegt im Docker-Volume `minutesdatenbank_data` unter `/data/minutesdatenbank.db`.

**Empfohlen:** Nach dem ersten Start in der Web-Oberfläche **Excel importieren…** verwenden (Sheets *Minutes*, optional *Jahresdetail-Plan*).

## Backup (manuell)

```bash
cd ~/apps/minutesdatenbank
docker compose exec -T minutesdatenbank python -c "import sqlite3; src=sqlite3.connect('/data/minutesdatenbank.db'); dst=sqlite3.connect('/data/backup.sqlite'); src.backup(dst); print('ok')"
docker cp minutesdatenbank:/data/backup.sqlite ./backup.sqlite
```

## Logs

```bash
cd ~/apps/minutesdatenbank
docker compose logs -f
```
