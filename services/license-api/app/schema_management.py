from sqlalchemy import inspect, text

from .database import Base, engine


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    if "license_keys" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("license_keys")}
    if "duration_seconds" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE license_keys ADD COLUMN duration_seconds INTEGER"))
        columns.add("duration_seconds")

    if "duration_days" in columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE license_keys "
                    "SET duration_seconds = COALESCE(duration_seconds, duration_days * 86400)"
                )
            )
            connection.execute(text("ALTER TABLE license_keys DROP COLUMN duration_days"))
