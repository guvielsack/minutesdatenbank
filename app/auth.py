from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AppUser
from app.permissions import can_admin, can_write
from app.services.user_service import authenticate, get_user_by_id


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> AppUser | None:
    user_id = request.session.get("user_id")
    if user_id is None:
        return None
    user = get_user_by_id(db, int(user_id))
    if user is None or not user.is_active:
        request.session.clear()
        return None
    return user


def require_authenticated_user(
    request: Request,
    db: Session = Depends(get_db),
) -> AppUser:
    user = get_optional_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")
    return user


def require_write_user(user: AppUser = Depends(require_authenticated_user)) -> AppUser:
    if not can_write(user.role):
        raise HTTPException(status_code=403, detail="Keine Schreibberechtigung")
    return user


def require_admin_user(user: AppUser = Depends(require_authenticated_user)) -> AppUser:
    if not can_admin(user.role):
        raise HTTPException(status_code=403, detail="Keine Admin-Berechtigung")
    return user


def login_user(request: Request, db: Session, username: str, password: str) -> AppUser:
    user = authenticate(db, username, password)
    if user is None:
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort ungültig")
    request.session["user_id"] = user.id
    return user


def logout_user(request: Request) -> None:
    request.session.clear()
