"""A-04: explicit adoption over HTTP (in-memory repository, real planner; runs in CI)."""
import json
from uuid import uuid4

import pytest
from test_proposal_api import Api, fixture, plans


@pytest.fixture
def api():
    return Api()


def generated(api, **changes):
    trip = api.new_trip()
    proposal = api.generate(trip["id"], **changes).json()
    return trip, proposal


def select(api, trip_id, proposal_id, plan_id, *, expected_version=1, key=None):
    body = {"plan_id": plan_id, "expected_version": expected_version, "idempotency_key": key or str(uuid4())}
    return api.client.post(f"/api/v1/trips/{trip_id}/proposals/{proposal_id}/selection", json=body)


def test_adopting_a_plan_updates_the_trip_and_survives_reload(api):
    trip, proposal = generated(api)
    plan = proposal["alternatives"][0]
    response = select(api, trip["id"], proposal["id"], plan["id"])
    assert response.status_code == 200
    body = response.json()
    assert body["trip"]["version"] == 2
    assert body["trip"]["active_selection"]["proposal_id"] == proposal["id"]
    assert body["trip"]["active_selection"]["plan_id"] == plan["id"]
    assert body["active_plan"] == plan
    assert body["evidence"] == proposal["evidence"]
    assert "owner_uid" not in response.text
    # Reload (AC16): GET Trip is the source of truth and returns the same adopted plan.
    reloaded = api.client.get(f"/api/v1/trips/{trip['id']}").json()
    assert reloaded["trip"] == body["trip"] and reloaded["active_plan"] == plan


def test_same_key_retry_is_one_adoption(api):
    trip, proposal = generated(api)
    key = str(uuid4())
    first = select(api, trip["id"], proposal["id"], proposal["baseline"]["id"], key=key)
    # The retry still says expected_version=1; the successful replay wins over the version check (AC14).
    second = select(api, trip["id"], proposal["id"], proposal["baseline"]["id"], key=key)
    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert api.client.get(f"/api/v1/trips/{trip['id']}").json()["trip"]["version"] == 2


@pytest.mark.parametrize("change", ["plan", "proposal"])
def test_same_key_for_a_different_choice_is_rejected(api, change):
    trip, proposal = generated(api)
    key = str(uuid4())
    select(api, trip["id"], proposal["id"], proposal["baseline"]["id"], key=key)
    if change == "plan":
        response = select(api, trip["id"], proposal["id"], proposal["alternatives"][0]["id"], key=key)
    else:
        other = api.generate(trip["id"], base_version=2, mode="refine").json()
        response = select(api, trip["id"], other["id"], other["baseline"]["id"], expected_version=2, key=key)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_another_key_with_an_old_version_is_409_and_changes_nothing(api):
    trip, proposal = generated(api)
    select(api, trip["id"], proposal["id"], proposal["baseline"]["id"])
    stale = select(api, trip["id"], proposal["id"], proposal["alternatives"][0]["id"], expected_version=1)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"
    after = api.client.get(f"/api/v1/trips/{trip['id']}").json()
    assert after["trip"]["version"] == 2 and after["active_plan"]["id"] == proposal["baseline"]["id"]


def test_a_proposal_made_for_an_older_version_cannot_be_adopted(api):
    trip, old = generated(api)
    select(api, trip["id"], old["id"], old["baseline"]["id"])
    # expected_version matches the Trip, but the proposal was computed for version 1.
    response = select(api, trip["id"], old["id"], old["alternatives"][0]["id"], expected_version=2)
    assert response.status_code == 409 and response.json()["error"]["code"] == "VERSION_CONFLICT"


def test_refine_overrides_become_the_trip_conditions_only_when_adopted(api):
    trip, proposal = generated(api)
    select(api, trip["id"], proposal["id"], proposal["baseline"]["id"])
    walk = trip["constraints"]["max_walk_meters"] + 500
    refined = api.generate(trip["id"], base_version=2, mode="refine", constraint_overrides={"max_walk_meters": walk}).json()
    assert api.client.get(f"/api/v1/trips/{trip['id']}").json()["trip"]["constraints"]["max_walk_meters"] == trip["constraints"]["max_walk_meters"]
    adopted = select(api, trip["id"], refined["id"], plans(refined)[0]["id"], expected_version=2).json()
    assert adopted["trip"]["version"] == 3
    assert adopted["trip"]["constraints"]["max_walk_meters"] == walk


def test_after_adoption_initial_generation_is_a_mode_conflict(api):
    trip, proposal = generated(api)
    select(api, trip["id"], proposal["id"], proposal["baseline"]["id"])
    response = api.generate(trip["id"], base_version=2, mode="initial")
    assert response.status_code == 409 and response.json()["error"]["code"] == "MODE_CONFLICT"


def test_unknown_plan_or_proposal_is_404(api):
    trip, proposal = generated(api)
    assert select(api, trip["id"], proposal["id"], "plan-invented").status_code == 404
    assert select(api, trip["id"], "proposal_missing", "plan-baseline").status_code == 404
    assert api.client.get(f"/api/v1/trips/{trip['id']}").json()["trip"]["version"] == 1


def test_an_infeasible_proposal_has_nothing_to_adopt(api):
    trip, proposal = generated(api, constraint_overrides={"max_walk_meters": 100})
    assert proposal["status"] == "no_feasible_plan"
    assert select(api, trip["id"], proposal["id"], "plan-baseline").status_code == 404


def test_other_user_cannot_adopt_and_learns_nothing(api):
    trip, proposal = generated(api)
    response = api.as_user("user-b").post(
        f"/api/v1/trips/{trip['id']}/proposals/{proposal['id']}/selection",
        json={"plan_id": proposal["baseline"]["id"], "expected_version": 1, "idempotency_key": str(uuid4())},
    )
    assert response.status_code == 404 and response.json()["error"]["code"] == "NOT_FOUND"
    assert proposal["baseline"]["id"] not in response.text
    assert api.as_user("user-a").get(f"/api/v1/trips/{trip['id']}").json()["trip"]["version"] == 1


def place_shift_of(proposal):
    return next(plan for plan in proposal["alternatives"] if plan["strategy"] == "place_shift")


def visits(plan):
    return [stop["spot_id"] for stop in plan["stops"][1:-1]]


def test_adopting_a_place_shift_makes_the_replacement_the_trip_visit(api):
    trip, proposal = generated(api)
    place = place_shift_of(proposal)
    adopted = select(api, trip["id"], proposal["id"], place["id"]).json()["trip"]
    assert [stop["spot_id"] for stop in adopted["requested_stops"]] == visits(place)
    by_spot = {stop["spot_id"]: stop for stop in adopted["requested_stops"]}
    assert by_spot["demo-museum"]["requirement"] == "must"
    replacement = place["changes"][0]["replacement_spot_id"]
    assert by_spot[replacement] == {"spot_id": replacement, "requirement": "optional", "locked_start_at": None, "reservation_confirmed": False}


def test_refine_after_a_place_shift_starts_from_the_adopted_itinerary(api):
    trip, proposal = generated(api)
    place = place_shift_of(proposal)
    select(api, trip["id"], proposal["id"], place["id"])
    refined = api.generate(trip["id"], base_version=2, mode="refine", constraint_overrides={"max_walk_meters": 3000})
    assert refined.status_code == 201
    body = refined.json()
    assert body["status"] != "no_feasible_plan", body["violations"]
    # The new baseline is the adopted itinerary, not the original request with the replaced spot.
    assert visits(body["baseline"]) == visits(place)


def test_preferences_for_a_replaced_spot_are_dropped_on_adoption(api):
    request = json.loads(json.dumps(fixture("trip-create.request.json")))
    request["constraints"]["wait_assumptions"].append({"spot_id": "demo-cafe", "wait_seconds": 300, "basis": "user_assumption", "observed_at": None, "note": ""})
    trip = api.client.post("/api/v1/trips", json=request).json()["trip"]
    proposal = api.generate(trip["id"]).json()
    place = place_shift_of(proposal)
    assert "demo-cafe" not in visits(place)
    adopted = select(api, trip["id"], proposal["id"], place["id"]).json()["trip"]
    assert [wait["spot_id"] for wait in adopted["constraints"]["wait_assumptions"]] == ["demo-museum"]
    assert [window["spot_id"] for window in adopted["constraints"]["avoid_windows"]] == ["demo-museum"]
    # Without the cleanup the planner would reject the cafe wait as a non-visit preference (CONSTRAINT_CONFLICT).
    refined = api.generate(trip["id"], base_version=2, mode="refine").json()
    assert "CONSTRAINT_CONFLICT" not in {violation["code"] for violation in refined["violations"]}


def test_adopting_a_time_shift_keeps_the_visit_set_in_the_adopted_order(api):
    trip, proposal = generated(api)
    time_plan = next(plan for plan in proposal["alternatives"] if plan["strategy"] == "time_shift")
    adopted = select(api, trip["id"], proposal["id"], time_plan["id"]).json()["trip"]
    assert [stop["spot_id"] for stop in adopted["requested_stops"]] == visits(time_plan)
    assert {stop["spot_id"] for stop in adopted["requested_stops"]} == {stop["spot_id"] for stop in trip["requested_stops"]}
