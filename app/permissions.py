ROLE_ADMIN = "admin"
ROLE_PROTOKOLLANT = "protokollant"
ROLE_JEDER = "jeder"

ROLES = (ROLE_ADMIN, ROLE_PROTOKOLLANT)


def is_valid_role(role: str) -> bool:
    return role in ROLES


def can_read(_role: str | None = None) -> bool:
    return True


def can_write(role: str | None) -> bool:
    return role in (ROLE_ADMIN, ROLE_PROTOKOLLANT)


def can_admin(role: str | None) -> bool:
    return role == ROLE_ADMIN
