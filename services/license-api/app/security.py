import hashlib
import secrets


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify_secret(value: str, expected_hash: str) -> bool:
    return secrets.compare_digest(hash_secret(value), expected_hash)


def generate_license_key() -> str:
    return f"RA-{secrets.token_urlsafe(24)}"


def generate_license_id() -> str:
    return f"lic_{secrets.token_hex(12)}"
