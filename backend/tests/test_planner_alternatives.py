import time
from dataclasses import replace

import pytest
from test_planner_baseline import make_context, make_route

from app.domain.planner import BaselinePlanner, build_baseline, build_time_shift
from app.domain.ports import PlanningContext
from app.repositories.routes import RouteCatalog
from app.schemas.contracts import ProposalBundle


def context_with_alternative_routes() -> PlanningContext:
    context = make_context()
    routes = (
        *context.routes,
        make_route("demo-origin", "demo-cafe"),
        make_route("demo-cafe", "demo-museum"),
        make_route("demo-museum", "demo-origin"),
        make_route("demo-museum", "demo-garden"),
        make_route("demo-garden", "demo-origin"),
    )
    return replace(context, routes=routes)


def context_with_curated_routes() -> PlanningContext:
    """Map the planner fixture roles onto eight curated route points.

    Spot content stays synthetic here; this test verifies only the A/B route boundary.
    """
    context = make_context()
    ids = {
        "demo-origin": "sakae-station",
        "demo-museum": "oasis21",
        "demo-cafe": "sunshine-sakae",
        "demo-garden": "yabaton-yabacho",
        "demo-art": "osu-kannon",
        "demo-park": "meijo-park",
        "demo-market": "osu-shopping-street",
        "demo-gallery": "banshoji",
    }
    spots = tuple(spot.model_copy(update={"id": ids[spot.id]}) for spot in context.spots)
    constraints = context.effective_constraints.model_copy(
        update={
            "start_spot_id": ids[context.effective_constraints.start_spot_id],
            "end_spot_id": ids[context.effective_constraints.end_spot_id],
            "avoid_windows": [
                window.model_copy(update={"spot_id": ids[window.spot_id]})
                for window in context.effective_constraints.avoid_windows
            ],
            "wait_assumptions": [
                wait.model_copy(update={"spot_id": ids[wait.spot_id]})
                for wait in context.effective_constraints.wait_assumptions
            ],
        }
    )
    requested_stops = [
        stop.model_copy(update={"spot_id": ids[stop.spot_id]})
        for stop in context.trip.requested_stops
    ]
    trip = context.trip.model_copy(
        update={"constraints": constraints, "requested_stops": requested_stops}
    )
    catalog = RouteCatalog()
    routes = catalog.routes_between(ids.values())
    return replace(
        context,
        trip=trip,
        effective_constraints=constraints,
        spots=spots,
        routes=routes,
        evidence=(*context.evidence, catalog.evidence),
    )


@pytest.mark.asyncio
async def test_planner_returns_time_and_place_options():
    result = await BaselinePlanner().generate(context_with_alternative_routes())
    assert result.baseline is not None
    assert [plan.strategy for plan in result.alternatives] == [
        "time_shift",
        "place_shift",
    ]
    assert result.status == "complete"
    assert result.warnings == ()


@pytest.mark.asyncio
async def test_planner_uses_curated_directional_routes_for_both_alternatives():
    context = context_with_curated_routes()
    assert len(context.routes) == 56
    forward = next(
        route
        for route in context.routes
        if (route.from_spot_id, route.to_spot_id) == ("sakae-station", "oasis21")
    )
    reverse = next(
        route
        for route in context.routes
        if (route.from_spot_id, route.to_spot_id) == ("oasis21", "sakae-station")
    )
    assert (forward.duration_seconds, forward.distance_meters) != (
        reverse.duration_seconds,
        reverse.distance_meters,
    )

    result = await BaselinePlanner().generate(context)

    assert result.baseline is not None
    assert [plan.strategy for plan in result.alternatives] == [
        "time_shift",
        "place_shift",
    ]
    for plan in (result.baseline, *result.alternatives):
        assert all(leg.source_kind == "estimated" for leg in plan.legs)
        assert all(leg.evidence_ids == [context.evidence[-1].id] for leg in plan.legs)


@pytest.mark.asyncio
async def test_time_shift_keeps_visits_must_and_fair_waits():
    result = await BaselinePlanner().generate(context_with_alternative_routes())
    baseline = result.baseline
    time_plan = next(plan for plan in result.alternatives if plan.strategy == "time_shift")
    assert baseline is not None
    assert {stop.spot_id for stop in time_plan.stops[1:-1]} == {
        stop.spot_id for stop in baseline.stops[1:-1]
    }
    museum = next(stop for stop in time_plan.stops if stop.spot_id == "demo-museum")
    assert museum.requirement == "must"
    assert museum.queue_seconds == 600
    assert time_plan.metrics.avoid_overlap_seconds < baseline.metrics.avoid_overlap_seconds
    assert "実際の混雑減少" in time_plan.facts[0].text
    assert time_plan.changes
    assert all(change.kind == "time_shift" for change in time_plan.changes)


@pytest.mark.asyncio
async def test_place_shift_replaces_optional_and_keeps_unknown_wait_explicit():
    result = await BaselinePlanner().generate(context_with_alternative_routes())
    place_plan = next(plan for plan in result.alternatives if plan.strategy == "place_shift")
    visit_ids = [stop.spot_id for stop in place_plan.stops[1:-1]]
    assert "demo-museum" in visit_ids
    assert "demo-cafe" not in visit_ids
    assert "demo-garden" in visit_ids
    assert place_plan.metrics.optional_replaced_count == 1
    assert place_plan.metrics.optional_removed_count == 0
    assert place_plan.metrics.wait_not_included_spot_ids == ["demo-garden"]
    assert place_plan.changes[0].original_spot_id == "demo-cafe"
    assert place_plan.changes[0].replacement_spot_id == "demo-garden"
    assert "架空カフェ" in place_plan.facts[0].text
    assert "架空庭園" in place_plan.facts[0].text
    assert "歩行距離" in place_plan.facts[1].text


@pytest.mark.asyncio
async def test_missing_place_routes_keeps_baseline_and_reports_shortage():
    result = await BaselinePlanner().generate(make_context())
    assert result.baseline is not None
    assert [plan.strategy for plan in result.alternatives] == ["time_shift"]
    assert len(result.warnings) == 1


@pytest.mark.asyncio
async def test_no_avoid_window_does_not_create_cosmetic_time_option():
    context = context_with_alternative_routes()
    constraints = context.effective_constraints.model_copy(update={"avoid_windows": []})
    result = await BaselinePlanner().generate(
        replace(context, effective_constraints=constraints)
    )
    assert [plan.strategy for plan in result.alternatives] == ["place_shift"]
    assert any("時間案" in warning for warning in result.warnings)


def test_same_order_shift_under_fifteen_minutes_is_deduplicated():
    context = make_context()
    window = context.effective_constraints.avoid_windows[0].model_copy(
        update={
            "ends_at": context.effective_constraints.start_at.replace(hour=9, minute=30)
        }
    )
    constraints = context.effective_constraints.model_copy(update={"avoid_windows": [window]})
    context = replace(context, effective_constraints=constraints)
    baseline, violations = build_baseline(context)
    assert violations == ()
    assert baseline is not None
    candidate, _, _ = build_time_shift(
        context,
        baseline,
        deadline_monotonic=time.monotonic() + 1,
    )
    assert candidate is None


@pytest.mark.asyncio
async def test_infeasible_baseline_can_return_feasible_reordered_time_option():
    context = context_with_alternative_routes()
    constraints = context.effective_constraints.model_copy(update={"max_walk_meters": 1000})
    shorter = {
        ("demo-origin", "demo-cafe"),
        ("demo-cafe", "demo-museum"),
        ("demo-museum", "demo-origin"),
    }
    routes = tuple(
        make_route(
            route.from_spot_id,
            route.to_spot_id,
            distance=(200 if (route.from_spot_id, route.to_spot_id) in shorter else 500),
        )
        for route in context.routes
    )
    result = await BaselinePlanner().generate(
        replace(context, effective_constraints=constraints, routes=routes)
    )
    assert result.baseline is None
    assert [plan.strategy for plan in result.alternatives] == ["time_shift"]
    assert [item.code for item in result.violations] == ["WALK_LIMIT"]
    assert result.alternatives[0].metrics.walk_meters == 600


@pytest.mark.asyncio
async def test_closed_optional_can_be_replaced_without_relaxing_must():
    context = context_with_alternative_routes()
    spots = tuple(
        spot.model_copy(update={"opening_status": "closed", "opening_windows": []})
        if spot.id == "demo-cafe"
        else spot
        for spot in context.spots
    )
    result = await BaselinePlanner().generate(replace(context, spots=spots))
    assert result.baseline is None
    assert [plan.strategy for plan in result.alternatives] == ["place_shift"]
    assert [item.code for item in result.violations] == ["CLOSED"]
    assert "demo-museum" in {
        stop.spot_id for stop in result.alternatives[0].stops[1:-1]
    }


@pytest.mark.asyncio
async def test_missing_baseline_route_can_be_avoided_by_reordering():
    context = context_with_alternative_routes()
    routes = tuple(
        route
        for route in context.routes
        if (route.from_spot_id, route.to_spot_id) != ("demo-origin", "demo-museum")
    )
    result = await BaselinePlanner().generate(replace(context, routes=routes))
    assert result.baseline is None
    assert [plan.strategy for plan in result.alternatives] == ["time_shift"]
    assert [item.code for item in result.violations] == ["ROUTE_UNKNOWN"]


@pytest.mark.asyncio
async def test_every_alternative_preserves_locked_must_time():
    context = context_with_alternative_routes()
    locked = context.effective_constraints.start_at.replace(hour=10, minute=30)
    requested = list(context.trip.requested_stops)
    requested[0] = requested[0].model_copy(update={"locked_start_at": locked})
    trip = context.trip.model_copy(update={"requested_stops": requested})
    result = await BaselinePlanner().generate(replace(context, trip=trip))
    assert result.alternatives
    for plan in result.alternatives:
        museum = next(stop for stop in plan.stops if stop.spot_id == "demo-museum")
        assert museum.requirement == "must"
        assert museum.start_at == locked


@pytest.mark.asyncio
async def test_locale_changes_text_but_not_plan_numbers_or_ids():
    ja_context = context_with_alternative_routes()
    en_constraints = ja_context.effective_constraints.model_copy(update={"locale": "en"})
    ja_result = await BaselinePlanner().generate(ja_context)
    en_result = await BaselinePlanner().generate(
        replace(ja_context, effective_constraints=en_constraints)
    )
    assert ja_result.baseline is not None
    assert en_result.baseline is not None
    assert ja_result.baseline.metrics == en_result.baseline.metrics
    for ja_plan, en_plan in zip(
        ja_result.alternatives, en_result.alternatives, strict=True
    ):
        assert ja_plan.strategy == en_plan.strategy
        assert [stop.spot_id for stop in ja_plan.stops] == [
            stop.spot_id for stop in en_plan.stops
        ]
        assert ja_plan.metrics == en_plan.metrics
        assert ja_plan.explanation.summary != en_plan.explanation.summary


@pytest.mark.asyncio
async def test_result_round_trips_through_proposal_contract():
    context = context_with_alternative_routes()
    result = await BaselinePlanner().generate(context)
    bundle = ProposalBundle(
        id="test-proposal",
        trip_id=context.trip.id,
        base_version=context.request.base_version,
        request=context.request,
        effective_constraints=context.effective_constraints,
        baseline=result.baseline,
        alternatives=list(result.alternatives),
        evidence=list(result.evidence),
        status=result.status,
        violations=list(result.violations),
        warnings=list(result.warnings),
        created_at=context.trip.updated_at,
    )
    assert ProposalBundle.model_validate(bundle.model_dump()).alternatives


@pytest.mark.asyncio
async def test_single_must_visit_explains_how_to_get_both_options():
    context = context_with_alternative_routes()
    stops = [context.trip.requested_stops[0]]  # demo-museum, must
    trip = context.trip.model_copy(update={"requested_stops": stops})
    constraints = context.effective_constraints.model_copy(update={"avoid_windows": [], "wait_assumptions": []})
    result = await BaselinePlanner().generate(replace(context, trip=trip, effective_constraints=constraints))
    assert result.baseline is not None and result.alternatives == ()
    time_warning, place_warning = result.warnings
    assert "訪問先が1か所" in time_warning and "避けたい時間帯を指定すると" in time_warning
    assert "必ずこの場所に行く" in place_warning and "体験が合えば別の場所でもよい" in place_warning


@pytest.mark.asyncio
async def test_avoid_window_already_cleared_is_explained():
    context = context_with_alternative_routes()
    start = context.effective_constraints.start_at
    window = context.effective_constraints.avoid_windows[0].model_copy(
        update={"starts_at": start.replace(hour=16), "ends_at": start.replace(hour=17)}
    )
    constraints = context.effective_constraints.model_copy(update={"avoid_windows": [window]})
    result = await BaselinePlanner().generate(replace(context, effective_constraints=constraints))
    assert result.baseline.metrics.avoid_overlap_seconds == 0
    assert any("すでに避けたい時間帯と重なっていない" in warning for warning in result.warnings)


@pytest.mark.asyncio
async def test_missing_option_reasons_are_localized():
    context = context_with_alternative_routes()
    trip = context.trip.model_copy(update={"requested_stops": [context.trip.requested_stops[0]]})
    constraints = context.effective_constraints.model_copy(update={"avoid_windows": [], "locale": "en"})
    result = await BaselinePlanner().generate(replace(context, trip=trip, effective_constraints=constraints))
    assert any("Add a time you prefer to avoid" in warning for warning in result.warnings)
    assert any("A similar experience elsewhere is welcome" in warning for warning in result.warnings)
