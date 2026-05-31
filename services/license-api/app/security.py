import hashlib
import hmac
import secrets
import string

from fastapi import Header, HTTPException, status

from .config import get_settings

KEY_ALPHABET = string.ascii_uppercase + string.digits


def require_token(expected: str, authorization: str | None) -> None:
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API token is not configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid bearer token")


def require_bot_token(authorization: str | None = Header(default=None)) -> None:
    require_token(get_settings().bot_api_token, authorization)


def require_admin_token(authorization: str | None = Header(default=None)) -> None:
    require_token(get_settings().admin_api_token, authorization)


def generate_raw_key() -> tuple[str, str, str]:
    prefix = "".join(secrets.choice(KEY_ALPHABET) for _ in range(8))
    secret = "".join(secrets.choice(KEY_ALPHABET) for _ in range(24))
    return prefix, secret, f"RA-{prefix}-{secret}"


def hash_key_secret(secret: str) -> str:
    digest = hmac.new(
        get_settings().key_hash_secret.encode("utf-8"),
        secret.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"hmac-sha256:{digest}"


def verify_key_secret(secret: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_key_secret(secret), stored_hash)


def parse_raw_key(raw_key: str) -> tuple[str, str]:
    parts = raw_key.strip().upper().split("-")
    if len(parts) != 3 or parts[0] not in {"RA", "RPP"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid key format")
    return parts[1], parts[2]
