"""A-03: proposal generation and intent over HTTP (in-memory repository, real planner; runs in CI)."""
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import anyio
import pytest
from fastapi.testclient import TestClient

from app.core.auth import current_uid
from app.core.settings import Settings
from app.domain.constraints import PlanningDeadlineExceeded
from app.domain.planner import BaselinePlanner
from app.main import create_app
from app.repositories.routes import DemoRouteCatalog
from app.repositories.trips import InMemoryTripRepository
from app.schemas.contracts import IntentDraft, IntentDraftResponse, ProposalRequest
from app.services.trips import request_hash

FIXTURES = Path(__file__).resolve().parents[2] / "contracts/fixtures/v3"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class Api:
    def __init__(self, *, planner=None, interpreter_factory=None):
        self.repo = InMemoryTripRepository()
        self.app = create_app(
            Settings(_env_file=None, app_env="test"),
            trip_repository=self.repo,
            planner=planner,
            intent_interpreter_factory=interpreter_factory,
        )
        self.client = TestClient(self.app)
        self.uid = "user-a"
        self.app.dependency_overrides[current_uid] = lambda: self.uid

    def as_user(self, uid):
        self.uid = uid
        return self.client

    def new_trip(self) -> dict:
        return self.client.post("/api/v1/trips", json=fixture("trip-create.request.json")).json()["trip"]

    def generate(self, trip_id, **changes):
        return self.client.post(f"/api/v1/trips/{trip_id}/proposals", json=proposal_request(**changes))


def proposal_request(**changes):
    value = {"client_request_id": str(uuid4()), "base_version": 1, "mode": "initial", "constraint_overrides": {}}
    value.update(changes)
    return value


@pytest.fixture
def api():
    return Api()


def plans(body):
    return [plan for plan in [body["baseline"], *body["alternatives"]] if plan]


def test_initial_generation_returns_and_stores_all_three_options(api):
    trip = api.new_trip()
    response = api.generate(trip["id"])
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "complete" and body["trip_id"] == trip["id"] and body["base_version"] == 1
    assert body["baseline"]["strategy"] == "baseline"
    assert [plan["strategy"] for plan in body["alternatives"]] == ["time_shift", "place_shift"]
    assert "owner_uid" not in response.text
    stored = api.client.get(f"/api/v1/trips/{trip['id']}/proposals/{body['id']}")
    assert stored.status_code == 200 and stored.json() == body


def test_place_shift_can_use_spots_the_user_did_not_select(api):
    trip = api.new_trip()
    body = api.generate(trip["id"]).json()
    requested = {stop["spot_id"] for stop in trip["requested_stops"]}
    place = next(plan for plan in body["alternatives"] if plan["strategy"] == "place_shift")
    visits = {stop["spot_id"] for stop in place["stops"][1:-1]}
    assert visits - requested, "the replacement must come from the area's unselected spots"


def test_demo_legs_are_labelled_demo_with_resolvable_evidence(api):
    body = api.generate(api.new_trip()["id"]).json()
    evidence_ids = {item["id"] for item in body["evidence"]}
    for plan in plans(body):
        for leg in plan["legs"]:
            assert leg["source_kind"] == "demo"
            assert set(leg["evidence_ids"]) <= evidence_ids


def test_trip_is_not_changed_by_generation(api):
    trip = api.new_trip()
    api.generate(trip["id"])
    after = api.client.get(f"/api/v1/trips/{trip['id']}").json()
    assert after["trip"] == trip and after["active_plan"] is None


def test_same_key_replays_the_first_proposal_without_generating_again():
    calls = []

    class CountingPlanner(BaselinePlanner):
        async def generate(self, context):
            calls.append(context.request.client_request_id)
            return await super().generate(context)

    api = Api(planner=CountingPlanner())
    trip = api.new_trip()
    request = proposal_request()
    first = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
    second = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
    assert first.status_code == second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert len(calls) == 1 and len(api.repo._proposals) == 1


def test_same_key_with_different_payload_is_rejected(api):
    trip = api.new_trip()
    request = proposal_request()
    api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
    changed = {**request, "constraint_overrides": {"max_walk_meters": 2000}}
    response = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=changed)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_other_user_gets_404_and_nothing_is_generated(api):
    trip = api.new_trip()
    other = api.as_user("user-b").post(f"/api/v1/trips/{trip['id']}/proposals", json=proposal_request())
    missing = api.as_user("user-b").post("/api/v1/trips/trip_missing/proposals", json=proposal_request())
    assert other.status_code == missing.status_code == 404
    assert other.json()["error"]["code"] == "NOT_FOUND"
    assert trip["id"] not in other.text and api.repo._proposals == {}
    # Ownership is checked before any key or lease is recorded.
    assert not any("status" in record for record in api.repo._keys.values()) and api.repo._leases == {}


@pytest.mark.parametrize(("changes", "code"), [
    ({"base_version": 2}, "VERSION_CONFLICT"),
    ({"mode": "refine"}, "MODE_CONFLICT"),
])
def test_stale_version_or_wrong_mode_is_409_and_the_key_stays_retryable(api, changes, code):
    trip = api.new_trip()
    request = proposal_request(**changes)
    for _ in range(2):
        response = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
        assert response.status_code == 409
        # Not REQUEST_IN_PROGRESS on retry: a failed attempt releases its key and lease.
        assert response.json()["error"]["code"] == code
    assert api.repo._proposals == {} and api.repo._leases == {}


def test_refine_overrides_change_the_result_without_touching_the_trip(api):
    trip = api.new_trip()
    response = api.generate(trip["id"], constraint_overrides={"max_walk_meters": 100})
    assert response.status_code == 201
    body = response.json()
    # A real constraint change reaches the planner (AC18): 100 m cannot cover the walk.
    assert body["effective_constraints"]["max_walk_meters"] == 100
    assert body["status"] == "no_feasible_plan" and body["baseline"] is None and body["alternatives"] == []
    assert "WALK_LIMIT" in {violation["code"] for violation in body["violations"]}
    assert api.client.get(f"/api/v1/trips/{trip['id']}").json()["trip"]["constraints"]["max_walk_meters"] == trip["constraints"]["max_walk_meters"]


def test_overrides_that_break_the_trip_constraints_are_422(api):
    trip = api.new_trip()
    response = api.generate(trip["id"], constraint_overrides={"end_at": trip["constraints"]["start_at"]})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.constraint_overrides"


def test_override_avoid_window_with_client_made_evidence_is_422(api):
    trip = api.new_trip()
    window = {**trip["constraints"]["avoid_windows"][0], "basis": "curated_guidance", "evidence_ids": ["client-made-up"]}
    response = api.generate(trip["id"], constraint_overrides={"avoid_windows": [window]})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.constraint_overrides.avoid_windows.0.evidence_ids"


def test_locale_override_changes_text_but_not_ids_or_numbers(api):
    trip = api.new_trip()
    ja = api.generate(trip["id"]).json()
    en = api.generate(trip["id"], constraint_overrides={"locale": "en"}).json()
    assert [p["strategy"] for p in plans(ja)] == [p["strategy"] for p in plans(en)]
    for ja_plan, en_plan in zip(plans(ja), plans(en), strict=True):
        assert [s["spot_id"] for s in ja_plan["stops"]] == [s["spot_id"] for s in en_plan["stops"]]
        assert ja_plan["metrics"] == en_plan["metrics"]
        assert ja_plan["explanation"]["summary"] != en_plan["explanation"]["summary"]


def test_pending_key_answers_request_in_progress_with_retry_after(api):
    trip = api.new_trip()
    request = proposal_request()
    now = datetime.now(UTC)
    # Another instance is still generating this exact request.
    hashed = request_hash(ProposalRequest.model_validate(request))
    anyio.run(api.repo.claim_proposal, "user-a", trip["id"], request["client_request_id"], hashed, now, now + timedelta(seconds=30))
    response = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REQUEST_IN_PROGRESS"
    assert 1 <= int(response.headers["Retry-After"]) <= 30


def test_one_generation_at_a_time_per_user(api):
    trip = api.new_trip()
    now = datetime.now(UTC)
    anyio.run(api.repo.claim_proposal, "user-a", trip["id"], str(uuid4()), "hash", now, now + timedelta(seconds=30))
    blocked = api.generate(trip["id"])
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "REQUEST_IN_PROGRESS"
    # Another user is not blocked by user-a's lease.
    other_trip = api.as_user("user-b").post("/api/v1/trips", json=fixture("trip-create.request.json")).json()["trip"]
    assert api.generate(other_trip["id"]).status_code == 201


def test_expired_lease_from_a_crashed_instance_can_be_taken_over(api):
    trip = api.new_trip()
    past = datetime.now(UTC) - timedelta(minutes=5)
    anyio.run(api.repo.claim_proposal, "user-a", trip["id"], str(uuid4()), "hash", past, past + timedelta(seconds=30))
    assert api.generate(trip["id"]).status_code == 201


def test_planner_timeout_is_504_and_the_same_key_can_retry():
    class SlowOnce(BaselinePlanner):
        failed = False

        async def generate(self, context):
            if not self.failed:
                self.failed = True
                raise PlanningDeadlineExceeded("deadline")
            return await super().generate(context)

    api = Api(planner=SlowOnce())
    trip = api.new_trip()
    request = proposal_request()
    first = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
    assert first.status_code == 504 and first.json()["error"]["code"] == "GENERATION_TIMEOUT"
    assert api.repo._proposals == {}
    retry = api.client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request)
    assert retry.status_code == 201


def test_trip_adopted_elsewhere_during_generation_is_409_and_nothing_is_saved():
    holder = {}

    class AdoptedMeanwhile(BaselinePlanner):
        async def generate(self, context):
            result = await super().generate(context)
            # Another tab adopts a plan while this one is still computing.
            holder["api"].repo._trips[context.trip.id]["trip"]["version"] = 2
            return result

    api = Api(planner=AdoptedMeanwhile())
    holder["api"] = api
    trip = api.new_trip()
    response = api.generate(trip["id"])
    assert response.status_code == 409 and response.json()["error"]["code"] == "VERSION_CONFLICT"
    assert api.repo._proposals == {} and api.repo._leases == {}


def test_demo_route_catalog_covers_every_ordered_pair():
    catalog = DemoRouteCatalog()
    ids = ["demo-origin", "demo-museum", "demo-cafe"]
    routes = catalog.routes_between([*ids, "not-a-demo-spot"])
    assert {(r.from_spot_id, r.to_spot_id) for r in routes} == {(a, b) for a in ids for b in ids if a != b}
    assert all(r.source_kind == "demo" and r.distance_meters > 0 and r.duration_seconds > 0 for r in routes)
    assert catalog.evidence is None


# --- intent ---------------------------------------------------------------

def intent_request(**changes):
    value = {
        "client_request_id": str(uuid4()),
        "area_id": "demo-area",
        "visit_date": "2026-11-05",
        "locale": "ja",
        "text": "架空資料館には必ず行きたい",
        "current_input": {},
    }
    value.update(changes)
    return value


class FakeInterpreter:
    def __init__(self):
        self.calls = []

    async def interpret(self, request, allowed_spots, deadline_monotonic):
        self.calls.append(tuple(spot.id for spot in allowed_spots))
        empty = IntentDraft(interests=None, requested_stops=[], max_walk_meters=None, end_at=None, avoid_windows=[], wait_assumptions=[], field_notes=[])
        return IntentDraftResponse(draft=empty, unresolved=[], warnings=[], generation_mode="gemini", requires_confirmation=True)


def test_intent_without_vertex_settings_is_503_so_the_form_continues(api):
    # Test settings use the demo- project, which the real Gemini client refuses to build.
    response = api.client.post("/api/v1/intent/interpret", json=intent_request())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"


def test_intent_passes_the_area_spots_to_the_interpreter():
    interpreter = FakeInterpreter()
    api = Api(interpreter_factory=lambda: interpreter)
    response = api.client.post("/api/v1/intent/interpret", json=intent_request())
    assert response.status_code == 200
    assert response.json()["requires_confirmation"] is True
    assert len(interpreter.calls) == 1 and "demo-museum" in interpreter.calls[0]


def test_intent_unknown_area_or_impossible_date_is_422():
    api = Api(interpreter_factory=FakeInterpreter)
    unknown = api.client.post("/api/v1/intent/interpret", json=intent_request(area_id="nowhere"))
    bad_date = api.client.post("/api/v1/intent/interpret", json=intent_request(visit_date="2026-13-40"))
    assert unknown.status_code == bad_date.status_code == 422
    assert unknown.json()["error"]["details"][0]["field"] == "body.area_id"
