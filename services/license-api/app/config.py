from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LICENSE_API_",
        env_file=(REPO_ROOT / ".env", SERVICE_ROOT / ".env"),
        extra="ignore",
    )

    database_url: str = "sqlite:///./license_api.sqlite"
    admin_token: str = ""

    bootstrap_instance_id: str = "rustassist-1"
    bootstrap_instance_token: str = ""
    bootstrap_invite_url: str = ""
    bootstrap_active_guild_limit: int = 20
    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = False


settings = Settings()
