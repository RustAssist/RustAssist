import os
from pathlib import Path

import uvicorn


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]

        os.environ.setdefault(key, value)


def main():
    service_dir = Path(__file__).resolve().parent
    repo_root = service_dir.parents[1]

    load_dotenv(repo_root / ".env")
    load_dotenv(service_dir / ".env")

    host = os.getenv("LICENSE_API_HOST", "127.0.0.1")
    port = int(os.getenv("LICENSE_API_PORT", "8000"))
    reload = os.getenv("LICENSE_API_RELOAD", "false").lower() == "true"

    uvicorn.run("app.main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    main()
