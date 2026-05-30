from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class FleetGuildJoinRequest(BaseModel):
    guildId: str
    guildName: str = ""
    botInstanceId: str
    activeGuildCount: int | None = None
    activeGuildLimit: int | None = None
    inviteUrl: str = ""


class ActivateLicenseRequest(BaseModel):
    guildId: str
    guildName: str = ""
    licenseKey: str
    botInstanceId: str
    activeGuildCount: int | None = None
    activeGuildLimit: int | None = None
    inviteUrl: str = ""


class DeactivateLicenseRequest(BaseModel):
    guildId: str
    botInstanceId: str


class HeartbeatRequest(BaseModel):
    botInstanceId: str
    activeGuildCount: int = 0
    activeGuildLimit: int = 20
    inviteUrl: str = ""
    status: str = "active"
    timestamp: datetime | None = None


class AdminInstanceRequest(BaseModel):
    instanceId: str
    instanceToken: str
    inviteUrl: str = ""
    activeGuildLimit: int = 20
    status: str = "active"


class AdminCreateLicenseRequest(BaseModel):
    plan: str = "basic"
    maxGuilds: int = 1
    featureFlags: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)
    expiresAt: datetime | None = None
    note: str = ""


class AdminRevokeLicenseRequest(BaseModel):
    reason: str = ""
