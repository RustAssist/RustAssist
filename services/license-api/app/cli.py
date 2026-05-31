import argparse
import re

from .database import SessionLocal
from .main import generate_keys
from .models import LicenseKey
from .schema_management import ensure_schema
from .schemas import GenerateKeysRequest


_DURATION_UNITS = {
    "s": 1,
    "sec": 1,
    "secs": 1,
    "second": 1,
    "seconds": 1,
    "m": 60,
    "min": 60,
    "mins": 60,
    "minute": 60,
    "minutes": 60,
    "h": 60 * 60,
    "hr": 60 * 60,
    "hrs": 60 * 60,
    "hour": 60 * 60,
    "hours": 60 * 60,
    "d": 24 * 60 * 60,
    "day": 24 * 60 * 60,
    "days": 24 * 60 * 60,
    "w": 7 * 24 * 60 * 60,
    "week": 7 * 24 * 60 * 60,
    "weeks": 7 * 24 * 60 * 60,
    "mo": 30 * 24 * 60 * 60,
    "mon": 30 * 24 * 60 * 60,
    "month": 30 * 24 * 60 * 60,
    "months": 30 * 24 * 60 * 60,
    "y": 365 * 24 * 60 * 60,
    "yr": 365 * 24 * 60 * 60,
    "year": 365 * 24 * 60 * 60,
    "years": 365 * 24 * 60 * 60,
}


def parse_duration_seconds(value: str) -> int:
    text = value.strip().lower().replace(" ", "")
    matches = list(re.finditer(r"(\d+)([a-z]+)", text))
    if not matches or "".join(match.group(0) for match in matches) != text:
        raise argparse.ArgumentTypeError(
            "duration must look like 30sec, 5min, 1h, 1d, 7d, 1week, 1month, or 1y"
        )

    total = 0
    for match in matches:
        amount = int(match.group(1))
        unit = match.group(2)
        if unit not in _DURATION_UNITS:
            raise argparse.ArgumentTypeError(f"unknown duration unit: {unit}")
        total += amount * _DURATION_UNITS[unit]

    if total < 1:
        raise argparse.ArgumentTypeError("duration must be at least 1 second")
    return total


def prompt_value(label: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default is not None else ""
    value = input(f"{label}{suffix}: ").strip()
    if value:
        return value
    return default or ""


def prompt_int(label: str, default: int, minimum: int = 1) -> int:
    while True:
        raw_value = prompt_value(label, str(default))
        try:
            value = int(raw_value)
        except ValueError:
            print("Enter a number.")
            continue
        if value < minimum:
            print(f"Enter {minimum} or higher.")
            continue
        return value


def prompt_duration(label: str, default: str) -> int:
    while True:
        raw_value = prompt_value(label, default)
        try:
            return parse_duration_seconds(raw_value)
        except argparse.ArgumentTypeError as exc:
            print(exc)


def build_generate_request(
    plan: str,
    duration_seconds: int,
    count: int,
    max_uses: int,
    note: str | None,
) -> GenerateKeysRequest:
    return GenerateKeysRequest(
        plan=plan,
        durationSeconds=duration_seconds,
        count=count,
        maxUses=max_uses,
        note=note or None,
    )


def interactive_generate_request() -> GenerateKeysRequest:
    print("Generate license keys")
    plan = prompt_value("Plan", "pro")
    duration_seconds = prompt_duration("Duration", "30d")
    count = prompt_int("Count", 1)
    max_uses = prompt_int("Max uses per key", 1)
    note = prompt_value("Note", "")
    return build_generate_request(plan, duration_seconds, count, max_uses, note)


def main() -> None:
    parser = argparse.ArgumentParser(prog="license-admin")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate-key")
    gen.add_argument("--plan", default="pro")
    gen.add_argument("--duration", default="30d")
    gen.add_argument("--count", type=int, default=1)
    gen.add_argument("--max-uses", type=int, default=1)
    gen.add_argument("--note", default=None)
    gen.add_argument("--interactive", "-i", action="store_true")

    sub.add_parser("generate-key-interactive")

    revoke = sub.add_parser("revoke-key")
    revoke.add_argument("--key-prefix", required=True)

    sub.add_parser("list-keys")

    args = parser.parse_args()
    ensure_schema()
    db = SessionLocal()
    try:
        if args.command in {"generate-key", "generate-key-interactive"}:
            if args.command == "generate-key-interactive" or args.interactive:
                request = interactive_generate_request()
            else:
                duration_seconds = parse_duration_seconds(args.duration)
                request = build_generate_request(
                    args.plan,
                    duration_seconds,
                    args.count,
                    args.max_uses,
                    args.note,
                )

            keys = generate_keys(request, db)
            for key in keys:
                print(key.key)
        elif args.command == "revoke-key":
            key = db.query(LicenseKey).filter_by(key_prefix=args.key_prefix.upper()).one()
            key.status = "revoked"
            db.commit()
            print(f"revoked {key.key_prefix}")
        elif args.command == "list-keys":
            for key in db.query(LicenseKey).order_by(LicenseKey.created_at.desc()).all():
                print(
                    f"{key.key_prefix} {key.plan} {key.status} "
                    f"{key.duration_seconds}s {key.used_count}/{key.max_uses}"
                )
    finally:
        db.close()


if __name__ == "__main__":
    main()
