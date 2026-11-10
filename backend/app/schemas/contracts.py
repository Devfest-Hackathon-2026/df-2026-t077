"""v3 transport contract. Provider facts, ownership and transactions are service checks."""
from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, create_model, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
Locale = Literal["ja", "en"]
Interest = Literal["history", "photography", "nature", "food", "art", "quiet"]
SourceKind = Literal["measured", "estimated", "curated", "user_observed", "user_assumption", "user_preference", "demo", "unknown"]
Nonnegative = Annotated[int, Field(ge=0)]
JST = ZoneInfo("Asia/Tokyo")


def unique(values, label):
    if len(values) != len(set(values)):
        raise ValueError(f"{label} must be unique")


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Location(DTO):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Evidence(DTO):
    id: Identifier
    source_kind: SourceKind
    provider: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    source_url: str | None
    checked_at: AwareDatetime | None
    confidence: Literal["high", "medium", "low", "unknown"]
    is_demo: bool
    note: str = Field(max_length=1000)

    @model_validator(mode="after")
    def evidence_valid(self):
        if self.source_url is not None:
            url = urlsplit(self.source_url)
            if url.scheme not in {"http", "https"} or not url.netloc or url.username or url.password:
                raise ValueError("source_url must be an http(s) URL without credentials")
        if self.source_kind == "demo" and not self.is_demo:
            raise ValueError("demo evidence requires a demo label")
        return self


class OpeningWindow(DTO):
    opens_at: AwareDatetime
    closes_at: AwareDatetime

    @model_validator(mode="after")
    def ordered(self):
        if self.opens_at >= self.closes_at:
            raise ValueError("opening window must have a positive duration")
        return self


class Spot(DTO):
    id: Identifier
    area_id: Identifier
    google_place_id: str | None
    name_ja: str = Field(min_length=1, max_length=200)
    name_en: str = Field(min_length=1, max_length=200)
    description_ja: str = Field(min_length=1, max_length=2000)
    description_en: str = Field(min_length=1, max_length=2000)
    visitor_info_ja: str = Field(min_length=1, max_length=2000)
    visitor_info_en: str = Field(min_length=1, max_length=2000)
    reservation_required: bool | None
    location: Location
    tags: list[Interest] = Field(max_length=6)
    stay_seconds: int = Field(ge=0, le=14400)
    opening_status: Literal["verified", "closed", "unknown"]
    opening_windows: list[OpeningWindow] = Field(max_length=8)
    evidence_ids: list[Identifier]
    is_demo: bool

    @model_validator(mode="after")
    def validate_spot(self):
        unique(self.tags, "tags")
        if self.opening_status == "verified" and not self.opening_windows:
            raise ValueError("verified opening requires a window")
        return self


class SpotListResponse(DTO):
    items: list[Spot] = Field(max_length=12)
    evidence: list[Evidence]

    @model_validator(mode="after")
    def references(self):
        unique([s.id for s in self.items], "spot ids")
        unique([e.id for e in self.evidence], "evidence ids")
        ids = {e.id for e in self.evidence}
        if any(not set(s.evidence_ids) <= ids for s in self.items):
            raise ValueError("unknown spot evidence")
        return self


class RequestedStop(DTO):
    spot_id: Identifier
    requirement: Literal["must", "optional"]
    locked_start_at: AwareDatetime | None = None
    reservation_confirmed: bool = False

    @model_validator(mode="after")
    def fixed_requires_must(self):
        if (self.locked_start_at is not None or self.reservation_confirmed) and self.requirement != "must":
            raise ValueError("fixed time or confirmed reservation requires must")
        return self


class AvoidWindow(DTO):
    id: Identifier
    spot_id: Identifier
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    basis: Literal["user_preference", "curated_guidance", "demo_assumption"]
    evidence_ids: list[Identifier] = Field(default_factory=list)
    note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def ordered(self):
        if self.starts_at >= self.ends_at:
            raise ValueError("avoid window must have a positive duration")
        if self.basis == "curated_guidance" and not self.evidence_ids:
            raise ValueError("guidance requires server-verified evidence references")
        return self


class WaitAssumption(DTO):
    spot_id: Identifier
    wait_seconds: int = Field(ge=0, le=10800)
    basis: Literal["user_observed", "user_assumption", "demo_assumption"]
    observed_at: AwareDatetime | None = None
    note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def observed_requires_time(self):
        if self.basis == "user_observed" and self.observed_at is None:
            raise ValueError("user observation requires observed_at")
        return self


def check_preferences(value):
    if value.interests is not None:
        unique(value.interests, "interests")
    if value.wait_assumptions is not None:
        unique([w.spot_id for w in value.wait_assumptions], "wait spots")
    if value.avoid_windows is not None:
        unique([w.id for w in value.avoid_windows], "avoid window ids")
        ordered = sorted(value.avoid_windows, key=lambda w: (w.spot_id, w.starts_at))
        for left, right in zip(ordered, ordered[1:]):
            if left.spot_id == right.spot_id and right.starts_at < left.ends_at:
                raise ValueError("avoid windows for the same spot must not overlap")


class TripConstraints(DTO):
    area_id: Identifier
    timezone: Literal["Asia/Tokyo"]
    start_at: AwareDatetime
    end_at: AwareDatetime
    start_spot_id: Identifier
    end_spot_id: Identifier
    mode: Literal["walking"]
    max_walk_meters: int = Field(ge=100, le=30000)
    max_visits: int = Field(ge=1, le=6)
    interests: list[Interest] = Field(min_length=1, max_length=6)
    party_size: int = Field(ge=1, le=10)
    locale: Locale
    avoid_windows: list[AvoidWindow] = Field(max_length=6)
    wait_assumptions: list[WaitAssumption] = Field(max_length=2)
    # "お任せ" slots: the planner picks verified spots matching interests and fits them into the route.
    omakase_visits: int = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def valid_constraints(self):
        if self.start_at >= self.end_at or self.start_at.astimezone(JST).date() != self.end_at.astimezone(JST).date():
            raise ValueError("trip must start and finish on the same Japan date, end after start")
        check_preferences(self)
        for window in self.avoid_windows:
            if not self.start_at <= window.starts_at < window.ends_at <= self.end_at:
                raise ValueError("avoid window must be inside the trip")
        return self


class ConstraintOverrides(DTO):
    max_walk_meters: int | None = Field(default=None, ge=100, le=30000)
    interests: list[Interest] | None = Field(default=None, min_length=1, max_length=6)
    end_at: AwareDatetime | None = None
    avoid_windows: list[AvoidWindow] | None = Field(default=None, max_length=6)
    wait_assumptions: list[WaitAssumption] | None = Field(default=None, max_length=2)
    locale: Locale | None = None

    @model_validator(mode="after")
    def valid_preferences(self):
        check_preferences(self)
        return self


partial_fields = {}
for name, field in TripConstraints.model_fields.items():
    optional = deepcopy(field)
    optional.default = None
    partial_fields[name] = (field.annotation | None, optional)
PartialConstraints = create_model("PartialConstraints", __base__=DTO, **partial_fields)


class PartialTripInput(DTO):
    constraints: PartialConstraints | None = None
    requested_stops: list[RequestedStop] | None = Field(default=None, max_length=6)


class IntentInterpretRequest(DTO):
    client_request_id: UUID
    area_id: Identifier
    visit_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    locale: Locale
    text: str = Field(min_length=1, max_length=2000)
    current_input: PartialTripInput

    @model_validator(mode="after")
    def real_date(self):
        from datetime import date
        date.fromisoformat(self.visit_date)
        if not self.text.strip():
            raise ValueError("intent text cannot be blank")
        return self


class FieldNote(DTO):
    field: str
    source_quote: str


class UnresolvedField(FieldNote):
    question: str


class IntentDraft(DTO):
    interests: list[Interest] | None
    requested_stops: list[RequestedStop]
    max_walk_meters: int | None = Field(ge=100, le=30000)
    end_at: AwareDatetime | None
    avoid_windows: list[AvoidWindow] = Field(max_length=6)
    wait_assumptions: list[WaitAssumption] = Field(max_length=2)
    field_notes: list[FieldNote]


class IntentDraftResponse(DTO):
    draft: IntentDraft
    unresolved: list[UnresolvedField]
    warnings: list[str]
    generation_mode: Literal["gemini", "template"]
    requires_confirmation: Literal[True]


class TripCreateRequest(DTO):
    client_request_id: UUID
    constraints: TripConstraints
    requested_stops: list[RequestedStop] = Field(max_length=6)
    intent_confirmed: Literal[True]

    @model_validator(mode="after")
    def requested_valid(self):
        c = self.constraints
        ids = [stop.spot_id for stop in self.requested_stops]
        unique(ids, "requested spots")
        if not 1 <= len(ids) + c.omakase_visits <= c.max_visits or sum(s.requirement == "must" for s in self.requested_stops) > 3:
            raise ValueError("need 1..max_visits visits including omakase slots, and at most 3 must stops")
        if {c.start_spot_id, c.end_spot_id} & set(ids):
            raise ValueError("origin/destination cannot be visits")
        for stop in self.requested_stops:
            if stop.locked_start_at and not c.start_at <= stop.locked_start_at < c.end_at:
                raise ValueError("fixed visit must be inside trip")
        if any(w.spot_id not in ids for w in [*c.avoid_windows, *c.wait_assumptions]):
            raise ValueError("input windows/waits must refer to a requested visit")
        return self


class ActiveSelection(DTO):
    proposal_id: Identifier
    plan_id: Identifier
    selected_at: AwareDatetime


class Trip(DTO):
    id: Identifier
    constraints: TripConstraints
    requested_stops: list[RequestedStop]
    version: int = Field(ge=1)
    active_selection: ActiveSelection | None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class ProposalRequest(DTO):
    client_request_id: UUID
    base_version: int = Field(ge=1)
    mode: Literal["initial", "refine"]
    constraint_overrides: ConstraintOverrides = Field(default_factory=ConstraintOverrides)


class Stop(DTO):
    id: Identifier
    spot_id: Identifier
    role: Literal["origin", "visit", "destination"]
    requirement: Literal["must", "optional"] | None
    arrival_at: AwareDatetime
    start_at: AwareDatetime
    departure_at: AwareDatetime
    locked_start_at: AwareDatetime | None
    opening_wait_seconds: Nonnegative
    queue_seconds: Nonnegative
    schedule_wait_seconds: Nonnegative
    evidence_ids: list[Identifier]

    @model_validator(mode="after")
    def valid_timing(self):
        if not self.arrival_at <= self.start_at <= self.departure_at:
            raise ValueError("invalid stop timing")
        waiting = self.opening_wait_seconds + self.queue_seconds + self.schedule_wait_seconds
        if (self.start_at - self.arrival_at).total_seconds() != waiting:
            raise ValueError("waiting breakdown differs from arrival/start")
        if self.role != "visit" and (self.arrival_at != self.departure_at or waiting or self.requirement is not None or self.locked_start_at is not None):
            raise ValueError("endpoints must be instantaneous and not visit requirements")
        if self.role == "visit" and self.requirement is None:
            raise ValueError("visit requires requirement")
        if self.locked_start_at is not None and (self.start_at != self.locked_start_at or self.requirement != "must"):
            raise ValueError("fixed start must be preserved")
        return self


class Leg(DTO):
    from_stop_id: Identifier
    to_stop_id: Identifier
    mode: Literal["walking"]
    duration_seconds: Nonnegative
    buffer_seconds: Nonnegative
    distance_meters: Nonnegative
    source_kind: SourceKind
    evidence_ids: list[Identifier]


class Metrics(DTO):
    walk_meters: Nonnegative
    travel_seconds: Nonnegative
    total_seconds: Nonnegative
    finish_slack_seconds: Nonnegative
    modeled_queue_seconds: Nonnegative
    schedule_wait_seconds: Nonnegative
    avoid_overlap_seconds: Nonnegative
    optional_kept_count: Nonnegative
    optional_replaced_count: Nonnegative
    optional_removed_count: Nonnegative
    wait_not_included_spot_ids: list[Identifier]


class Fact(DTO):
    id: Identifier
    kind: Literal["change", "interest", "travel", "timing", "opening", "tradeoff", "uncertainty"]
    text: str = Field(min_length=1, max_length=2000)
    evidence_ids: list[Identifier]
    is_demo: bool


class Explanation(DTO):
    summary: str = Field(min_length=1, max_length=2000)
    reason_fact_ids: list[Identifier]
    tradeoff_fact_ids: list[Identifier]
    uncertainty_fact_ids: list[Identifier]
    generation_mode: Literal["gemini", "template"]


class PlanChange(DTO):
    kind: Literal["time_shift", "place_replacement", "removal"]
    original_spot_id: Identifier
    replacement_spot_id: Identifier | None
    before_start_at: AwareDatetime | None
    after_start_at: AwareDatetime | None
    reason_fact_ids: list[Identifier]


class Plan(DTO):
    id: Identifier
    strategy: Literal["baseline", "time_shift", "place_shift"]
    stops: list[Stop] = Field(min_length=3, max_length=8)
    legs: list[Leg] = Field(min_length=2, max_length=7)
    metrics: Metrics
    facts: list[Fact]
    explanation: Explanation
    changes: list[PlanChange]
    warnings: list[str]

    @model_validator(mode="after")
    def structural_invariants(self):
        unique([s.id for s in self.stops], "stop ids")
        unique([s.spot_id for s in self.stops[1:-1]], "visit ids")
        unique([f.id for f in self.facts], "fact ids")
        if self.stops[0].role != "origin" or self.stops[-1].role != "destination" or any(s.role != "visit" for s in self.stops[1:-1]):
            raise ValueError("plan must be origin, visits, destination")
        if len(self.legs) != len(self.stops) - 1:
            raise ValueError("plan must include every leg including return")
        for left, leg, right in zip(self.stops, self.legs, self.stops[1:]):
            if (leg.from_stop_id, leg.to_stop_id) != (left.id, right.id):
                raise ValueError("disconnected leg")
            if right.arrival_at != left.departure_at + timedelta(seconds=leg.duration_seconds + leg.buffer_seconds):
                raise ValueError("leg timing differs from stops")
        facts = {f.id for f in self.facts}
        refs = [*self.explanation.reason_fact_ids, *self.explanation.tradeoff_fact_ids, *self.explanation.uncertainty_fact_ids]
        refs += [ref for change in self.changes for ref in change.reason_fact_ids]
        if not set(refs) <= facts:
            raise ValueError("unknown Fact reference")
        m = self.metrics
        checks = [
            m.walk_meters == sum(leg.distance_meters for leg in self.legs),
            m.travel_seconds == sum(leg.duration_seconds for leg in self.legs),
            m.total_seconds == int((self.stops[-1].arrival_at - self.stops[0].departure_at).total_seconds()),
            m.modeled_queue_seconds == sum(stop.queue_seconds for stop in self.stops),
            m.schedule_wait_seconds == sum(stop.schedule_wait_seconds for stop in self.stops),
            set(m.wait_not_included_spot_ids) <= {s.spot_id for s in self.stops[1:-1]},
        ]
        if not all(checks):
            raise ValueError("plan metrics disagree with itinerary")
        return self


class Violation(DTO):
    code: Literal["MUST_UNREACHABLE", "CLOSED", "OPENING_UNKNOWN", "TIME_LIMIT", "WALK_LIMIT", "LOCKED_TIME", "NO_CANDIDATE", "ROUTE_UNKNOWN", "RESERVATION_REQUIRED", "CONSTRAINT_CONFLICT"]
    spot_id: Identifier | None
    message: str
    suggested_action: str


class ProposalBundle(DTO):
    id: Identifier
    trip_id: Identifier
    base_version: int = Field(ge=1)
    request: ProposalRequest
    effective_constraints: TripConstraints
    baseline: Plan | None
    alternatives: list[Plan] = Field(max_length=2)
    evidence: list[Evidence]
    status: Literal["complete", "partial", "no_feasible_plan"]
    violations: list[Violation]
    warnings: list[str]
    created_at: AwareDatetime

    @model_validator(mode="after")
    def consistent_bundle(self):
        if self.base_version != self.request.base_version:
            raise ValueError("base version mismatch")
        plans = ([self.baseline] if self.baseline else []) + self.alternatives
        if self.status == "no_feasible_plan":
            if plans or not self.violations:
                raise ValueError("infeasible result requires violations and no plans")
        elif not plans:
            raise ValueError("feasible result requires a plan")
        if self.baseline and self.baseline.strategy != "baseline":
            raise ValueError("baseline strategy mismatch")
        unique([p.id for p in plans], "plan ids")
        unique([p.strategy for p in self.alternatives], "alternative strategies")
        unique([e.id for e in self.evidence], "evidence ids")
        evidence_ids = {e.id for e in self.evidence}
        c = self.effective_constraints
        for plan in plans:
            if plan in self.alternatives and plan.strategy == "baseline":
                raise ValueError("alternative cannot be baseline")
            if plan.stops[0].spot_id != c.start_spot_id or plan.stops[-1].spot_id != c.end_spot_id or plan.stops[0].departure_at != c.start_at:
                raise ValueError("plan endpoints differ from constraints")
            if plan.stops[-1].arrival_at > c.end_at or plan.metrics.walk_meters > c.max_walk_meters or len(plan.stops) - 2 > c.max_visits:
                raise ValueError("plan exceeds hard limits")
            if plan.metrics.finish_slack_seconds != int((c.end_at - plan.stops[-1].arrival_at).total_seconds()):
                raise ValueError("finish slack mismatch")
            for item in [*plan.stops, *plan.legs, *plan.facts]:
                if not set(item.evidence_ids) <= evidence_ids:
                    raise ValueError("unknown Evidence reference")
            waits = {w.spot_id: w.wait_seconds for w in c.wait_assumptions}
            unknown = set()
            overlap = 0
            for stop in plan.stops[1:-1]:
                if stop.spot_id not in waits:
                    unknown.add(stop.spot_id)
                if stop.queue_seconds != waits.get(stop.spot_id, 0):
                    raise ValueError("queue assumptions must be identical for every plan")
                for window in c.avoid_windows:
                    if window.spot_id == stop.spot_id:
                        overlap += max(0, int((min(stop.departure_at, window.ends_at) - max(stop.start_at, window.starts_at)).total_seconds()))
            if set(plan.metrics.wait_not_included_spot_ids) != unknown:
                raise ValueError("unknown waits must be explicitly listed")
            if plan.metrics.avoid_overlap_seconds != overlap:
                raise ValueError("avoid overlap must use actual visit intervals")
        return self


class TripResponse(DTO):
    trip: Trip
    active_plan: Plan | None
    evidence: list[Evidence]

    @model_validator(mode="after")
    def active_matches_selection(self):
        selection = self.trip.active_selection
        if (selection is None) != (self.active_plan is None):
            raise ValueError("active plan and selection must be both present or absent")
        if selection and selection.plan_id != self.active_plan.id:
            raise ValueError("active plan differs from selection")
        return self


class SelectionRequest(DTO):
    plan_id: Identifier
    expected_version: int = Field(ge=1)
    idempotency_key: UUID


class SelectionResponse(TripResponse):
    active_plan: Plan


class ErrorDetail(DTO):
    code: str
    message: str
    field: str | None


class ErrorBody(DTO):
    code: str
    message: str
    details: list[ErrorDetail]
    request_id: str


class ErrorResponse(DTO):
    error: ErrorBody


class HealthResponse(DTO):
    status: Literal["ok"] = "ok"
    contract_version: Literal["3.0.0"] = "3.0.0"


PUBLIC_MODELS = {name: value for name, value in list(globals().items()) if isinstance(value, type) and issubclass(value, DTO) and value is not DTO}
