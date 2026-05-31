import json
import os
from functools import lru_cache
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def load_env_file() -> None:
    env_path = SERVICE_ROOT / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        key, separator, value = line.partition("=")
        if not separator:
            continue

        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


class Settings:
    def __init__(self) -> None:
        load_env_file()
        default_database_url = f"sqlite:///{SERVICE_ROOT / 'license-api.sqlite'}"
        self.database_url = os.getenv("LICENSE_DATABASE_URL", default_database_url)
        self.bot_api_token = os.getenv("LICENSE_BOT_API_TOKEN", "")
        self.admin_api_token = os.getenv("LICENSE_ADMIN_API_TOKEN", "")
        self.key_hash_secret = os.getenv("LICENSE_KEY_HASH_SECRET", "dev-change-me")
        self.plans_path = Path(os.getenv("LICENSE_PLANS_PATH", str(SERVICE_ROOT / "plans.json")))


@lru_cache
def get_settings() -> Settings:
    return Settings()


DEFAULT_PLANS = {
    "free": {
        "featureFlags": {
            "rustplus": False,
            "battlemetrics": False,
            "notifications": False,
            "maps": False,
            "automation": False,
            "smartDevices": False,
            "teamChat": False,
            "streamDeck": False,
            "activityHistory": False,
            "cameraControls": False,
            "credentials": False,
            "serverManagement": False,
        },
        "limits": {
            "maxRustServers": 0,
            "maxPairedPlayers": 0,
            "mapRefreshMinSeconds": 0,
            "maxTrackers": 0,
            "maxSmartDevices": 0,
        },
    },
    "pro": {
        "featureFlags": {
            "rustplus": True,
            "battlemetrics": True,
            "notifications": True,
            "maps": True,
            "automation": True,
            "smartDevices": True,
            "teamChat": True,
            "streamDeck": True,
            "activityHistory": True,
            "cameraControls": True,
            "credentials": True,
            "serverManagement": True,
        },
        "limits": {
            "maxRustServers": 10,
            "maxPairedPlayers": 50,
            "mapRefreshMinSeconds": 60,
            "maxTrackers": 50,
            "maxSmartDevices": 250,
        },
    },
}


def load_plans() -> dict:
    settings = get_settings()
    if settings.plans_path.exists():
        return json.loads(settings.plans_path.read_text(encoding="utf-8"))
    return DEFAULT_PLANS
