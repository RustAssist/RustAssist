# RustAssist License API

FastAPI service for guild license validation, key activation, admin key management, and Rust+ proxy assignments.

## Local run

```bash
cd services/license-api
uv sync --extra dev
$env:LICENSE_BOT_API_TOKEN="bot-dev-token"
$env:LICENSE_ADMIN_API_TOKEN="admin-dev-token"
$env:LICENSE_KEY_HASH_SECRET="replace-me"
uv run uvicorn app.main:app --reload --port 8088
```

The API also reads `services/license-api/.env` automatically. Plans are configured in
`services/license-api/plans.json` by default, or with `LICENSE_PLANS_PATH`.

Generate a key:

```bash
uv run python -m app.cli generate-key --plan pro --duration 30d --count 1
```

Set a guild plan directly:

```bash
curl -X PATCH http://127.0.0.1:8088/admin/guilds/GUILD_ID \
  -H "Authorization: Bearer admin-dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"active\",\"plan\":\"pro\"}"
```

Bot env:

```bash
RPP_LICENSE_API_URL=http://127.0.0.1:8088
RPP_LICENSE_API_TOKEN=bot-dev-token
```

Raw license keys are printed once and only their HMAC hash is stored.
