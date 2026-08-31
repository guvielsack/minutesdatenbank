from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_admin_user
from app.database import get_db
from app.models import AppUser
from app.schemas_auth import UserCreate, UserOut, UserUpdate
from app.services.user_service import create_user, list_users, update_user

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


@router.get("", response_model=list[UserOut])
def get_users(
    _: AppUser = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> list[AppUser]:
    return list_users(db)


@router.post("", response_model=UserOut)
def add_user(
    payload: UserCreate,
    _: AppUser = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> AppUser:
    try:
        return create_user(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(
    user_id: int,
    payload: UserUpdate,
    admin: AppUser = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> AppUser:
    if user_id == admin.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Eigenes Konto kann nicht deaktiviert werden")
    try:
        user = update_user(db, user_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if user is None:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    return user
