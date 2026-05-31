from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .config import load_plans
from .models import (
    ActivationAttempt,
    GuildLicense,
    GuildProxyAssignment,
    LicenseActivation,
    LicenseKey,
    LicenseValidationAudit,
    RustplusProxy,
)
from .schemas import LicenseResponse
from .security import parse_raw_key, verify_key_secret


def _plan_config(plan: str) -> tuple[dict[str, bool], dict[str, int]]:
    plans = load_plans()
    cfg = plans.get(plan) or plans.get("free") or {"featureFlags": {}, "limits": {}}
    return cfg.get("featureFlags", {}), cfg.get("limits", {})


def _effective_status(guild_license: GuildLicense | None) -> str:
    if guild_license is None:
        return "activation_only"
    if guild_license.status in {"suspended", "cleanup_pending", "left_archived"}:
        return guild_license.status
    if guild_license.expires_at and guild_license.expires_at <= datetime.utcnow():
        return "expired"
    if guild_license.status == "active":
        return "active"
    return guild_license.status or "activation_only"


def license_response(db: Session, guild_id: str) -> LicenseResponse:
    guild_license = db.query(GuildLicense).filter_by(guild_id=guild_id).one_or_none()
    status_value = _effective_status(guild_license)
    plan = guild_license.plan if guild_license else "free"
    feature_flags, limits = _plan_config(plan if status_value == "active" else "free")

    assignment = db.query(GuildProxyAssignment).filter_by(guild_id=guild_id).one_or_none()
    proxy = None
    if assignment and assignment.assigned_proxy_id:
        proxy = (
            db.query(RustplusProxy)
            .filter_by(proxy_id=assignment.assigned_proxy_id)
            .one_or_none()
        )

    db.add(LicenseValidationAudit(guild_id=guild_id, status=status_value))
    db.commit()

    return LicenseResponse(
        status=status_value,
        plan=plan,
        featureFlags=feature_flags,
        limits=limits,
        expiresAt=guild_license.expires_at if guild_license else None,
        assignedRustplusBackend=assignment.assigned_backend if assignment else "local",
        assignedRustplusProxyId=assignment.assigned_proxy_id if assignment else None,
        proxyUrl=proxy.base_url if proxy and proxy.enabled else None,
    )


def activate_key(
    db: Session,
    guild_id: str,
    raw_key: str,
    activated_by: str | None,
) -> LicenseResponse:
    key_prefix = None
    try:
        key_prefix, secret = parse_raw_key(raw_key)
        key = db.query(LicenseKey).filter_by(key_prefix=key_prefix).one_or_none()
        if not key or not verify_key_secret(secret, key.key_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid license key",
            )
        if key.status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="License key is not active",
            )
        if key.used_count >= key.max_uses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="License key is exhausted",
            )

        guild_license = db.query(GuildLicense).filter_by(guild_id=guild_id).one_or_none()
        if not guild_license:
            guild_license = GuildLicense(guild_id=guild_id)
            db.add(guild_license)

        old_expires_at = guild_license.expires_at
        base_time = max(datetime.utcnow(), old_expires_at) if old_expires_at else datetime.utcnow()
        duration_seconds = key.duration_seconds or key.duration_days * 86400
        new_expires_at = base_time + timedelta(seconds=duration_seconds)

        guild_license.plan = key.plan
        guild_license.status = "active"
        guild_license.expires_at = new_expires_at
        guild_license.suspended_reason = None
        guild_license.updated_at = datetime.utcnow()
        key.used_count += 1

        db.add(
            LicenseActivation(
                guild_id=guild_id,
                key_id=key.id,
                plan=key.plan,
                old_expires_at=old_expires_at,
                new_expires_at=new_expires_at,
                activated_by=activated_by,
            )
        )
        db.add(
            ActivationAttempt(
                guild_id=guild_id,
                user_id=activated_by,
                key_prefix=key_prefix,
                success=True,
            )
        )
        db.commit()
        return license_response(db, guild_id)
    except HTTPException as exc:
        db.add(
            ActivationAttempt(
                guild_id=guild_id,
                user_id=activated_by,
                key_prefix=key_prefix,
                success=False,
                reason=str(exc.detail),
            )
        )
        db.commit()
        raise
