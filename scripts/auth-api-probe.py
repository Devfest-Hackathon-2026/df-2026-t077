"""Local emulator integration only; never contacts a production project."""
import sys
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.auth import verify_token
from app.core.settings import Settings
from app.main import create_app

settings = Settings(_env_file=None, app_env="test", gcp_project_id="demo-zurashitabi", firebase_auth_emulator_host="127.0.0.1:9099", firestore_emulator_host="127.0.0.1:8080")
response = httpx.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-only", json={"returnSecureToken": True}, timeout=5)
response.raise_for_status()
identity = response.json()
assert verify_token(identity["idToken"], settings) == identity["localId"]
with TestClient(create_app(settings)) as client:
    assert client.get("/api/v1/trips/test").status_code == 401
    verified = client.get("/api/v1/trips/test", headers={"Authorization": "Bearer " + identity["idToken"]})
    assert verified.status_code == 404, "Verified identity must reach the storage boundary (no such trip for this uid)"
print("Firebase emulator token -> Admin SDK verified uid -> FastAPI -> Firestore emulator: OK. Tokens were not printed.")
