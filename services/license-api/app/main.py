from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated

import uvicorn
from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session

from .database import get_db
from .models import GuildLicense, GuildProxyAssignment, LicenseKey, RustplusProxy
from .schema_management import ensure_schema
from .schemas import (
    ActivateRequest,
    GeneratedKey,
    GenerateKeysRequest,
    GuildLicenseUpdate,
    LicenseResponse,
    ProxyAssignmentRequest,
    ProxyUpsert,
)
from .security import generate_raw_key, hash_key_secret, require_admin_token, require_bot_token
from .service import activate_key, license_response


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    ensure_schema()
    yield


app = FastAPI(title="RustAssist License API", version="0.1.0", lifespan=lifespan)
DbSession = Annotated[Session, Depends(get_db)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/bot/guilds/{guild_id}/validate",
    response_model=LicenseResponse,
    dependencies=[Depends(require_bot_token)],
)
def validate_guild(guild_id: str, db: DbSession) -> LicenseResponse:
    return license_response(db, guild_id)


@app.post(
    "/bot/guilds/{guild_id}/activate",
    response_model=LicenseResponse,
    dependencies=[Depends(require_bot_token)],
)
def activate_guild(
    guild_id: str,
    payload: ActivateRequest,
    db: DbSession,
) -> LicenseResponse:
    return activate_key(db, guild_id, payload.key, payload.activatedBy)


@app.get(
    "/bot/guilds/{guild_id}/features",
    response_model=LicenseResponse,
    dependencies=[Depends(require_bot_token)],
)
def guild_features(guild_id: str, db: DbSession) -> LicenseResponse:
    return license_response(db, guild_id)


@app.post(
    "/admin/keys",
    response_model=list[GeneratedKey],
    dependencies=[Depends(require_admin_token)],
)
def generate_keys(payload: GenerateKeysRequest, db: DbSession) -> list[GeneratedKey]:
    generated = []
    for _ in range(payload.count):
        prefix, secret, raw_key = generate_raw_key()
        db.add(
            LicenseKey(
                key_prefix=prefix,
                key_hash=hash_key_secret(secret),
                plan=payload.plan,
                duration_days=payload.durationDays,
                duration_seconds=payload.durationSeconds or payload.durationDays * 86400,
                max_uses=payload.maxUses,
                note=payload.note,
            )
        )
        generated.append(
            GeneratedKey(
                key=raw_key,
                prefix=prefix,
                plan=payload.plan,
                durationDays=payload.durationDays,
                durationSeconds=payload.durationSeconds or payload.durationDays * 86400,
                maxUses=payload.maxUses,
            )
        )
    db.commit()
    return generated


@app.get("/admin/keys", dependencies=[Depends(require_admin_token)])
def list_keys(db: DbSession) -> list[dict]:
    keys = db.query(LicenseKey).order_by(LicenseKey.created_at.desc()).all()
    return [
        {
            "prefix": key.key_prefix,
            "plan": key.plan,
            "durationDays": key.duration_days,
            "durationSeconds": key.duration_seconds or key.duration_days * 86400,
            "maxUses": key.max_uses,
            "usedCount": key.used_count,
            "status": key.status,
            "note": key.note,
            "createdAt": key.created_at,
            "revokedAt": key.revoked_at,
        }
        for key in keys
    ]


@app.post("/admin/keys/{key_prefix}/revoke", dependencies=[Depends(require_admin_token)])
def revoke_key(key_prefix: str, db: DbSession) -> dict[str, str]:
    key = db.query(LicenseKey).filter_by(key_prefix=key_prefix.upper()).one()
    key.status = "revoked"
    key.revoked_at = datetime.utcnow()
    db.commit()
    return {"status": "revoked"}


@app.get("/admin/guilds", dependencies=[Depends(require_admin_token)])
def list_guilds(db: DbSession) -> list[dict]:
    guilds = db.query(GuildLicense).order_by(GuildLicense.updated_at.desc()).all()
    return [
        {
            "guildId": guild.guild_id,
            "plan": guild.plan,
            "status": guild.status,
            "expiresAt": guild.expires_at,
            "suspendedReason": guild.suspended_reason,
            "updatedAt": guild.updated_at,
        }
        for guild in guilds
    ]


@app.patch(
    "/admin/guilds/{guild_id}",
    response_model=LicenseResponse,
    dependencies=[Depends(require_admin_token)],
)
def update_guild_license(
    guild_id: str,
    payload: GuildLicenseUpdate,
    db: DbSession,
) -> LicenseResponse:
    guild = db.query(GuildLicense).filter_by(guild_id=guild_id).one_or_none()
    if not guild:
        guild = GuildLicense(guild_id=guild_id)
        db.add(guild)
    if payload.status is not None:
        guild.status = payload.status
    if payload.plan is not None:
        guild.plan = payload.plan
    if payload.expiresAt is not None:
        guild.expires_at = payload.expiresAt
    if payload.suspendedReason is not None:
        guild.suspended_reason = payload.suspendedReason
    guild.updated_at = datetime.utcnow()
    db.commit()
    return license_response(db, guild_id)


@app.post("/admin/proxies", dependencies=[Depends(require_admin_token)])
def upsert_proxy(payload: ProxyUpsert, db: DbSession) -> dict[str, str]:
    proxy = db.query(RustplusProxy).filter_by(proxy_id=payload.proxyId).one_or_none()
    if not proxy:
        proxy = RustplusProxy(proxy_id=payload.proxyId, name=payload.name, base_url=payload.baseUrl)
        db.add(proxy)
    proxy.name = payload.name
    proxy.base_url = payload.baseUrl
    proxy.status = payload.status
    proxy.capacity = payload.capacity
    proxy.active_guild_count = payload.activeGuildCount
    proxy.region = payload.region
    proxy.version = payload.version
    proxy.enabled = payload.enabled
    db.commit()
    return {"status": "saved"}


@app.get("/admin/proxies", dependencies=[Depends(require_admin_token)])
def list_proxies(db: DbSession) -> list[dict]:
    proxies = db.query(RustplusProxy).order_by(RustplusProxy.proxy_id.asc()).all()
    return [
        {
            "proxyId": proxy.proxy_id,
            "name": proxy.name,
            "baseUrl": proxy.base_url,
            "status": proxy.status,
            "capacity": proxy.capacity,
            "activeGuildCount": proxy.active_guild_count,
            "region": proxy.region,
            "version": proxy.version,
            "enabled": proxy.enabled,
            "lastHeartbeatAt": proxy.last_heartbeat_at,
        }
        for proxy in proxies
    ]


@app.post(
    "/admin/guilds/{guild_id}/proxy-assignment",
    response_model=LicenseResponse,
    dependencies=[Depends(require_admin_token)],
)
def assign_proxy(
    guild_id: str,
    payload: ProxyAssignmentRequest,
    db: DbSession,
) -> LicenseResponse:
    assignment = db.query(GuildProxyAssignment).filter_by(guild_id=guild_id).one_or_none()
    if not assignment:
        assignment = GuildProxyAssignment(guild_id=guild_id)
        db.add(assignment)
    assignment.assigned_backend = payload.assignedBackend
    assignment.assigned_proxy_id = payload.assignedProxyId
    assignment.updated_at = datetime.utcnow()
    db.commit()
    return license_response(db, guild_id)


def run() -> None:
    uvicorn.run("app.main:app", host="0.0.0.0", port=8088, reload=False)
