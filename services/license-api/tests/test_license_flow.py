import os

os.environ["LICENSE_BOT_API_TOKEN"] = "bot"
os.environ["LICENSE_ADMIN_API_TOKEN"] = "admin"
os.environ["LICENSE_KEY_HASH_SECRET"] = "test-secret"
os.environ["LICENSE_DATABASE_URL"] = "sqlite:///:memory:"

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


def test_key_activation_and_validation():
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)

    key_response = client.post(
        "/admin/keys",
        headers={"Authorization": "Bearer admin"},
        json={"plan": "pro", "durationDays": 1, "durationSeconds": 300, "count": 1},
    )
    assert key_response.status_code == 200
    key = key_response.json()[0]["key"]

    activation = client.post(
        "/bot/guilds/123/activate",
        headers={"Authorization": "Bearer bot"},
        json={"key": key, "activatedBy": "42"},
    )
    assert activation.status_code == 200
    assert activation.json()["status"] == "active"
    assert activation.json()["featureFlags"]["rustplus"] is True

    validation = client.post(
        "/bot/guilds/123/validate",
        headers={"Authorization": "Bearer bot"},
    )
    assert validation.status_code == 200
    assert validation.json()["plan"] == "pro"
