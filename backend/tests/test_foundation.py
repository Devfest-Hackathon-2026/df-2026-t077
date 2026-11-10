import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.auth import current_uid
from app.core.settings import Settings
from app.main import create_app
from app.schemas.contracts import IntentDraftResponse, ProposalBundle, TripCreateRequest

FIXTURES = Path(__file__).resolve().parents[2] / "contracts/fixtures/v3"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def unfair_queue(value):
    plan = value["alternatives"][0]
    stop = next(s for s in plan["stops"] if s["spot_id"] == "demo-museum")
    stop["schedule_wait_seconds"] += stop["queue_seconds"]
    plan["metrics"]["schedule_wait_seconds"] += stop["queue_seconds"]
    plan["metrics"]["modeled_queue_seconds"] -= stop["queue_seconds"]
    stop["queue_seconds"] = 0


def test_http_auth_and_redacted_errors():
    app = create_app(Settings(_env_file=None, app_env="test"))
    with TestClient(app) as client:
        assert client.get("/health").json()["contract_version"] == "3.0.0"
        denied = client.get("/api/v1/spots?area_id=demo-area&visit_date=2026-11-05&locale=en")
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "UNAUTHENTICATED"
        assert denied.headers["x-request-id"] == denied.json()["error"]["request_id"]
        invalid_token = client.get("/api/v1/trips/test", headers={"Authorization": "Bearer mock-token"})
        assert invalid_token.status_code == 401
        app.dependency_overrides[current_uid] = lambda: "test-verified-uid"
        assert client.get("/api/v1/trips/test").status_code == 503
        bad = client.post("/api/v1/trips", json={"secret": "do-not-echo-me"})
        assert bad.status_code == 422
        assert "do-not-echo-me" not in bad.text
        app.dependency_overrides.clear()


@pytest.mark.parametrize("host", ["127.0.0.1:9099", "localhost:9099"])
def test_production_rejects_emulator(host):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", gcp_project_id="real-test-project", firebase_auth_emulator_host=host)


def test_vertex_settings_from_env(monkeypatch):
    monkeypatch.setenv("GCP_LOCATION", "asia-northeast1")
    monkeypatch.setenv("GEMINI_MODEL", "example-model")
    settings = Settings(_env_file=None)
    assert (settings.gcp_location, settings.gemini_model) == ("asia-northeast1", "example-model")
    defaults = Settings(_env_file=None, gcp_location="global")
    assert defaults.gcp_project_id == "demo-zurashitabi"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, gcp_location="https://evil.example")


@pytest.mark.parametrize("mutate", [
    lambda v: v.update(intent_confirmed=False),
    lambda v: v.update(raw_text="not-permitted"),
    lambda v: v["constraints"].update(start_at="2026-11-05T09:00:00"),
    lambda v: v["constraints"].update(end_at="2026-11-06T12:00:00+09:00"),
    lambda v: v["requested_stops"][0].update(requirement="optional", locked_start_at="2026-11-05T10:00:00+09:00"),
    lambda v: v["constraints"]["wait_assumptions"][0].update(basis="user_observed", observed_at=None),
    lambda v: v["constraints"]["avoid_windows"].append(copy.deepcopy(v["constraints"]["avoid_windows"][0])),
])
def test_invalid_trip_input_rejected(mutate):
    value = fixture("trip-create.request.json")
    mutate(value)
    with pytest.raises(ValidationError):
        TripCreateRequest.model_validate(value)


@pytest.mark.parametrize("mutate", [
    unfair_queue,
    lambda v: v["baseline"]["metrics"].update(wait_not_included_spot_ids=[]),
    lambda v: v["baseline"]["explanation"].update(reason_fact_ids=["invented"]),
    lambda v: v["baseline"]["legs"].pop(),
    lambda v: v["baseline"]["metrics"].update(walk_meters=1),
    lambda v: v["alternatives"].append(copy.deepcopy(v["alternatives"][0])),
])
def test_broken_or_unfair_comparison_rejected(mutate):
    value = fixture("proposal-normal.ja.json")
    mutate(value)
    with pytest.raises(ValidationError):
        ProposalBundle.model_validate(value)


def test_intent_never_claims_confirmation():
    value = fixture("intent-ambiguous.en.json")
    assert IntentDraftResponse.model_validate(value).requires_confirmation
    value["requires_confirmation"] = False
    with pytest.raises(ValidationError):
        IntentDraftResponse.model_validate(value)


def test_cors_allows_only_configured_origin():
    with TestClient(create_app(Settings(_env_file=None, app_env="test"))) as client:
        allowed = client.options("/api/v1/trips", headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST"})
        assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
        denied = client.options("/api/v1/trips", headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"})
        assert "access-control-allow-origin" not in denied.headers


def test_production_must_name_the_firestore_database():
    import pytest as _pytest
    from pydantic import ValidationError

    from app.core.settings import Settings

    real = dict(_env_file=None, app_env="production", gcp_project_id="zurashitabi")
    with _pytest.raises(ValidationError, match="FIRESTORE_DATABASE"):
        Settings(**real)
    assert Settings(**real, firestore_database="zurashitabi").firestore_database == "zurashitabi"
