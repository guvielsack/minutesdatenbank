from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthStateOut(BaseModel):
    authenticated: bool
    username: str | None = None
    role: str
    can_read: bool = True
    can_write: bool = False
    can_admin: bool = False


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=8, max_length=512)
    role: Literal["protokollant", "admin"] = "protokollant"
    is_active: bool = True


class UserUpdate(BaseModel):
    role: Literal["protokollant", "admin"] | None = None
    is_active: bool | None = None
    password: str | None = None
