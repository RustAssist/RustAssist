from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_serializer, field_validator


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _as_utc_storage(value: datetime) -> datetime:
    return _as_utc(value).replace(tzinfo=None)


def _format_utc(value: datetime) -> str:
    return _as_utc(value).isoformat().replace("+00:00", "Z")


class LicenseResponse(BaseModel):
    status: str
    plan: str
    featureFlags: dict[str, bool]
    limits: dict[str, int]
    expiresAt: datetime | None = None
    assignedRustplusBackend: str = "local"
    assignedRustplusProxyId: str | None = None
    proxyUrl: str | None = None

    @field_serializer("expiresAt")
    def serialize_expires_at(self, expires_at: datetime | None) -> str | None:
        if expires_at is None:
            return None
        return _format_utc(expires_at)


class ActivateRequest(BaseModel):
    key: str
    activatedBy: str | None = None


class GenerateKeysRequest(BaseModel):
    plan: str = "pro"
    durationDays: int = Field(default=30, ge=1)
    durationSeconds: int | None = Field(default=None, ge=60)
    count: int = Field(default=1, ge=1, le=100)
    maxUses: int = Field(default=1, ge=1)
    note: str | None = None


class GeneratedKey(BaseModel):
    key: str
    prefix: str
    plan: str
    durationDays: int
    durationSeconds: int
    maxUses: int


class ProxyUpsert(BaseModel):
    proxyId: str
    name: str
    baseUrl: str
    status: str = "online"
    capacity: int = 0
    activeGuildCount: int = 0
    region: str | None = None
    version: str | None = None
    enabled: bool = True


class ProxyAssignmentRequest(BaseModel):
    assignedBackend: str = "local"
    assignedProxyId: str | None = None


class GuildLicenseUpdate(BaseModel):
    status: str | None = None
    plan: str | None = None
    expiresAt: datetime | None = None
    suspendedReason: str | None = None

    @field_validator("expiresAt")
    @classmethod
    def validate_expires_at(cls, expires_at: datetime | None) -> datetime | None:
        if expires_at is None:
            return None
        return _as_utc_storage(expires_at)
