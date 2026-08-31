import logging

import bcrypt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AppUser
from app.permissions import ROLE_ADMIN, is_valid_role
from app.schemas_auth import UserCreate, UserUpdate

logger = logging.getLogger(__name__)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def get_user_by_id(db: Session, user_id: int) -> AppUser | None:
    return db.get(AppUser, user_id)


def get_user_by_username(db: Session, username: str) -> AppUser | None:
    name = (username or "").strip()
    if not name:
        return None
    stmt = select(AppUser).where(func.lower(AppUser.username) == name.lower())
    return db.scalars(stmt).first()


def list_users(db: Session) -> list[AppUser]:
    stmt = select(AppUser).order_by(AppUser.username.asc())
    return list(db.scalars(stmt).all())


def authenticate(db: Session, username: str, password: str) -> AppUser | None:
    user = get_user_by_username(db, username)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user(db: Session, data: UserCreate) -> AppUser:
    if not is_valid_role(data.role):
        raise ValueError("Ungültige Rolle")
    if get_user_by_username(db, data.username) is not None:
        raise ValueError("Benutzername ist bereits vergeben")
    password = (data.password or "").strip()
    if len(password) < 8:
        raise ValueError("Passwort: mindestens 8 Zeichen")

    row = AppUser(
        username=data.username.strip(),
        password_hash=hash_password(password),
        role=data.role,
        is_active=data.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_user(db: Session, user_id: int, data: UserUpdate) -> AppUser | None:
    row = db.get(AppUser, user_id)
    if row is None:
        return None
    if data.role is not None:
        if not is_valid_role(data.role):
            raise ValueError("Ungültige Rolle")
        row.role = data.role
    if data.is_active is not None:
        row.is_active = data.is_active
    if data.password and data.password.strip():
        if len(data.password.strip()) < 8:
            raise ValueError("Passwort: mindestens 8 Zeichen")
        row.password_hash = hash_password(data.password.strip())
    db.commit()
    db.refresh(row)
    return row


def seed_initial_admin(db: Session, *, username: str, password: str | None) -> None:
    count = db.execute(select(func.count()).select_from(AppUser)).scalar_one()
    if count and int(count) > 0:
        return
    if not password or not password.strip():
        logger.warning(
            "Kein App-Nutzer vorhanden — INITIAL_ADMIN_PASSWORD setzen, um den ersten Admin anzulegen."
        )
        return
    name = (username or "admin").strip() or "admin"
    db.add(
        AppUser(
            username=name,
            password_hash=hash_password(password.strip()),
            role=ROLE_ADMIN,
            is_active=True,
        )
    )
    db.commit()
    logger.info("Initial-Admin '%s' angelegt.", name)
