from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_optional_user, login_user, logout_user, require_authenticated_user
from app.database import get_db
from app.models import AppUser
from app.permissions import ROLE_JEDER, can_admin, can_write
from app.schemas_auth import AuthStateOut, LoginRequest, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def auth_state_for_user(user: AppUser | None) -> AuthStateOut:
    if user is None:
        return AuthStateOut(
            authenticated=False,
            username=None,
            role=ROLE_JEDER,
            can_read=True,
            can_write=False,
            can_admin=False,
        )
    return AuthStateOut(
        authenticated=True,
        username=user.username,
        role=user.role,
        can_read=True,
        can_write=can_write(user.role),
        can_admin=can_admin(user.role),
    )


@router.get("/me", response_model=AuthStateOut)
def get_auth_state(user: AppUser | None = Depends(get_optional_user)) -> AuthStateOut:
    return auth_state_for_user(user)


@router.post("/login", response_model=AuthStateOut)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> AuthStateOut:
    user = login_user(request, db, payload.username, payload.password)
    return auth_state_for_user(user)


@router.post("/logout", response_model=AuthStateOut)
def logout(request: Request) -> AuthStateOut:
    logout_user(request)
    return auth_state_for_user(None)
