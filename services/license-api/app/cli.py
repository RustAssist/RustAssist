import argparse
import re

from .database import SessionLocal
from .main import generate_keys
from .models import LicenseKey
from .schema_management import ensure_schema
from .schemas import GenerateKeysRequest


def parse_duration_seconds(value: str) -> int:
    match = re.fullmatch(r"(\d+)(min|m|h|d)", value.strip().lower())
    if not match:
        raise argparse.ArgumentTypeError("duration must look like 5min, 30m, 2h, or 30d")

    amount = int(match.group(1))
    unit = match.group(2)
    if unit in {"min", "m"}:
        return amount * 60
    if unit == "h":
        return amount * 60 * 60
    return amount * 24 * 60 * 60


def main() -> None:
    parser = argparse.ArgumentParser(prog="license-admin")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate-key")
    gen.add_argument("--plan", default="pro")
    gen.add_argument("--duration", default="30d")
    gen.add_argument("--count", type=int, default=1)
    gen.add_argument("--max-uses", type=int, default=1)
    gen.add_argument("--note", default=None)

    revoke = sub.add_parser("revoke-key")
    revoke.add_argument("--key-prefix", required=True)

    sub.add_parser("list-keys")

    args = parser.parse_args()
    ensure_schema()
    db = SessionLocal()
    try:
        if args.command == "generate-key":
            duration_seconds = parse_duration_seconds(args.duration)
            days = max(1, duration_seconds // 86400)
            keys = generate_keys(
                GenerateKeysRequest(
                    plan=args.plan,
                    durationDays=days,
                    durationSeconds=duration_seconds,
                    count=args.count,
                    maxUses=args.max_uses,
                    note=args.note,
                ),
                db,
            )
            for key in keys:
                print(key.key)
        elif args.command == "revoke-key":
            key = db.query(LicenseKey).filter_by(key_prefix=args.key_prefix.upper()).one()
            key.status = "revoked"
            db.commit()
            print(f"revoked {key.key_prefix}")
        elif args.command == "list-keys":
            for key in db.query(LicenseKey).order_by(LicenseKey.created_at.desc()).all():
                duration_seconds = key.duration_seconds or key.duration_days * 86400
                print(
                    f"{key.key_prefix} {key.plan} {key.status} "
                    f"{duration_seconds}s {key.used_count}/{key.max_uses}"
                )
    finally:
        db.close()


if __name__ == "__main__":
    main()
