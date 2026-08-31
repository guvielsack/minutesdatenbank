"""Admin anlegen oder Passwort zurücksetzen (lokal oder im Docker-Container)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import func, select

from app.config import INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_USERNAME  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import AppUser  # noqa: E402
from app.permissions import ROLE_ADMIN  # noqa: E402
from app.services.user_service import (  # noqa: E402
    get_user_by_username,
    hash_password,
    seed_initial_admin,
    verify_password,
)


def main() -> None:
    password = (
        os.getenv("INITIAL_ADMIN_PASSWORD", INITIAL_ADMIN_PASSWORD or "change-me-on-first-deploy") or ""
    ).strip()
    username = (os.getenv("INITIAL_ADMIN_USERNAME", INITIAL_ADMIN_USERNAME or "admin") or "admin").strip()
    if len(password) < 8:
        print("Passwort muss mindestens 8 Zeichen haben.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        user = get_user_by_username(db, username)
        if user is None:
            count = db.execute(select(func.count()).select_from(AppUser)).scalar_one()
            if count and int(count) > 0:
                user = AppUser(
                    username=username,
                    password_hash=hash_password(password.strip()),
                    role=ROLE_ADMIN,
                    is_active=True,
                )
                db.add(user)
                db.commit()
                db.refresh(user)
                print(f"Admin '{username}' angelegt (weitere Benutzer existieren bereits).")
            else:
                seed_initial_admin(db, username=username, password=password)
                user = get_user_by_username(db, username)
                if user is None:
                    print("Admin konnte nicht angelegt werden.", file=sys.stderr)
                    sys.exit(1)
                print(f"Admin '{username}' angelegt.")
        else:
            user.password_hash = hash_password(password)
            user.role = ROLE_ADMIN
            user.is_active = True
            db.commit()
            print(f"Passwort für '{username}' zurückgesetzt.")
        ok = verify_password(password, user.password_hash)
        if not ok:
            print("Interner Fehler: Passwort konnte nicht gesetzt werden.", file=sys.stderr)
            sys.exit(1)
        print(f"Anmeldung: {username} / {password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
