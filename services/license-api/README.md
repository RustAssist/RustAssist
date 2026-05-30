# RustAssist License API

Small central license/fleet API for RustAssist. It is intentionally simple for v1:

- FastAPI
- SQLAlchemy
- SQLite by default
- one Discord guild can be assigned to only one bot instance
- bot instances authenticate with `Authorization: Bearer <instance token>`
- admin endpoints use `X-Admin-Token`

## Run locally

```bash
cd services/license-api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set LICENSE_API_ADMIN_TOKEN=change-me-admin
set LICENSE_API_BOOTSTRAP_INSTANCE_ID=rustassist-1
set LICENSE_API_BOOTSTRAP_INSTANCE_TOKEN=change-me-instance
set LICENSE_API_BOOTSTRAP_INVITE_URL=https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
python main.py
```

The API also reads the repository root `.env`, so for local development you can put the `LICENSE_API_*` values there and run `python main.py` from `services/license-api`. The default database is `license_api.sqlite` in the current working directory unless `LICENSE_API_DATABASE_URL` is set. In Docker, it is stored at `/data/license_api.sqlite`.

## Create a license key

```bash
curl -X POST http://localhost:8000/admin/licenses ^
  -H "Content-Type: application/json" ^
  -H "X-Admin-Token: change-me-admin" ^
  -d "{\"plan\":\"basic\",\"maxGuilds\":1,\"featureFlags\":{\"all\":true},\"limits\":{}}"
```

The response contains `licenseKey`. Store it somewhere safe; the API stores only its hash and will not show the raw key again.

## Register or update a bot instance

The bootstrap env variables create/update the first instance automatically. To add `rustassist-2` later:

```bash
curl -X POST http://localhost:8000/admin/instances ^
  -H "Content-Type: application/json" ^
  -H "X-Admin-Token: change-me-admin" ^
  -d "{\"instanceId\":\"rustassist-2\",\"instanceToken\":\"change-me-instance-2\",\"inviteUrl\":\"INVITE_URL_2\",\"activeGuildLimit\":20,\"status\":\"active\"}"
```

## Bot env values

For the first bot:

```env
RPP_LICENSE_REQUIRED=true
RPP_LICENSE_API_URL=http://localhost:8000
RPP_LICENSE_VALIDATION_GRACE_MS=86400000
RPP_LICENSE_ACTIVATION_TIMEOUT_MS=900000
RPP_BOT_INSTANCE_ID=rustassist-1
RPP_BOT_INSTANCE_TOKEN=change-me-instance
RPP_BOT_INVITE_URL=https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
RPP_BOT_ACTIVE_GUILD_LIMIT=20
```

`RPP_BOT_INSTANCE_TOKEN` must match the instance token stored in this API.
