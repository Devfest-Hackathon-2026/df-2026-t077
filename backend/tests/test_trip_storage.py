"""A-02: spots, trip storage and ownership through HTTP (in-memory repository; runs in CI)."""
import copy
import json
from pathlib import Path

import anyio
import pytest
from fastapi.testclient import TestClient

from app.core.auth import current_uid
from app.core.settings import Settings
from app.main import create_app
from app.repositories.trips import InMemoryTripRepository
from app.schemas.contracts import ProposalBundle

FIXTURES = Path(__file__).resolve().parents[2] / "contracts/fixtures/v3"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class Api:
    def __init__(self):
        self.repo = InMemoryTripRepository()
        self.app = create_app(Settings(_env_file=None, app_env="test"), trip_repository=self.repo)
        self.client = TestClient(self.app)
        self.uid = "user-a"
        self.app.dependency_overrides[current_uid] = lambda: self.uid

    def as_user(self, uid):
        self.uid = uid
        return self.client


@pytest.fixture
def api():
    return Api()


def trip_request(**changes):
    value = fixture("trip-create.request.json")
    value.update(changes)
    return value


def test_spots_are_listed_for_the_visit_date(api):
    response = api.client.get("/api/v1/spots?area_id=demo-area&visit_date=2026-12-01&locale=en")
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 8
    assert all(spot["is_demo"] for spot in body["items"])
    assert body["items"][0]["opening_windows"][0]["opens_at"].startswith("2026-12-01T09:00:00")
    assert {e["id"] for e in body["evidence"]} == {"demo-evidence"}
    filtered = api.client.get("/api/v1/spots?area_id=demo-area&visit_date=2026-12-01&locale=ja&q=MUSEUM").json()
    assert [spot["id"] for spot in filtered["items"]] == ["demo-museum"]


def test_unknown_area_is_not_found(api):
    response = api.client.get("/api/v1/spots?area_id=nowhere&visit_date=2026-12-01&locale=ja")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_create_and_read_own_trip(api):
    created = api.client.post("/api/v1/trips", json=trip_request())
    assert created.status_code == 201
    body = created.json()
    trip = body["trip"]
    assert trip["version"] == 1 and trip["active_selection"] is None
    assert body["active_plan"] is None
    assert [e["id"] for e in body["evidence"]] == ["demo-evidence"]
    assert "owner_uid" not in created.text
    again = api.client.get(f"/api/v1/trips/{trip['id']}")
    assert again.status_code == 200
    assert again.json() == body


def test_other_user_gets_the_same_404_as_a_missing_trip(api):
    trip_id = api.client.post("/api/v1/trips", json=trip_request()).json()["trip"]["id"]
    other = api.as_user("user-b").get(f"/api/v1/trips/{trip_id}")
    missing = api.client.get("/api/v1/trips/trip_does_not_exist")
    assert other.status_code == missing.status_code == 404
    assert other.json()["error"]["code"] == missing.json()["error"]["code"] == "NOT_FOUND"
    assert trip_id not in other.text and "demo-museum" not in other.text


def test_retry_with_same_key_returns_the_first_trip(api):
    first = api.client.post("/api/v1/trips", json=trip_request()).json()
    second = api.client.post("/api/v1/trips", json=trip_request())
    assert second.status_code == 201
    assert second.json()["trip"]["id"] == first["trip"]["id"]
    assert len(api.repo._trips) == 1


def test_same_key_with_different_payload_is_rejected(api):
    api.client.post("/api/v1/trips", json=trip_request())
    changed = trip_request()
    changed["constraints"]["max_walk_meters"] = 2000
    response = api.client.post("/api/v1/trips", json=changed)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_same_key_from_another_user_creates_a_separate_trip(api):
    first = api.client.post("/api/v1/trips", json=trip_request()).json()["trip"]["id"]
    second = api.as_user("user-b").post("/api/v1/trips", json=trip_request()).json()["trip"]["id"]
    assert first != second


@pytest.mark.parametrize(("mutate", "field"), [
    (lambda v: v["requested_stops"][1].update(spot_id="invented-spot"), "body.requested_stops.1.spot_id"),
    (lambda v: v["constraints"].update(start_spot_id="invented-origin"), "body.constraints.start_spot_id"),
    (lambda v: v["constraints"].update(area_id="other-area"), "body.constraints.area_id"),
    (lambda v: v["constraints"]["avoid_windows"][0].update(evidence_ids=["client-made-up"]), "body.constraints.avoid_windows.0.evidence_ids"),
])
def test_references_the_server_does_not_hold_are_rejected(api, mutate, field):
    value = trip_request()
    mutate(value)
    response = api.client.post("/api/v1/trips", json=value)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == field
    assert api.repo._trips == {}


def test_unreachable_firestore_fails_fast_as_503(monkeypatch):
    from app.repositories import trips
    monkeypatch.setattr(trips, "FIRESTORE_TIMEOUT_SECONDS", 1)
    settings = Settings(_env_file=None, app_env="test", firestore_emulator_host="127.0.0.1:1")
    app = create_app(settings)
    app.dependency_overrides[current_uid] = lambda: "user-a"
    with TestClient(app) as client:
        response = client.get("/api/v1/trips/trip_x")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"


def stored_proposal(api, trip_id):
    value = copy.deepcopy(fixture("proposal-normal.ja.json"))
    value["trip_id"] = trip_id
    return ProposalBundle.model_validate(value)


def test_proposal_is_readable_only_by_its_owner(api):
    trip_id = api.client.post("/api/v1/trips", json=trip_request()).json()["trip"]["id"]
    bundle = stored_proposal(api, trip_id)
    anyio.run(api.repo.save_proposal, "user-a", bundle)
    own = api.client.get(f"/api/v1/trips/{trip_id}/proposals/{bundle.id}")
    assert own.status_code == 200 and own.json()["id"] == bundle.id
    assert api.as_user("user-b").get(f"/api/v1/trips/{trip_id}/proposals/{bundle.id}").status_code == 404
    assert api.as_user("user-a").get(f"/api/v1/trips/{trip_id}/proposals/missing").status_code == 404


def test_adopted_plan_is_returned_with_the_trip(api):
    trip_id = api.client.post("/api/v1/trips", json=trip_request()).json()["trip"]["id"]
    bundle = stored_proposal(api, trip_id)
    anyio.run(api.repo.save_proposal, "user-a", bundle)
    # A-04 will write this through the selection transaction; simulate the stored result here.
    doc = api.repo._trips[trip_id]
    doc["trip"]["active_selection"] = {"proposal_id": bundle.id, "plan_id": bundle.baseline.id, "selected_at": "2026-11-05T08:00:00+09:00"}
    doc["trip"]["version"] = 2
    body = api.client.get(f"/api/v1/trips/{trip_id}").json()
    assert body["active_plan"]["id"] == bundle.baseline.id
    assert body["trip"]["version"] == 2
