from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db
from .models import BotInstance, GuildAssignment, License, utcnow
from .schemas import (
    ActivateLicenseRequest,
    AdminCreateLicenseRequest,
    AdminInstanceRequest,
    AdminRevokeLicenseRequest,
    DeactivateLicenseRequest,
    FleetGuildJoinRequest,
    HeartbeatRequest,
)
from .security import generate_license_id, generate_license_key, hash_secret, verify_secret


app = FastAPI(title="RustAssist License API", version="0.1.0")


def normalize_auth_header(value: str | None) -> str:
    if not value:
        return ""
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return value.strip()


def serialize_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def is_license_current(license_row: License | None) -> bool:
    if not license_row or license_row.status != "active":
        return False
    expires_at = license_row.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at <= utcnow():
        return False
    return True


def license_payload(assignment: GuildAssignment, license_row: License) -> dict:
    status_value = "active" if is_license_current(license_row) and assignment.status == "active" else license_row.status
    return {
        "status": status_value,
        "licenseId": license_row.license_id,
        "assignedBotInstanceId": assignment.assigned_bot_instance_id,
        "plan": license_row.plan,
        "featureFlags": license_row.feature_flags or {},
        "limits": license_row.limits or {},
        "expiresAt": serialize_dt(license_row.expires_at),
    }


def response_for_assignment(db: Session, assignment: GuildAssignment, action: str = "licensed") -> dict:
    instance = get_instance_by_id(db, assignment.assigned_bot_instance_id)
    if not assignment.license or not is_license_current(assignment.license) or assignment.status != "active":
        return {
            "action": "unlicensed",
            "assignedBotInstanceId": assignment.assigned_bot_instance_id,
            "inviteUrl": instance.invite_url if instance else "",
            "message": "This guild is assigned but not licensed yet.",
        }

    return {
        "action": action,
        "license": license_payload(assignment, assignment.license),
        "assignedBotInstanceId": assignment.assigned_bot_instance_id,
        "inviteUrl": instance.invite_url if instance else "",
    }


def get_admin_token(x_admin_token: Annotated[str | None, Header()] = None) -> str:
    if not settings.admin_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin API is disabled.")
    if not x_admin_token or x_admin_token != settings.admin_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token.")
    return x_admin_token


def get_instance_by_id(db: Session, instance_id: str) -> BotInstance | None:
    return db.scalar(select(BotInstance).where(BotInstance.instance_id == instance_id))


def get_bot_instance(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> BotInstance:
    token = normalize_auth_header(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing instance token.")

    instance_id = None
    try:
        body = request._json if hasattr(request, "_json") else None
    except Exception:
        body = None
    if isinstance(body, dict):
        instance_id = body.get("botInstanceId")

    if not instance_id:
        instance_id = request.query_params.get("botInstanceId")

    if not instance_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="botInstanceId is required.")

    instance = get_instance_by_id(db, instance_id)
    if not instance or not verify_secret(token, instance.token_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid instance token.")
    return instance


async def get_bot_instance_from_body(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> BotInstance:
    try:
        request._json = await request.json()
    except Exception:
        request._json = None
    return get_bot_instance(request, db, authorization)


def active_guild_count(db: Session, instance_id: str) -> int:
    return db.scalar(
        select(func.count(GuildAssignment.id)).where(
            GuildAssignment.assigned_bot_instance_id == instance_id,
            GuildAssignment.status == "active",
            GuildAssignment.license_id.is_not(None),
        )
    ) or 0


def choose_available_instance(db: Session) -> BotInstance | None:
    instances = db.scalars(select(BotInstance).where(BotInstance.status == "active")).all()
    available = [
        instance for instance in instances
        if active_guild_count(db, instance.instance_id) < instance.active_guild_limit
    ]
    return sorted(available, key=lambda item: active_guild_count(db, item.instance_id))[0] if available else None


def ensure_bootstrap_instance(db: Session) -> None:
    if not settings.bootstrap_instance_token:
        return

    instance = get_instance_by_id(db, settings.bootstrap_instance_id)
    if not instance:
        instance = BotInstance(
            instance_id=settings.bootstrap_instance_id,
            token_hash=hash_secret(settings.bootstrap_instance_token),
            invite_url=settings.bootstrap_invite_url,
            active_guild_limit=settings.bootstrap_active_guild_limit,
            status="active",
        )
        db.add(instance)
    else:
        instance.token_hash = hash_secret(settings.bootstrap_instance_token)
        instance.invite_url = settings.bootstrap_invite_url or instance.invite_url
        instance.active_guild_limit = settings.bootstrap_active_guild_limit
    db.commit()


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    try:
        ensure_bootstrap_instance(db)
    finally:
        db.close()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/fleet/guild-join")
def guild_join(
    payload: FleetGuildJoinRequest,
    db: Annotated[Session, Depends(get_db)],
    instance: Annotated[BotInstance, Depends(get_bot_instance_from_body)],
) -> dict:
    if payload.botInstanceId != instance.instance_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token does not match botInstanceId.")

    instance.invite_url = payload.inviteUrl or instance.invite_url
    if payload.activeGuildLimit:
        instance.active_guild_limit = payload.activeGuildLimit
    instance.last_heartbeat_at = utcnow()
    instance.active_guild_count = active_guild_count(db, instance.instance_id)

    assignment = db.scalar(select(GuildAssignment).where(GuildAssignment.guild_id == payload.guildId))
    if assignment:
        assignment.last_seen_at = utcnow()
        assignment.guild_name = payload.guildName or assignment.guild_name
        if assignment.assigned_bot_instance_id != instance.instance_id:
            correct = get_instance_by_id(db, assignment.assigned_bot_instance_id)
            db.commit()
            return {
                "action": "wrong_instance",
                "assignedBotInstanceId": assignment.assigned_bot_instance_id,
                "inviteUrl": correct.invite_url if correct else "",
                "message": "This Discord server is assigned to another RustAssist instance.",
            }

        db.commit()
        return response_for_assignment(db, assignment, "accepted")

    if instance.status != "active":
        alternate = choose_available_instance(db)
        return {
            "action": "capacity_full" if alternate else "no_capacity",
            "inviteUrl": alternate.invite_url if alternate else "",
            "message": "This RustAssist instance is not accepting new guilds.",
        }

    assignment = GuildAssignment(
        guild_id=payload.guildId,
        guild_name=payload.guildName,
        assigned_bot_instance_id=instance.instance_id,
        status="activation_only",
    )
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(GuildAssignment).where(GuildAssignment.guild_id == payload.guildId))
        if existing and existing.assigned_bot_instance_id != instance.instance_id:
            correct = get_instance_by_id(db, existing.assigned_bot_instance_id)
            return {
                "action": "wrong_instance",
                "assignedBotInstanceId": existing.assigned_bot_instance_id,
                "inviteUrl": correct.invite_url if correct else "",
                "message": "This Discord server is assigned to another RustAssist instance.",
            }
        raise

    return {
        "action": "accepted",
        "assignedBotInstanceId": instance.instance_id,
        "message": "Guild accepted in activation-only mode.",
    }


@app.get("/licenses/guild/{guild_id}")
def get_guild_license(
    guild_id: str,
    botInstanceId: str,
    db: Annotated[Session, Depends(get_db)],
    instance: Annotated[BotInstance, Depends(get_bot_instance)],
) -> dict:
    if botInstanceId != instance.instance_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token does not match botInstanceId.")

    assignment = db.scalar(select(GuildAssignment).where(GuildAssignment.guild_id == guild_id))
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guild is not assigned.")

    if assignment.assigned_bot_instance_id != instance.instance_id:
        correct = get_instance_by_id(db, assignment.assigned_bot_instance_id)
        return {
            "action": "wrong_instance",
            "assignedBotInstanceId": assignment.assigned_bot_instance_id,
            "inviteUrl": correct.invite_url if correct else "",
            "message": "This Discord server is assigned to another RustAssist instance.",
        }

    if not assignment.license:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guild is not licensed.")

    return response_for_assignment(db, assignment)


@app.post("/licenses/activate")
def activate_license(
    payload: ActivateLicenseRequest,
    db: Annotated[Session, Depends(get_db)],
    instance: Annotated[BotInstance, Depends(get_bot_instance_from_body)],
) -> dict:
    if payload.botInstanceId != instance.instance_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token does not match botInstanceId.")

    assignment = db.scalar(select(GuildAssignment).where(GuildAssignment.guild_id == payload.guildId))
    if assignment and assignment.assigned_bot_instance_id != instance.instance_id:
        correct = get_instance_by_id(db, assignment.assigned_bot_instance_id)
        return {
            "action": "wrong_instance",
            "assignedBotInstanceId": assignment.assigned_bot_instance_id,
            "inviteUrl": correct.invite_url if correct else "",
            "message": "This Discord server is assigned to another RustAssist instance.",
        }

    license_row = db.scalar(select(License).where(License.key_hash == hash_secret(payload.licenseKey)))
    if not license_row or not is_license_current(license_row):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid, expired, or revoked license key.",
        )

    active_assignments_for_license = db.scalar(
        select(func.count(GuildAssignment.id)).where(
            GuildAssignment.license_id == license_row.id,
            GuildAssignment.status == "active",
            GuildAssignment.guild_id != payload.guildId,
        )
    ) or 0
    if active_assignments_for_license >= license_row.max_guilds:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="License guild limit reached.")

    current_count = active_guild_count(db, instance.instance_id)
    is_already_active_here = bool(assignment and assignment.status == "active")
    if not is_already_active_here and current_count >= instance.active_guild_limit:
        alternate = choose_available_instance(db)
        return {
            "action": "capacity_full" if alternate else "no_capacity",
            "inviteUrl": alternate.invite_url if alternate else "",
            "message": "This RustAssist instance is full.",
        }

    if not assignment:
        assignment = GuildAssignment(
            guild_id=payload.guildId,
            guild_name=payload.guildName,
            assigned_bot_instance_id=instance.instance_id,
        )
        db.add(assignment)

    assignment.guild_name = payload.guildName or assignment.guild_name
    assignment.license = license_row
    assignment.status = "active"
    assignment.last_seen_at = utcnow()
    db.commit()
    db.refresh(assignment)

    return response_for_assignment(db, assignment)


@app.post("/licenses/deactivate")
def deactivate_license(
    payload: DeactivateLicenseRequest,
    db: Annotated[Session, Depends(get_db)],
    instance: Annotated[BotInstance, Depends(get_bot_instance_from_body)],
) -> dict:
    assignment = db.scalar(select(GuildAssignment).where(GuildAssignment.guild_id == payload.guildId))
    if not assignment:
        return {"action": "deactivated"}
    if assignment.assigned_bot_instance_id != instance.instance_id:
        correct = get_instance_by_id(db, assignment.assigned_bot_instance_id)
        return {
            "action": "wrong_instance",
            "assignedBotInstanceId": assignment.assigned_bot_instance_id,
            "inviteUrl": correct.invite_url if correct else "",
        }

    assignment.license = None
    assignment.status = "activation_only"
    assignment.updated_at = utcnow()
    db.commit()
    return {"action": "deactivated"}


@app.post("/instances/heartbeat")
def heartbeat(
    payload: HeartbeatRequest,
    db: Annotated[Session, Depends(get_db)],
    instance: Annotated[BotInstance, Depends(get_bot_instance_from_body)],
) -> dict:
    if payload.botInstanceId != instance.instance_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token does not match botInstanceId.")

    instance.invite_url = payload.inviteUrl or instance.invite_url
    instance.active_guild_limit = payload.activeGuildLimit
    instance.active_guild_count = payload.activeGuildCount
    instance.status = payload.status
    instance.last_heartbeat_at = utcnow()
    db.commit()
    return {"ok": True}


@app.post("/admin/instances", dependencies=[Depends(get_admin_token)])
def admin_upsert_instance(payload: AdminInstanceRequest, db: Annotated[Session, Depends(get_db)]) -> dict:
    instance = get_instance_by_id(db, payload.instanceId)
    if not instance:
        instance = BotInstance(instance_id=payload.instanceId, token_hash=hash_secret(payload.instanceToken))
        db.add(instance)

    instance.token_hash = hash_secret(payload.instanceToken)
    instance.invite_url = payload.inviteUrl
    instance.active_guild_limit = payload.activeGuildLimit
    instance.status = payload.status
    db.commit()
    return {"ok": True, "instanceId": instance.instance_id}


@app.post("/admin/licenses", dependencies=[Depends(get_admin_token)])
def admin_create_license(payload: AdminCreateLicenseRequest, db: Annotated[Session, Depends(get_db)]) -> dict:
    raw_key = generate_license_key()
    license_row = License(
        license_id=generate_license_id(),
        key_hash=hash_secret(raw_key),
        status="active",
        plan=payload.plan,
        max_guilds=payload.maxGuilds,
        feature_flags=payload.featureFlags,
        limits=payload.limits,
        expires_at=payload.expiresAt,
        note=payload.note,
    )
    db.add(license_row)
    db.commit()
    return {
        "licenseId": license_row.license_id,
        "licenseKey": raw_key,
        "plan": license_row.plan,
        "maxGuilds": license_row.max_guilds,
        "expiresAt": serialize_dt(license_row.expires_at),
    }


@app.get("/admin/licenses", dependencies=[Depends(get_admin_token)])
def admin_list_licenses(db: Annotated[Session, Depends(get_db)]) -> dict:
    licenses = db.scalars(select(License).order_by(License.created_at.desc())).all()
    return {
        "licenses": [
            {
                "licenseId": item.license_id,
                "status": item.status,
                "plan": item.plan,
                "maxGuilds": item.max_guilds,
                "expiresAt": serialize_dt(item.expires_at),
                "createdAt": serialize_dt(item.created_at),
                "note": item.note,
            }
            for item in licenses
        ]
    }


@app.post("/admin/licenses/{license_id}/revoke", dependencies=[Depends(get_admin_token)])
def admin_revoke_license(
    license_id: str,
    payload: AdminRevokeLicenseRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    license_row = db.scalar(select(License).where(License.license_id == license_id))
    if not license_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="License not found.")

    license_row.status = "revoked"
    if payload.reason:
        license_row.note = f"{license_row.note}\nRevoked: {payload.reason}".strip()
    db.commit()
    return {"ok": True, "licenseId": license_row.license_id, "status": license_row.status}
