"""Pure baseline planning for the shared A/B domain boundary."""

import asyncio
import time
from collections import Counter
from dataclasses import replace
from datetime import datetime, timedelta
from itertools import pairwise, permutations

from app.domain.constraints import remaining_seconds
from app.domain.ports import (
    EngineResult,
    ExplanationInput,
    PlanningContext,
    RouteEstimate,
)
from app.schemas.contracts import (
    Explanation,
    Fact,
    Leg,
    Metrics,
    Plan,
    PlanChange,
    RequestedStop,
    Spot,
    Stop,
    Violation,
)

LEG_BUFFER_SECONDS = 120
SEARCH_LIMIT_SECONDS = 2.0
MAX_EXPANSIONS = 3000
MIN_SAME_ORDER_SHIFT_SECONDS = 15 * 60


def _violation(
    code: str,
    message_ja: str,
    message_en: str,
    action_ja: str,
    action_en: str,
    *,
    locale: str,
    spot_id: str | None = None,
) -> Violation:
    return Violation(
        code=code,
        spot_id=spot_id,
        message=message_ja if locale == "ja" else message_en,
        suggested_action=action_ja if locale == "ja" else action_en,
    )


def validate_planning_input(context: PlanningContext) -> tuple[Violation, ...]:
    """Validate semantic inputs that cannot be guaranteed by transport DTOs alone."""
    constraints = context.effective_constraints
    locale = constraints.locale
    requested = tuple(context.trip.requested_stops)
    visit_ids = [stop.spot_id for stop in requested]
    violations: list[Violation] = []

    if context.request.base_version != context.trip.version:
        violations.append(
            _violation(
                "CONSTRAINT_CONFLICT",
                "提案の基準versionが旅行データと一致しません。",
                "The proposal base version does not match the trip.",
                "旅行データを再取得してから再提案してください。",
                "Reload the trip before generating another proposal.",
                locale=locale,
            )
        )
    if not requested or len(requested) > constraints.max_visits:
        violations.append(
            _violation(
                "CONSTRAINT_CONFLICT",
                "訪問件数が現在の上限と一致しません。",
                "The requested visit count conflicts with the current limit.",
                "訪問先と上限を確認してください。",
                "Review the requested visits and visit limit.",
                locale=locale,
            )
        )
    if len(visit_ids) != len(set(visit_ids)) or sum(
        stop.requirement == "must" for stop in requested
    ) > 3:
        violations.append(
            _violation(
                "CONSTRAINT_CONFLICT",
                "訪問先の重複またはmust件数が不正です。",
                "Requested visits are duplicated or contain too many required stops.",
                "確認済みの訪問条件を修正してください。",
                "Correct the confirmed visit requirements.",
                locale=locale,
            )
        )
    if {constraints.start_spot_id, constraints.end_spot_id} & set(visit_ids):
        violations.append(
            _violation(
                "CONSTRAINT_CONFLICT",
                "起終点を訪問先として重複指定できません。",
                "Origin and destination cannot also be requested visits.",
                "起終点または訪問先を変更してください。",
                "Change the endpoints or requested visits.",
                locale=locale,
            )
        )

    spot_counts = Counter(spot.id for spot in context.spots)
    spots = {spot.id: spot for spot in context.spots}
    evidence_ids = {item.id for item in context.evidence}
    required_ids = {constraints.start_spot_id, constraints.end_spot_id, *visit_ids}
    for spot_id in sorted(required_ids):
        spot = spots.get(spot_id)
        requested_stop = next((item for item in requested if item.spot_id == spot_id), None)
        if spot is None or spot_counts[spot_id] != 1:
            code = (
                "MUST_UNREACHABLE"
                if requested_stop and requested_stop.requirement == "must"
                else "NO_CANDIDATE"
            )
            violations.append(
                _violation(
                    code,
                    "旅程生成に必要な施設情報がありません。",
                    "Required spot information is unavailable to the planner.",
                    "対象エリアの施設情報を確認してください。",
                    "Confirm the spot data for the selected area.",
                    locale=locale,
                    spot_id=spot_id,
                )
            )
            continue
        if spot.area_id != constraints.area_id or not set(spot.evidence_ids) <= evidence_ids:
            violations.append(
                _violation(
                    "CONSTRAINT_CONFLICT",
                    "施設のエリアまたは根拠参照が入力条件と一致しません。",
                    "The spot area or evidence references conflict with the input.",
                    "施設データと根拠を確認してください。",
                    "Review the spot data and evidence.",
                    locale=locale,
                    spot_id=spot_id,
                )
            )

    for requested_stop in requested:
        spot = spots.get(requested_stop.spot_id)
        if spot is None:
            continue
        if spot.opening_status == "closed":
            violations.append(
                _violation(
                    "CLOSED",
                    "選択日の営業が確認できない施設です。",
                    "This spot is closed on the selected date.",
                    "別の施設または日付を選択してください。",
                    "Choose another spot or date.",
                    locale=locale,
                    spot_id=spot.id,
                )
            )
        elif spot.opening_status == "unknown":
            violations.append(
                _violation(
                    "OPENING_UNKNOWN",
                    "営業時間が未確認の施設です。",
                    "Opening information for this spot is unconfirmed.",
                    "営業時間を確認してから再提案してください。",
                    "Confirm opening information before generating again.",
                    locale=locale,
                    spot_id=spot.id,
                )
            )
        if spot.reservation_required is not False and not requested_stop.reservation_confirmed:
            violations.append(
                _violation(
                    "RESERVATION_REQUIRED",
                    "予約要否または予約確保を確認できません。",
                    "Reservation requirements or confirmation are unresolved.",
                    "予約条件を確認するか訪問先を変更してください。",
                    "Confirm the reservation or change the visit.",
                    locale=locale,
                    spot_id=spot.id,
                )
            )

    referenced_ids = {
        item.spot_id for item in [*constraints.avoid_windows, *constraints.wait_assumptions]
    }
    if not referenced_ids <= set(visit_ids):
        violations.append(
            _violation(
                "CONSTRAINT_CONFLICT",
                "待ち時間または回避時間帯が訪問先以外を参照しています。",
                "A wait assumption or avoid window refers to a non-visit spot.",
                "条件を現在の訪問先に合わせてください。",
                "Align the preferences with the current requested visits.",
                locale=locale,
            )
        )

    sequence = [constraints.start_spot_id, *visit_ids, constraints.end_spot_id]
    route_counts = Counter((route.from_spot_id, route.to_spot_id) for route in context.routes)
    routes = {(route.from_spot_id, route.to_spot_id): route for route in context.routes}
    for from_id, to_id in pairwise(sequence):
        route = routes.get((from_id, to_id))
        if route is None or route_counts[(from_id, to_id)] != 1:
            violations.append(
                _violation(
                    "ROUTE_UNKNOWN",
                    "必要な徒歩経路を確認できません。",
                    "A required walking route is unavailable.",
                    "経路情報を確認してから再提案してください。",
                    "Confirm route data before generating again.",
                    locale=locale,
                    spot_id=to_id,
                )
            )
        elif not set(route.evidence_ids) <= evidence_ids:
            violations.append(
                _violation(
                    "CONSTRAINT_CONFLICT",
                    "経路の根拠参照を解決できません。",
                    "Route evidence references cannot be resolved.",
                    "経路情報と根拠を確認してください。",
                    "Review the route data and evidence.",
                    locale=locale,
                    spot_id=to_id,
                )
            )
    return tuple(violations)


def _schedule_visit(
    arrival: datetime,
    requested: RequestedStop,
    spot: Spot,
    queue_seconds: int,
    candidate_start: datetime | None = None,
) -> tuple[datetime, datetime, int, int] | None:
    for window in sorted(spot.opening_windows, key=lambda item: item.opens_at):
        open_ready = max(arrival, window.opens_at)
        earliest_start = open_ready + timedelta(seconds=queue_seconds)
        start = requested.locked_start_at or max(earliest_start, candidate_start or earliest_start)
        departure = start + timedelta(seconds=spot.stay_seconds)
        if earliest_start <= start and departure <= window.closes_at:
            opening_wait = int((open_ready - arrival).total_seconds())
            schedule_wait = int((start - earliest_start).total_seconds())
            return start, departure, opening_wait, schedule_wait
    return None


def _dynamic_violation(
    context: PlanningContext, requested: RequestedStop, code: str
) -> Violation:
    locale = context.effective_constraints.locale
    if code == "LOCKED_TIME":
        return _violation(
            code,
            "固定時刻を維持した旅程を作れません。",
            "The itinerary cannot preserve the locked start time.",
            "固定時刻、営業時間、移動条件を確認してください。",
            "Review the locked time, opening hours, and travel conditions.",
            locale=locale,
            spot_id=requested.spot_id,
        )
    return _violation(
        "CLOSED",
        "営業時間内に滞在を完了できません。",
        "The visit cannot be completed within opening hours.",
        "訪問順、開始時刻、または訪問先を変更してください。",
        "Change the visit order, start time, or requested spot.",
        locale=locale,
        spot_id=requested.spot_id,
    )


def _baseline_facts(context: PlanningContext, unknown_waits: list[str]) -> tuple[list[Fact], Explanation, list[str]]:
    locale = context.effective_constraints.locale
    is_demo = any(spot.is_demo for spot in context.spots)
    facts = [
        Fact(
            id="baseline-order",
            kind="change",
            text=(
                "確認した訪問順を維持した元案です。"
                if locale == "ja"
                else "This baseline keeps the confirmed visit order."
            ),
            evidence_ids=[],
            is_demo=is_demo,
        )
    ]
    warnings: list[str] = []
    uncertainty_ids: list[str] = []
    if unknown_waits:
        warning = (
            "待ち時間が未入力の訪問先は計算に含めていません。空いているという意味ではありません。"
            if locale == "ja"
            else "Unspecified waits are not included; this does not mean those spots are empty."
        )
        facts.append(
            Fact(
                id="unknown-waits",
                kind="uncertainty",
                text=warning,
                evidence_ids=[],
                is_demo=is_demo,
            )
        )
        warnings.append(warning)
        uncertainty_ids.append("unknown-waits")
    summary = (
        "確認した訪問順と必須条件を保つ元案です。"
        if locale == "ja"
        else "This baseline preserves the confirmed order and required conditions."
    )
    explanation = Explanation(
        summary=summary,
        reason_fact_ids=["baseline-order"],
        tradeoff_fact_ids=[],
        uncertainty_fact_ids=uncertainty_ids,
        generation_mode="template",
    )
    return facts, explanation, warnings


def build_baseline(context: PlanningContext) -> tuple[Plan | None, tuple[Violation, ...]]:
    """Schedule the confirmed visit order at the earliest feasible times."""
    input_violations = validate_planning_input(context)
    if input_violations:
        return None, input_violations

    constraints = context.effective_constraints
    requested = tuple(context.trip.requested_stops)
    spots = {spot.id: spot for spot in context.spots}
    routes = {(route.from_spot_id, route.to_spot_id): route for route in context.routes}
    waits = {item.spot_id: item.wait_seconds for item in constraints.wait_assumptions}
    sequence = [constraints.start_spot_id, *(item.spot_id for item in requested), constraints.end_spot_id]
    stop_ids = ["origin", *(f"stop-{index}" for index in range(len(requested))), "destination"]

    current_time = constraints.start_at
    origin = spots[constraints.start_spot_id]
    stops = [
        Stop(
            id="origin",
            spot_id=constraints.start_spot_id,
            role="origin",
            requirement=None,
            arrival_at=current_time,
            start_at=current_time,
            departure_at=current_time,
            locked_start_at=None,
            opening_wait_seconds=0,
            queue_seconds=0,
            schedule_wait_seconds=0,
            evidence_ids=origin.evidence_ids,
        )
    ]
    legs: list[Leg] = []

    for index, requested_stop in enumerate(requested):
        route = routes[(sequence[index], sequence[index + 1])]
        leg = _make_leg(route, stop_ids[index], stop_ids[index + 1])
        legs.append(leg)
        arrival = current_time + timedelta(
            seconds=route.duration_seconds + LEG_BUFFER_SECONDS
        )
        spot = spots[requested_stop.spot_id]
        queue_seconds = waits.get(spot.id, 0)
        scheduled = _schedule_visit(arrival, requested_stop, spot, queue_seconds)
        if scheduled is None:
            code = "LOCKED_TIME" if requested_stop.locked_start_at else "CLOSED"
            return None, (_dynamic_violation(context, requested_stop, code),)
        start, departure, opening_wait, schedule_wait = scheduled
        stops.append(
            Stop(
                id=stop_ids[index + 1],
                spot_id=spot.id,
                role="visit",
                requirement=requested_stop.requirement,
                arrival_at=arrival,
                start_at=start,
                departure_at=departure,
                locked_start_at=requested_stop.locked_start_at,
                opening_wait_seconds=opening_wait,
                queue_seconds=queue_seconds,
                schedule_wait_seconds=schedule_wait,
                evidence_ids=spot.evidence_ids,
            )
        )
        current_time = departure

    return_route = routes[(sequence[-2], sequence[-1])]
    legs.append(_make_leg(return_route, stop_ids[-2], stop_ids[-1]))
    destination_at = current_time + timedelta(
        seconds=return_route.duration_seconds + LEG_BUFFER_SECONDS
    )
    destination = spots[constraints.end_spot_id]
    stops.append(
        Stop(
            id="destination",
            spot_id=destination.id,
            role="destination",
            requirement=None,
            arrival_at=destination_at,
            start_at=destination_at,
            departure_at=destination_at,
            locked_start_at=None,
            opening_wait_seconds=0,
            queue_seconds=0,
            schedule_wait_seconds=0,
            evidence_ids=destination.evidence_ids,
        )
    )

    walk_meters = sum(leg.distance_meters for leg in legs)
    if walk_meters > constraints.max_walk_meters:
        return None, (
            _violation(
                "WALK_LIMIT",
                "帰路を含む歩行距離が上限を超えます。",
                "Walking distance including the return leg exceeds the limit.",
                "歩行上限または訪問先を変更してください。",
                "Change the walking limit or requested visits.",
                locale=constraints.locale,
            ),
        )
    if destination_at > constraints.end_at:
        return None, (
            _violation(
                "TIME_LIMIT",
                "帰路を含めると終了時刻を超えます。",
                "The itinerary finishes after the time limit when the return is included.",
                "終了時刻、訪問先、または滞在条件を変更してください。",
                "Change the end time, visits, or stay conditions.",
                locale=constraints.locale,
            ),
        )

    unknown_waits = [item.spot_id for item in requested if item.spot_id not in waits]
    facts, explanation, warnings = _baseline_facts(context, unknown_waits)
    overlap_seconds = _avoid_overlap_seconds(stops, context)
    metrics = Metrics(
        walk_meters=walk_meters,
        travel_seconds=sum(leg.duration_seconds for leg in legs),
        total_seconds=int((destination_at - constraints.start_at).total_seconds()),
        finish_slack_seconds=int((constraints.end_at - destination_at).total_seconds()),
        modeled_queue_seconds=sum(stop.queue_seconds for stop in stops),
        schedule_wait_seconds=sum(stop.schedule_wait_seconds for stop in stops),
        avoid_overlap_seconds=overlap_seconds,
        optional_kept_count=sum(item.requirement == "optional" for item in requested),
        optional_replaced_count=0,
        optional_removed_count=0,
        wait_not_included_spot_ids=unknown_waits,
    )
    return (
        Plan(
            id="plan-baseline",
            strategy="baseline",
            stops=stops,
            legs=legs,
            metrics=metrics,
            facts=facts,
            explanation=explanation,
            changes=[],
            warnings=warnings,
        ),
        (),
    )


def _make_leg(route: RouteEstimate, from_stop_id: str, to_stop_id: str) -> Leg:
    return Leg(
        from_stop_id=from_stop_id,
        to_stop_id=to_stop_id,
        mode="walking",
        duration_seconds=route.duration_seconds,
        buffer_seconds=LEG_BUFFER_SECONDS,
        distance_meters=route.distance_meters,
        source_kind=route.source_kind,
        evidence_ids=list(route.evidence_ids),
    )


def _avoid_overlap_seconds(stops: list[Stop], context: PlanningContext) -> int:
    overlap = 0
    for stop in stops[1:-1]:
        for window in context.effective_constraints.avoid_windows:
            if window.spot_id != stop.spot_id:
                continue
            overlap += max(
                0,
                int(
                    (
                        min(stop.departure_at, window.ends_at)
                        - max(stop.start_at, window.starts_at)
                    ).total_seconds()
                ),
            )
    return overlap


def _candidate_schedule(
    context: PlanningContext,
    requested: tuple[RequestedStop, ...],
    *,
    strategy: str,
    plan_id: str,
    candidate_starts: dict[str, datetime] | None = None,
    optional_kept_count: int,
    optional_replaced_count: int,
) -> Plan | None:
    """Build one candidate with the same scheduling and wait rules as the baseline."""
    constraints = context.effective_constraints
    candidate_starts = candidate_starts or {}
    spots = {spot.id: spot for spot in context.spots}
    route_counts = Counter((route.from_spot_id, route.to_spot_id) for route in context.routes)
    routes = {(route.from_spot_id, route.to_spot_id): route for route in context.routes}
    evidence_ids = {item.id for item in context.evidence}
    waits = {item.spot_id: item.wait_seconds for item in constraints.wait_assumptions}
    sequence = [
        constraints.start_spot_id,
        *(item.spot_id for item in requested),
        constraints.end_spot_id,
    ]
    stop_ids = ["origin", *(f"stop-{index}" for index in range(len(requested))), "destination"]

    for item in requested:
        spot = spots.get(item.spot_id)
        if (
            spot is None
            or spot.area_id != constraints.area_id
            or spot.opening_status != "verified"
            or not set(spot.evidence_ids) <= evidence_ids
            or (spot.reservation_required is not False and not item.reservation_confirmed)
        ):
            return None
    for pair in pairwise(sequence):
        route = routes.get(pair)
        if (
            route is None
            or route_counts[pair] != 1
            or not set(route.evidence_ids) <= evidence_ids
        ):
            return None

    current_time = constraints.start_at
    origin = spots[constraints.start_spot_id]
    stops = [
        Stop(
            id="origin",
            spot_id=origin.id,
            role="origin",
            requirement=None,
            arrival_at=current_time,
            start_at=current_time,
            departure_at=current_time,
            locked_start_at=None,
            opening_wait_seconds=0,
            queue_seconds=0,
            schedule_wait_seconds=0,
            evidence_ids=origin.evidence_ids,
        )
    ]
    legs: list[Leg] = []
    for index, item in enumerate(requested):
        route = routes[(sequence[index], sequence[index + 1])]
        legs.append(_make_leg(route, stop_ids[index], stop_ids[index + 1]))
        arrival = current_time + timedelta(
            seconds=route.duration_seconds + LEG_BUFFER_SECONDS
        )
        spot = spots[item.spot_id]
        queue_seconds = waits.get(spot.id, 0)
        scheduled = _schedule_visit(
            arrival,
            item,
            spot,
            queue_seconds,
            candidate_starts.get(spot.id),
        )
        if scheduled is None:
            return None
        start, departure, opening_wait, schedule_wait = scheduled
        stops.append(
            Stop(
                id=stop_ids[index + 1],
                spot_id=spot.id,
                role="visit",
                requirement=item.requirement,
                arrival_at=arrival,
                start_at=start,
                departure_at=departure,
                locked_start_at=item.locked_start_at,
                opening_wait_seconds=opening_wait,
                queue_seconds=queue_seconds,
                schedule_wait_seconds=schedule_wait,
                evidence_ids=spot.evidence_ids,
            )
        )
        current_time = departure

    route = routes[(sequence[-2], sequence[-1])]
    legs.append(_make_leg(route, stop_ids[-2], stop_ids[-1]))
    destination_at = current_time + timedelta(
        seconds=route.duration_seconds + LEG_BUFFER_SECONDS
    )
    walk_meters = sum(leg.distance_meters for leg in legs)
    if walk_meters > constraints.max_walk_meters or destination_at > constraints.end_at:
        return None
    destination = spots[constraints.end_spot_id]
    stops.append(
        Stop(
            id="destination",
            spot_id=destination.id,
            role="destination",
            requirement=None,
            arrival_at=destination_at,
            start_at=destination_at,
            departure_at=destination_at,
            locked_start_at=None,
            opening_wait_seconds=0,
            queue_seconds=0,
            schedule_wait_seconds=0,
            evidence_ids=destination.evidence_ids,
        )
    )
    unknown_waits = [item.spot_id for item in requested if item.spot_id not in waits]
    metrics = Metrics(
        walk_meters=walk_meters,
        travel_seconds=sum(leg.duration_seconds for leg in legs),
        total_seconds=int((destination_at - constraints.start_at).total_seconds()),
        finish_slack_seconds=int((constraints.end_at - destination_at).total_seconds()),
        modeled_queue_seconds=sum(stop.queue_seconds for stop in stops),
        schedule_wait_seconds=sum(stop.schedule_wait_seconds for stop in stops),
        avoid_overlap_seconds=_avoid_overlap_seconds(stops, context),
        optional_kept_count=optional_kept_count,
        optional_replaced_count=optional_replaced_count,
        optional_removed_count=0,
        wait_not_included_spot_ids=unknown_waits,
    )
    facts, explanation, warnings = _candidate_facts(
        context,
        strategy=strategy,
        requested=requested,
        metrics=metrics,
        unknown_waits=unknown_waits,
    )
    return Plan(
        id=plan_id,
        strategy=strategy,
        stops=stops,
        legs=legs,
        metrics=metrics,
        facts=facts,
        explanation=explanation,
        changes=[],
        warnings=warnings,
    )


def _candidate_facts(
    context: PlanningContext,
    *,
    strategy: str,
    requested: tuple[RequestedStop, ...],
    metrics: Metrics,
    unknown_waits: list[str],
) -> tuple[list[Fact], Explanation, list[str]]:
    locale = context.effective_constraints.locale
    is_demo = any(spot.is_demo for spot in context.spots)
    if strategy == "time_shift":
        reason_id = "time-shift-reason"
        tradeoff_id = "time-shift-tradeoff"
        reason = (
            "訪問先を保ち、順序または開始時刻を変更した時間案です。"
            if locale == "ja"
            else "This time option keeps every visit while changing order or start time."
        )
        tradeoff = (
            f"予定調整の待機は合計{metrics.schedule_wait_seconds // 60}分です。"
            if locale == "ja"
            else f"This option includes {metrics.schedule_wait_seconds // 60} minutes of schedule waiting."
        )
    else:
        reason_id = "place-shift-reason"
        tradeoff_id = "place-shift-tradeoff"
        reason = (
            "mustを保ち、optionalを希望する体験に関係する候補へ交換した場所案です。"
            if locale == "ja"
            else "This place option keeps every must and replaces an optional with a relevant experience."
        )
        tradeoff = (
            "元のoptionalの体験は失われ、移動と営業時間の条件も変わります。"
            if locale == "ja"
            else "The original optional experience is lost, and travel and opening constraints change."
        )
    facts = [
        Fact(id=reason_id, kind="change", text=reason, evidence_ids=[], is_demo=is_demo),
        Fact(
            id=tradeoff_id,
            kind="tradeoff",
            text=tradeoff,
            evidence_ids=[],
            is_demo=is_demo,
        ),
    ]
    warnings: list[str] = []
    uncertainty_ids: list[str] = []
    if unknown_waits:
        warning = (
            "待ち時間が未入力の訪問先は計算に含めていません。空いているという意味ではありません。"
            if locale == "ja"
            else "Unspecified waits are not included; this does not mean those spots are empty."
        )
        facts.append(
            Fact(
                id=f"{strategy}-unknown-waits",
                kind="uncertainty",
                text=warning,
                evidence_ids=[],
                is_demo=is_demo,
            )
        )
        warnings.append(warning)
        uncertainty_ids.append(f"{strategy}-unknown-waits")
    explanation = Explanation(
        summary=reason,
        reason_fact_ids=[reason_id],
        tradeoff_fact_ids=[tradeoff_id],
        uncertainty_fact_ids=uncertainty_ids,
        generation_mode="template",
    )
    return facts, explanation, warnings


def _meaningful_time_candidate(
    candidate: Plan,
    baseline: Plan | None,
    requested: tuple[RequestedStop, ...],
) -> bool:
    if baseline is None:
        return [stop.spot_id for stop in candidate.stops[1:-1]] != [
            item.spot_id for item in requested
        ]
    candidate_ids = [stop.spot_id for stop in candidate.stops[1:-1]]
    baseline_ids = [stop.spot_id for stop in baseline.stops[1:-1]]
    if candidate_ids != baseline_ids:
        return True
    differences = [
        abs(int((candidate_stop.start_at - baseline_stop.start_at).total_seconds()))
        for candidate_stop, baseline_stop in zip(
            candidate.stops[1:-1], baseline.stops[1:-1], strict=True
        )
    ]
    return max(differences, default=0) >= MIN_SAME_ORDER_SHIFT_SECONDS


def _improves_time_candidate(candidate: Plan, baseline: Plan | None) -> bool:
    if baseline is None:
        return True
    if candidate.metrics.avoid_overlap_seconds < baseline.metrics.avoid_overlap_seconds:
        return True
    return (
        baseline.metrics.avoid_overlap_seconds == 0
        and (
            candidate.metrics.walk_meters < baseline.metrics.walk_meters
            or candidate.metrics.travel_seconds < baseline.metrics.travel_seconds
        )
    )


def _time_changes(candidate: Plan, baseline: Plan | None) -> list[PlanChange]:
    if baseline is None:
        return [
            PlanChange(
                kind="time_shift",
                original_spot_id=stop.spot_id,
                replacement_spot_id=None,
                before_start_at=None,
                after_start_at=stop.start_at,
                reason_fact_ids=["time-shift-reason"],
            )
            for stop in candidate.stops[1:-1]
        ]
    baseline_starts = {stop.spot_id: stop.start_at for stop in baseline.stops[1:-1]}
    changes = []
    for stop in candidate.stops[1:-1]:
        before = baseline_starts[stop.spot_id]
        if before != stop.start_at:
            changes.append(
                PlanChange(
                    kind="time_shift",
                    original_spot_id=stop.spot_id,
                    replacement_spot_id=None,
                    before_start_at=before,
                    after_start_at=stop.start_at,
                    reason_fact_ids=["time-shift-reason"],
                )
            )
    return changes


def _decorate_time_candidate(candidate: Plan, baseline: Plan | None, locale: str) -> Plan:
    if baseline is None:
        reason = (
            "元の順序は不成立でしたが、訪問先とmustを保った順序変更で成立する時間案です。"
            if locale == "ja"
            else "The original order was infeasible, but this reordered time option keeps every visit and must."
        )
        tradeoff = (
            f"予定調整の待機は{candidate.metrics.schedule_wait_seconds // 60}分、歩行距離は{candidate.metrics.walk_meters}mです。"
            if locale == "ja"
            else f"Schedule waiting is {candidate.metrics.schedule_wait_seconds // 60} minutes and walking distance is {candidate.metrics.walk_meters} m."
        )
        overlap_reduction = 0
        walk_delta = 0
    else:
        overlap_reduction = (
            baseline.metrics.avoid_overlap_seconds - candidate.metrics.avoid_overlap_seconds
        )
        walk_delta = candidate.metrics.walk_meters - baseline.metrics.walk_meters
    if baseline is not None and overlap_reduction > 0:
        reason = (
            f"本人が避けたい時間帯との重複を{overlap_reduction // 60}分減らす時間案です。実際の混雑減少を示す値ではありません。"
            if locale == "ja"
            else f"This time option reduces overlap with the user's avoid window by {overlap_reduction // 60} minutes; it does not measure actual crowd reduction."
        )
    elif baseline is not None:
        reason = (
            "訪問先を保ったまま、入力された経路条件で移動負担を減らす時間案です。"
            if locale == "ja"
            else "This time option keeps every visit and reduces travel burden under the supplied route assumptions."
        )
    if baseline is not None:
        tradeoff = (
            f"予定調整の待機は{candidate.metrics.schedule_wait_seconds // 60}分、歩行距離の差は{walk_delta:+d}mです。"
            if locale == "ja"
            else f"Schedule waiting is {candidate.metrics.schedule_wait_seconds // 60} minutes and the walking-distance difference is {walk_delta:+d} m."
        )
    facts = [
        fact.model_copy(
            update={
                "text": reason if fact.id == "time-shift-reason" else tradeoff
            }
        )
        if fact.id in {"time-shift-reason", "time-shift-tradeoff"}
        else fact
        for fact in candidate.facts
    ]
    explanation = candidate.explanation.model_copy(update={"summary": reason})
    values = candidate.model_dump(mode="python")
    values.update(
        facts=facts,
        explanation=explanation,
        changes=_time_changes(candidate, baseline),
    )
    return Plan.model_validate(values)


def build_time_shift(
    context: PlanningContext,
    baseline: Plan | None,
    *,
    deadline_monotonic: float,
) -> tuple[Plan | None, int, bool]:
    requested = tuple(context.trip.requested_stops)
    optional_count = sum(item.requirement == "optional" for item in requested)
    candidates: list[Plan] = []
    expansions = 0
    exhausted = False

    orders = permutations(requested)
    for order in orders:
        if expansions >= MAX_EXPANSIONS or time.monotonic() >= deadline_monotonic:
            exhausted = True
            break
        if order == requested:
            continue
        expansions += 1
        candidate = _candidate_schedule(
            context,
            order,
            strategy="time_shift",
            plan_id=f"plan-time-{expansions}",
            optional_kept_count=optional_count,
            optional_replaced_count=0,
        )
        if (
            candidate
            and _meaningful_time_candidate(candidate, baseline, requested)
            and _improves_time_candidate(candidate, baseline)
        ):
            candidates.append(candidate)

    for window in context.effective_constraints.avoid_windows:
        if expansions >= MAX_EXPANSIONS or time.monotonic() >= deadline_monotonic:
            exhausted = True
            break
        if window.spot_id not in {item.spot_id for item in requested}:
            continue
        expansions += 1
        candidate = _candidate_schedule(
            context,
            requested,
            strategy="time_shift",
            plan_id=f"plan-time-{expansions}",
            candidate_starts={window.spot_id: window.ends_at},
            optional_kept_count=optional_count,
            optional_replaced_count=0,
        )
        if (
            candidate
            and _meaningful_time_candidate(candidate, baseline, requested)
            and _improves_time_candidate(candidate, baseline)
        ):
            candidates.append(candidate)

    if not candidates:
        return None, expansions, exhausted
    best = min(
        candidates,
        key=lambda plan: (
            plan.metrics.avoid_overlap_seconds,
            plan.metrics.schedule_wait_seconds,
            plan.metrics.walk_meters,
            plan.metrics.total_seconds,
        ),
    )
    return (
        _decorate_time_candidate(best, baseline, context.effective_constraints.locale),
        expansions,
        exhausted,
    )


def _place_changes(
    candidate: Plan,
    baseline: Plan | None,
    original_spot_id: str,
    replacement_spot_id: str,
) -> list[PlanChange]:
    before = (
        next(stop.start_at for stop in baseline.stops if stop.spot_id == original_spot_id)
        if baseline is not None
        else None
    )
    after = next(stop.start_at for stop in candidate.stops if stop.spot_id == replacement_spot_id)
    return [
        PlanChange(
            kind="place_replacement",
            original_spot_id=original_spot_id,
            replacement_spot_id=replacement_spot_id,
            before_start_at=before,
            after_start_at=after,
            reason_fact_ids=["place-shift-reason"],
        )
    ]


def _interest_text(values: set[str], locale: str) -> str:
    labels = {
        "history": ("歴史", "history"),
        "photography": ("写真", "photography"),
        "nature": ("自然", "nature"),
        "food": ("食", "food"),
        "art": ("芸術", "art"),
        "quiet": ("静かな環境", "quiet atmosphere"),
    }
    index = 0 if locale == "ja" else 1
    return ", ".join(labels[value][index] for value in sorted(values)) or (
        "明示なし" if locale == "ja" else "none stated"
    )


def _decorate_place_candidate(
    context: PlanningContext,
    candidate: Plan,
    baseline: Plan | None,
    original: Spot,
    replacement: Spot,
) -> Plan:
    locale = context.effective_constraints.locale
    original_name = original.name_ja if locale == "ja" else original.name_en
    replacement_name = replacement.name_ja if locale == "ja" else replacement.name_en
    common = set(original.tags) & set(replacement.tags)
    gained = set(replacement.tags) - set(original.tags)
    lost = set(original.tags) - set(replacement.tags)
    walk_delta = (
        candidate.metrics.walk_meters - baseline.metrics.walk_meters
        if baseline is not None
        else None
    )
    reason = (
        f"{replacement_name}は、希望に関係する{_interest_text(set(replacement.tags) & set(context.effective_constraints.interests), locale)}を含む交換先です。元の{original_name}との共通点は{_interest_text(common, locale)}です。"
        if locale == "ja"
        else f"{replacement_name} is a replacement related to the requested {_interest_text(set(replacement.tags) & set(context.effective_constraints.interests), locale)} experience. It shares {_interest_text(common, locale)} with {original_name}."
    )
    if walk_delta is None:
        tradeoff = (
            f"{original_name}を外すため{_interest_text(lost, locale)}を失い、{_interest_text(gained, locale)}が加わります。元の概要: {original.description_ja} 交換先の概要: {replacement.description_ja} 歩行距離は{candidate.metrics.walk_meters}mです。"
            if locale == "ja"
            else f"Replacing {original_name} loses {_interest_text(lost, locale)} and adds {_interest_text(gained, locale)}. Original: {original.description_en} Replacement: {replacement.description_en} Walking distance is {candidate.metrics.walk_meters} m."
        )
    else:
        tradeoff = (
            f"{original_name}を外すため{_interest_text(lost, locale)}を失い、{_interest_text(gained, locale)}が加わります。元の概要: {original.description_ja} 交換先の概要: {replacement.description_ja} 歩行距離の差は{walk_delta:+d}mです。"
            if locale == "ja"
            else f"Replacing {original_name} loses {_interest_text(lost, locale)} and adds {_interest_text(gained, locale)}. Original: {original.description_en} Replacement: {replacement.description_en} The walking-distance difference is {walk_delta:+d} m."
        )
    evidence_ids = list(dict.fromkeys([*original.evidence_ids, *replacement.evidence_ids]))
    facts = [
        fact.model_copy(
            update={
                "text": reason if fact.id == "place-shift-reason" else tradeoff,
                "evidence_ids": evidence_ids,
            }
        )
        if fact.id in {"place-shift-reason", "place-shift-tradeoff"}
        else fact
        for fact in candidate.facts
    ]
    explanation = candidate.explanation.model_copy(update={"summary": reason})
    values = candidate.model_dump(mode="python")
    values.update(
        facts=facts,
        explanation=explanation,
        changes=_place_changes(candidate, baseline, original.id, replacement.id),
    )
    return Plan.model_validate(values)


def build_place_shift(
    context: PlanningContext,
    baseline: Plan | None,
    *,
    deadline_monotonic: float,
    expansion_offset: int = 0,
) -> tuple[Plan | None, int, bool]:
    requested = tuple(context.trip.requested_stops)
    optional_indices = [
        index for index, item in enumerate(requested) if item.requirement == "optional"
    ]
    selected_ids = {item.spot_id for item in requested}
    constraints = context.effective_constraints
    alternatives = [
        spot
        for spot in context.spots
        if spot.id not in selected_ids
        and spot.id not in {constraints.start_spot_id, constraints.end_spot_id}
        and spot.area_id == constraints.area_id
        and spot.opening_status == "verified"
        and spot.reservation_required is False
        and set(spot.tags) & set(constraints.interests)
    ]
    optional_count = len(optional_indices)
    candidates: list[tuple[int, Plan]] = []
    expansions = 0
    exhausted = False

    for index in optional_indices:
        for spot in alternatives:
            if expansion_offset + expansions >= MAX_EXPANSIONS or time.monotonic() >= deadline_monotonic:
                exhausted = True
                break
            expansions += 1
            replaced = list(requested)
            replaced[index] = RequestedStop(
                spot_id=spot.id,
                requirement="optional",
                locked_start_at=None,
                reservation_confirmed=False,
            )
            candidate = _candidate_schedule(
                context,
                tuple(replaced),
                strategy="place_shift",
                plan_id=f"plan-place-{expansions}",
                optional_kept_count=optional_count - 1,
                optional_replaced_count=1,
            )
            if candidate:
                match_count = len(set(spot.tags) & set(constraints.interests))
                original = next(item for item in context.spots if item.id == requested[index].spot_id)
                candidates.append(
                    (
                        match_count,
                        _decorate_place_candidate(
                            context,
                            candidate,
                            baseline,
                            original,
                            spot,
                        ),
                    )
                )
        if exhausted:
            break

    if not candidates:
        return None, expansions, exhausted
    _, best = min(
        candidates,
        key=lambda item: (
            -item[0],
            len(item[1].metrics.wait_not_included_spot_ids),
            item[1].metrics.walk_meters,
            item[1].metrics.travel_seconds,
            tuple(stop.spot_id for stop in item[1].stops),
        ),
    )
    return best, expansions, exhausted


def _alternative_warning(context: PlanningContext, strategy: str, baseline: Plan | None) -> str:
    """Say why an option is missing and, when the user can change it, what to change."""
    locale = context.effective_constraints.locale
    requested = context.trip.requested_stops
    windows = context.effective_constraints.avoid_windows

    def text(ja: str, en: str) -> str:
        return ja if locale == "ja" else en

    if strategy == "time_shift":
        if not windows:
            if len(requested) == 1:
                return text(
                    "訪問先が1か所で、避けたい時間帯の指定もないため、時間案（順序や時刻を変える案）は作れません。詳細条件で避けたい時間帯を指定すると提案できます。",
                    "With one visit and no time to avoid, there is no time-shift option (changing order or start times). Add a time you prefer to avoid under Details to get one.",
                )
            return text(
                "避けたい時間帯の指定がなく、訪問順を変えても移動の負担が減らないため、時間案は作れませんでした。詳細条件で避けたい時間帯を指定すると提案できます。",
                "No time to avoid was given and no other visit order reduces travel, so there is no time-shift option. Add a time you prefer to avoid under Details to get one.",
            )
        if baseline is not None and baseline.metrics.avoid_overlap_seconds == 0:
            return text(
                "元案はすでに避けたい時間帯と重なっていないため、時間案は作りませんでした。",
                "The original plan already stays out of the times you prefer to avoid, so no time-shift option was needed.",
            )
        return text(
            "営業時間・終了時刻・歩行上限などの条件の範囲で、避けたい時間帯との重なりを減らせる時刻や順序が見つからず、時間案は作れませんでした。",
            "No start time or visit order within the opening hours, end time and walking limit reduces the overlap with the times you prefer to avoid, so there is no time-shift option.",
        )
    if not any(stop.requirement == "optional" for stop in requested):
        return text(
            "すべての訪問先が「必ずこの場所に行く」のため、場所案（訪問先を入れ替える案）は作れません。1か所以上を「体験が合えば別の場所でもよい」にすると提案できます。",
            "Every visit is marked \"I must visit this place\", so there is no place-shift option (swapping a visit). Mark at least one visit \"A similar experience elsewhere is welcome\" to get one.",
        )
    return text(
        "「体験が合えば別の場所でもよい」訪問先と入れ替えられる、楽しみたい体験に合う候補が、営業時間・終了時刻・歩行上限などの条件の範囲で見つからず、場所案は作れませんでした。",
        "No candidate matching the experiences you enjoy could replace a flexible visit within the opening hours, end time and walking limit, so there is no place-shift option.",
    )


def _recoverable_for_alternatives(
    violation: Violation,
    requested: tuple[RequestedStop, ...],
) -> bool:
    if violation.code == "ROUTE_UNKNOWN":
        return True
    optional_ids = {
        item.spot_id for item in requested if item.requirement == "optional"
    }
    return violation.code in {
        "CLOSED",
        "OPENING_UNKNOWN",
        "RESERVATION_REQUIRED",
    } and violation.spot_id in optional_ids


def resolve_omakase(context: PlanningContext) -> tuple[PlanningContext, dict[str, set[str]], int]:
    """Fill each お任せ slot with a verified spot that matches the interests and fits the route.

    Every candidate is tried at every position with the normal scheduler, so a pick always respects opening
    hours, the walking limit and the return time. Best = most matching interests, then shortest walk, then
    shortest day. Returns the context with concrete requested stops, the picks (spot id -> matching
    interests) and how many slots could not be filled.
    """
    constraints = context.effective_constraints
    slots = constraints.omakase_visits
    if slots == 0:
        return context, {}, 0
    interests = set(constraints.interests)
    requested = list(context.trip.requested_stops)
    taken = {stop.spot_id for stop in requested} | {constraints.start_spot_id, constraints.end_spot_id}
    candidates = [
        spot
        for spot in sorted(context.spots, key=lambda item: item.id)
        if spot.id not in taken
        and spot.area_id == constraints.area_id
        and spot.stay_seconds > 0
        and spot.opening_status == "verified"
        and spot.reservation_required is False
        and set(spot.tags) & interests
    ]
    picks: dict[str, set[str]] = {}
    for _ in range(slots):
        best = None
        for spot in candidates:
            if spot.id in picks:
                continue
            for index in range(len(requested) + 1):
                trial = [*requested]
                trial.insert(index, RequestedStop(spot_id=spot.id, requirement="optional"))
                plan = _candidate_schedule(
                    context,
                    tuple(trial),
                    strategy="baseline",
                    plan_id="plan-omakase-trial",
                    optional_kept_count=0,
                    optional_replaced_count=0,
                )
                if plan is None:
                    continue
                score = (-len(set(spot.tags) & interests), plan.metrics.walk_meters, plan.metrics.total_seconds, spot.id)
                if best is None or score < best[0]:
                    best = (score, spot, trial)
        if best is None:
            break
        _, spot, requested = best
        picks[spot.id] = set(spot.tags) & interests
    trip = context.trip.model_copy(update={"requested_stops": requested})
    return replace(context, trip=trip), picks, slots - len(picks)


def _omakase_fact(context: PlanningContext, spot: Spot, matched: set[str]) -> Fact:
    locale = context.effective_constraints.locale
    name = spot.name_ja if locale == "ja" else spot.name_en
    return Fact(
        id=f"omakase-{spot.id}",
        kind="interest",
        text=(
            f"お任せ枠として、楽しみたい体験（{_interest_text(matched, locale)}）に合い、営業時間と移動の条件に収まる{name}を選びました。"
            if locale == "ja"
            else f"For your \"leave it to us\" slot, {name} was chosen: it matches {_interest_text(matched, locale)} and fits the opening hours and walking route."
        ),
        evidence_ids=list(spot.evidence_ids),
        is_demo=spot.is_demo,
    )


def _with_omakase_facts(context: PlanningContext, plan: Plan | None, picks: dict[str, set[str]]) -> Plan | None:
    """Explain in every plan that still visits an お任せ pick why that spot was chosen."""
    if plan is None:
        return None
    spots = {spot.id: spot for spot in context.spots}
    facts = [_omakase_fact(context, spots[stop.spot_id], picks[stop.spot_id]) for stop in plan.stops[1:-1] if stop.spot_id in picks]
    if not facts:
        return plan
    values = plan.model_dump(mode="python")
    values["facts"] = [*plan.facts, *facts]
    values["explanation"] = plan.explanation.model_copy(
        update={"reason_fact_ids": [*plan.explanation.reason_fact_ids, *(fact.id for fact in facts)]}
    )
    return Plan.model_validate(values)


def _omakase_warning(locale: str, missing: int) -> str:
    return (
        f"お任せ枠のうち{missing}件は、楽しみたい体験に合い条件内に収まる場所が見つからなかったため追加していません。"
        if locale == "ja"
        else f"{missing} \"leave it to us\" slot(s) were not filled: no place matching your interests fits within the conditions."
    )


class BaselinePlanner:
    """Generate the baseline and at most one time and one place alternative."""

    async def generate(self, context: PlanningContext) -> EngineResult:
        """Fill お任せ slots first, then plan with the concrete visits exactly as if the user had chosen them."""
        resolved, picks, missing = resolve_omakase(context)
        locale = context.effective_constraints.locale
        if not resolved.trip.requested_stops:
            violation = _violation(
                "NO_CANDIDATE",
                "お任せ枠に合う場所が、楽しみたい体験と条件の範囲で見つかりませんでした。",
                "No place for your \"leave it to us\" slot matches your interests within the conditions.",
                "楽しみたい体験・終了時刻・歩行上限を変えるか、行きたい場所を選んでください。",
                "Change your interests, end time or walking limit, or choose a place yourself.",
                locale=locale,
            )
            return EngineResult(baseline=None, alternatives=(), violations=(violation,), warnings=(), evidence=context.evidence, status="no_feasible_plan")
        result = await self._generate(resolved)
        if picks or missing:
            result = replace(
                result,
                baseline=_with_omakase_facts(resolved, result.baseline, picks),
                alternatives=tuple(_with_omakase_facts(resolved, plan, picks) for plan in result.alternatives),
                warnings=(*result.warnings, *([_omakase_warning(locale, missing)] if missing else [])),
            )
        # Explain last, so the model also sees the お任せ reasons.
        return await _explain_result(resolved, result)

    async def _generate(self, context: PlanningContext) -> EngineResult:
        remaining_seconds(context.deadline_monotonic, 25.0)
        input_violations = validate_planning_input(context)
        requested = tuple(context.trip.requested_stops)
        if input_violations and not all(
            _recoverable_for_alternatives(item, requested) for item in input_violations
        ):
            return EngineResult(
                baseline=None,
                alternatives=(),
                violations=input_violations,
                warnings=(),
                evidence=context.evidence,
                status="no_feasible_plan",
            )
        baseline, violations = build_baseline(context)
        search_deadline = min(
            context.deadline_monotonic,
            time.monotonic() + SEARCH_LIMIT_SECONDS,
        )
        time_plan, time_expansions, time_exhausted = build_time_shift(
            context,
            baseline,
            deadline_monotonic=search_deadline,
        )
        place_plan, _, place_exhausted = build_place_shift(
            context,
            baseline,
            deadline_monotonic=search_deadline,
            expansion_offset=time_expansions,
        )
        alternatives = tuple(plan for plan in (time_plan, place_plan) if plan is not None)
        if baseline is None and not alternatives:
            return EngineResult(
                baseline=None,
                alternatives=(),
                violations=violations,
                warnings=(),
                evidence=context.evidence,
                status="no_feasible_plan",
            )
        warnings = []
        if time_plan is None:
            warnings.append(_alternative_warning(context, "time_shift", baseline))
        if place_plan is None:
            warnings.append(_alternative_warning(context, "place_shift", baseline))
        if time_exhausted or place_exhausted:
            warnings.append(
                "探索上限内で検証できた案だけを返しました。"
                if context.effective_constraints.locale == "ja"
                else "Only candidates validated within the search limit are returned."
            )
        return EngineResult(
            baseline=baseline,
            alternatives=alternatives,
            violations=violations,
            warnings=tuple(warnings),
            evidence=context.evidence,
            status="complete",
        )


EXPLANATION_FALLBACK = "EXPLANATION_FALLBACK"


async def _explain_result(context: PlanningContext, result: EngineResult) -> EngineResult:
    """Explain every plan in parallel within the shared deadline. If any explanation falls back, the
    plans stay valid and the result is partial with EXPLANATION_FALLBACK (docs/API.md, PLANNER.md)."""
    if context.explainer is None or result.status == "no_feasible_plan":
        return result
    plans = ([result.baseline] if result.baseline is not None else []) + list(result.alternatives)
    explained = await asyncio.gather(*(_explain_plan(context, plan) for plan in plans))
    fell_back = any(not ok for _, ok in explained)
    explained_plans = [plan for plan, _ in explained]
    baseline = explained_plans.pop(0) if result.baseline is not None else None
    return replace(
        result,
        baseline=baseline,
        alternatives=tuple(explained_plans),
        warnings=(*result.warnings, EXPLANATION_FALLBACK) if fell_back else result.warnings,
        status="partial" if fell_back else result.status,
    )


async def _explain_plan(context: PlanningContext, plan: Plan) -> tuple[Plan, bool]:
    """Replace only Explanation. On any provider failure keep the planner's own template explanation
    (never discard a valid Plan) and report the fallback."""
    request = ExplanationInput(
        locale=context.effective_constraints.locale,
        facts=tuple(plan.facts),
    )
    try:
        explanation = await context.explainer.explain(
            request,
            context.deadline_monotonic,
        )
        if explanation.generation_mode != "gemini":
            return plan, False
        values = plan.model_dump(mode="python")
        values["explanation"] = explanation
        return Plan.model_validate(values), True
    except Exception:  # noqa: BLE001 -- an optional provider must never discard a valid Plan
        return plan, False
