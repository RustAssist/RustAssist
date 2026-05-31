from datetime import datetime

from pydantic import BaseModel, Field


class LicenseResponse(BaseModel):
    status: str
    plan: str
    featureFlags: dict[str, bool]
    limits: dict[str, int]
    expiresAt: datetime | None = None
    assignedRustplusBackend: str = "local"
    assignedRustplusProxyId: str | None = None
    proxyUrl: str | None = None


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
