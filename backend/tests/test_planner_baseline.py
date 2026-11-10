import copy
import json
import time
from dataclasses import replace
from pathlib import Path

import pytest

from app.domain.planner import BaselinePlanner, build_baseline, validate_planning_input
from app.domain.ports import PersistenceHint, PlanningContext, RouteEstimate
from app.schemas.contracts import (
    ProposalRequest,
    SpotListResponse,
    TripResponse,
)

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "v3"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def make_context() -> PlanningContext:
    trip_response = TripResponse.model_validate(fixture("trip.ja.json"))
    spots_response = SpotListResponse.model_validate(fixture("spots.ja.json"))
    proposal = fixture("proposal-normal.ja.json")
    request = ProposalRequest.model_validate(proposal["request"])
    routes = (
        make_route("demo-origin", "demo-museum"),
        make_route("demo-museum", "demo-cafe"),
        make_route("demo-cafe", "demo-origin"),
    )
    return PlanningContext(
        trip=trip_response.trip,
        request=request,
        effective_constraints=trip_response.trip.constraints,
        spots=tuple(spots_response.items),
        routes=routes,
        evidence=tuple(spots_response.evidence),
        deadline_monotonic=time.monotonic() + 10,
    )


def make_route(from_id: str, to_id: str, *, distance: int = 500) -> RouteEstimate:
    return RouteEstimate(
        from_spot_id=from_id,
        to_spot_id=to_id,
        duration_seconds=600,
        distance_meters=distance,
        source_kind="demo",
        evidence_ids=("demo-evidence",),
        persistence=PersistenceHint(
            persistable=False,
            expires_at=None,
            required_attribution=None,
            provider="test",
            reference=None,
        ),
    )


def replace_spot(context: PlanningContext, spot_id: str, **changes) -> PlanningContext:
    spots = tuple(
        spot.model_copy(update=changes) if spot.id == spot_id else spot
        for spot in context.spots
    )
    return replace(context, spots=spots)


def test_valid_input_has_no_violations_and_is_not_mutated():
    context = make_context()
    before = copy.deepcopy(context)
    assert validate_planning_input(context) == ()
    assert context == before


def test_baseline_keeps_order_waits_and_return_leg():
    plan, violations = build_baseline(make_context())
    assert violations == ()
    assert plan is not None
    assert [stop.spot_id for stop in plan.stops] == [
        "demo-origin",
        "demo-museum",
        "demo-cafe",
        "demo-origin",
    ]
    assert len(plan.legs) == 3
    assert plan.stops[1].requirement == "must"
    assert plan.stops[1].queue_seconds == 600
    assert plan.stops[2].queue_seconds == 0
    assert plan.metrics.wait_not_included_spot_ids == ["demo-cafe"]
    assert plan.metrics.walk_meters == 1500


def test_opening_wait_is_separate_from_queue():
    context = make_context()
    museum = next(spot for spot in context.spots if spot.id == "demo-museum")
    opening = museum.opening_windows[0].model_copy(
        update={"opens_at": museum.opening_windows[0].opens_at.replace(hour=10)}
    )
    context = replace_spot(context, "demo-museum", opening_windows=[opening])
    plan, violations = build_baseline(context)
    assert violations == ()
    assert plan is not None
    assert plan.stops[1].arrival_at.hour == 9
    assert plan.stops[1].opening_wait_seconds == 48 * 60
    assert plan.stops[1].queue_seconds == 600
    assert plan.stops[1].schedule_wait_seconds == 0


def test_locked_start_is_preserved():
    context = make_context()
    locked = context.effective_constraints.start_at.replace(hour=10, minute=30)
    requested = list(context.trip.requested_stops)
    requested[0] = requested[0].model_copy(update={"locked_start_at": locked})
    context = replace(context, trip=context.trip.model_copy(update={"requested_stops": requested}))
    plan, violations = build_baseline(context)
    assert violations == ()
    assert plan is not None
    assert plan.stops[1].start_at == locked
    assert plan.stops[1].schedule_wait_seconds > 0


def test_unreachable_locked_start_is_rejected_without_moving_it():
    context = make_context()
    locked = context.effective_constraints.start_at.replace(hour=9, minute=15)
    requested = list(context.trip.requested_stops)
    requested[0] = requested[0].model_copy(update={"locked_start_at": locked})
    context = replace(context, trip=context.trip.model_copy(update={"requested_stops": requested}))
    plan, violations = build_baseline(context)
    assert plan is None
    assert [item.code for item in violations] == ["LOCKED_TIME"]


@pytest.mark.parametrize(
    ("status", "code"),
    [("closed", "CLOSED"), ("unknown", "OPENING_UNKNOWN")],
)
def test_unavailable_opening_status_is_rejected(status, code):
    context = replace_spot(
        make_context(),
        "demo-museum",
        opening_status=status,
        opening_windows=[],
    )
    violations = validate_planning_input(context)
    assert any(item.code == code and item.spot_id == "demo-museum" for item in violations)


def test_unconfirmed_reservation_is_rejected():
    context = replace_spot(make_context(), "demo-museum", reservation_required=True)
    violations = validate_planning_input(context)
    assert any(item.code == "RESERVATION_REQUIRED" for item in violations)


def test_missing_return_route_is_rejected():
    context = make_context()
    context = replace(context, routes=context.routes[:-1])
    violations = validate_planning_input(context)
    assert any(
        item.code == "ROUTE_UNKNOWN" and item.spot_id == "demo-origin"
        for item in violations
    )


def test_walk_limit_includes_return_leg():
    context = make_context()
    routes = tuple(
        make_route(route.from_spot_id, route.to_spot_id, distance=1200)
        for route in context.routes
    )
    plan, violations = build_baseline(replace(context, routes=routes))
    assert plan is None
    assert [item.code for item in violations] == ["WALK_LIMIT"]


def test_finish_limit_includes_return_leg():
    context = make_context()
    end_at = context.effective_constraints.start_at.replace(hour=10, minute=30)
    constraints = context.effective_constraints.model_copy(update={"end_at": end_at})
    context = replace(context, effective_constraints=constraints)
    plan, violations = build_baseline(context)
    assert plan is None
    assert [item.code for item in violations] == ["TIME_LIMIT"]


def test_visit_that_crosses_closing_is_rejected():
    context = make_context()
    museum = next(spot for spot in context.spots if spot.id == "demo-museum")
    window = museum.opening_windows[0].model_copy(
        update={"closes_at": museum.opening_windows[0].opens_at.replace(hour=9, minute=40)}
    )
    context = replace_spot(context, "demo-museum", opening_windows=[window])
    plan, violations = build_baseline(context)
    assert plan is None
    assert [item.code for item in violations] == ["CLOSED"]


@pytest.mark.asyncio
async def test_planner_returns_no_feasible_result_for_invalid_input():
    context = make_context()
    context = replace(context, routes=context.routes[:-1])
    result = await BaselinePlanner().generate(context)
    assert result.baseline is None
    assert result.status == "no_feasible_plan"
    assert any(item.code == "ROUTE_UNKNOWN" for item in result.violations)
