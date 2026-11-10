"""Shared A/B boundaries. No database, SDK or HTTP dependency in planner inputs."""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.schemas.contracts import Evidence, Explanation, Fact, IntentDraftResponse, IntentInterpretRequest, Locale, Plan, ProposalRequest, SourceKind, Spot, Trip, TripConstraints, Violation


@dataclass(frozen=True)
class PersistenceHint:
    persistable: bool
    expires_at: datetime | None
    required_attribution: str | None
    provider: str
    reference: str | None


@dataclass(frozen=True)
class RouteEstimate:
    from_spot_id: str
    to_spot_id: str
    duration_seconds: int
    distance_meters: int
    source_kind: SourceKind
    evidence_ids: tuple[str, ...]
    persistence: PersistenceHint


@dataclass(frozen=True)
class ExplanationInput:
    locale: Locale
    facts: tuple[Fact, ...]


class Explainer(Protocol):
    async def explain(self, request: ExplanationInput, deadline_monotonic: float) -> Explanation: ...


@dataclass(frozen=True)
class PlanningContext:
    trip: Trip
    request: ProposalRequest
    effective_constraints: TripConstraints
    spots: tuple[Spot, ...]
    routes: tuple[RouteEstimate, ...]
    evidence: tuple[Evidence, ...]
    deadline_monotonic: float
    explainer: Explainer | None = None


@dataclass(frozen=True)
class EngineResult:
    baseline: Plan | None
    alternatives: tuple[Plan, ...]
    violations: tuple[Violation, ...]
    warnings: tuple[str, ...]
    evidence: tuple[Evidence, ...]
    status: Literal["complete", "partial", "no_feasible_plan"]


class Planner(Protocol):
    async def generate(self, context: PlanningContext) -> EngineResult: ...


class IntentInterpreter(Protocol):
    async def interpret(self, request: IntentInterpretRequest, allowed_spots: tuple[Spot, ...], deadline_monotonic: float) -> IntentDraftResponse: ...
