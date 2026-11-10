"""お任せ slots: the planner picks verified spots that match interests and fit the route (curated data)."""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.auth import current_uid
from app.core.settings import Settings
from app.main import create_app
from app.repositories.trips import InMemoryTripRepository

AREA, DAY = "nagoya-central", "2026-11-12"  # a Thursday: no regular closures apply


@pytest.fixture
def client():
    app = create_app(Settings(_env_file=None, app_env="test", data_mode="curated"), trip_repository=InMemoryTripRepository())
    app.dependency_overrides[current_uid] = lambda: "user-a"
    return TestClient(app)


def trip_body(stops, *, omakase, interests, max_walk=8000, locale="ja"):
    return {
        "client_request_id": str(uuid4()),
        "intent_confirmed": True,
        "constraints": {
            "area_id": AREA, "timezone": "Asia/Tokyo", "start_at": f"{DAY}T09:00:00+09:00", "end_at": f"{DAY}T17:00:00+09:00",
            "start_spot_id": "sakae-station", "end_spot_id": "sakae-station", "mode": "walking",
            "max_walk_meters": max_walk, "max_visits": 4, "interests": interests, "party_size": 1, "locale": locale,
            "avoid_windows": [], "wait_assumptions": [], "omakase_visits": omakase,
        },
        "requested_stops": [{"spot_id": s, "requirement": r, "locked_start_at": None, "reservation_confirmed": False} for s, r in stops],
    }


def create_and_generate(client, body):
    created = client.post("/api/v1/trips", json=body)
    assert created.status_code == 201, created.text
    trip = created.json()["trip"]
    request = {"client_request_id": str(uuid4()), "base_version": 1, "mode": "initial", "constraint_overrides": {}}
    return trip, client.post(f"/api/v1/trips/{trip['id']}/proposals", json=request).json()


def spots_by_id(client):
    listing = client.get(f"/api/v1/spots?area_id={AREA}&visit_date={DAY}&locale=ja").json()
    return {spot["id"]: spot for spot in listing["items"]}


def visits(plan):
    return [stop["spot_id"] for stop in plan["stops"][1:-1]]


def test_omakase_only_trip_gets_a_matching_spot_and_its_reason(client):
    _, proposal = create_and_generate(client, trip_body([], omakase=1, interests=["history"]))
    assert proposal["status"] == "complete", proposal["violations"]
    baseline = proposal["baseline"]
    [picked] = visits(baseline)
    spot = spots_by_id(client)[picked]
    assert "history" in spot["tags"] and spot["opening_status"] == "verified"
    stop = baseline["stops"][1]
    assert stop["requirement"] == "optional"
    fact = next(f for f in baseline["facts"] if f["id"] == f"omakase-{picked}")
    assert fact["kind"] == "interest" and "お任せ" in fact["text"] and fact["evidence_ids"] == spot["evidence_ids"]
    assert fact["id"] in baseline["explanation"]["reason_fact_ids"]
    # The pick is a flexible visit, so the place-shift option can still suggest another spot.
    place = next((p for p in proposal["alternatives"] if p["strategy"] == "place_shift"), None)
    assert place is not None and visits(place) != visits(baseline)


def test_omakase_keeps_the_users_must_and_adds_a_different_spot(client):
    trip, proposal = create_and_generate(client, trip_body([("nagoya-castle", "must")], omakase=1, interests=["history"]))
    baseline = proposal["baseline"]
    assert "nagoya-castle" in visits(baseline) and len(visits(baseline)) == 2
    picked = next(spot_id for spot_id in visits(baseline) if spot_id != "nagoya-castle")
    assert next(s for s in baseline["stops"] if s["spot_id"] == "nagoya-castle")["requirement"] == "must"
    assert f"omakase-{picked}" in {f["id"] for f in baseline["facts"]}
    # The stored Trip keeps the user's request; the pick lives only in the proposal until adopted.
    assert [s["spot_id"] for s in client.get(f"/api/v1/trips/{trip['id']}").json()["trip"]["requested_stops"]] == ["nagoya-castle"]


def test_two_slots_pick_two_different_spots(client):
    _, proposal = create_and_generate(client, trip_body([], omakase=2, interests=["history", "food"]))
    picked = visits(proposal["baseline"])
    assert len(picked) == 2 and len(set(picked)) == 2


def test_omakase_that_cannot_fit_is_a_clear_no_feasible_plan(client):
    _, proposal = create_and_generate(client, trip_body([], omakase=1, interests=["history"], max_walk=100))
    assert proposal["status"] == "no_feasible_plan"
    assert [v["code"] for v in proposal["violations"]] == ["NO_CANDIDATE"]
    assert "お任せ" in proposal["violations"][0]["message"]


def test_unfilled_slot_next_to_a_real_visit_is_reported_not_hidden(client):
    # Only the user's own visit fits a 1.2 km walk; the お任せ slot cannot be added within it.
    _, proposal = create_and_generate(client, trip_body([("oasis21", "must")], omakase=1, interests=["history"], max_walk=1200))
    assert proposal["baseline"] is not None and visits(proposal["baseline"]) == ["oasis21"]
    assert any("お任せ枠のうち1件" in warning for warning in proposal["warnings"])


def test_adopting_turns_the_pick_into_a_real_visit_and_clears_the_slots(client):
    trip, proposal = create_and_generate(client, trip_body([], omakase=1, interests=["history"]))
    plan = proposal["baseline"]
    adopted = client.post(
        f"/api/v1/trips/{trip['id']}/proposals/{proposal['id']}/selection",
        json={"plan_id": plan["id"], "expected_version": 1, "idempotency_key": str(uuid4())},
    ).json()["trip"]
    assert [s["spot_id"] for s in adopted["requested_stops"]] == visits(plan)
    assert adopted["constraints"]["omakase_visits"] == 0
    # A refine now plans from the adopted visit without adding another お任せ spot.
    refine = {"client_request_id": str(uuid4()), "base_version": 2, "mode": "refine", "constraint_overrides": {}}
    refined = client.post(f"/api/v1/trips/{trip['id']}/proposals", json=refine).json()
    assert visits(refined["baseline"]) == visits(plan)


def test_english_reason(client):
    _, proposal = create_and_generate(client, trip_body([], omakase=1, interests=["food"], locale="en"))
    fact = next(f for f in proposal["baseline"]["facts"] if f["id"].startswith("omakase-"))
    assert "leave it to us" in fact["text"]


@pytest.mark.parametrize(("stops", "omakase"), [([], 0), ([("nagoya-castle", "must"), ("osu-kannon", "optional"), ("banshoji", "optional")], 2)])
def test_visit_count_including_slots_must_be_between_one_and_max(client, stops, omakase):
    response = client.post("/api/v1/trips", json=trip_body(stops, omakase=omakase, interests=["history"]))
    assert response.status_code == 422
