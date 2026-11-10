"""A-03: proposal generation over HTTP. A owns ownership, versions, idempotency, data and storage;
the planner (B) only receives a PlanningContext and never touches HTTP/Firestore.

Order follows docs/API.md: ownership 404 -> same-key replay (before any version check) -> version/mode 409
-> merged constraints -> planner -> Proposal saved atomically with a second version check.
"""
import asyncio
import contextlib
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from pydantic import ValidationError

from app.core.errors import AppError, invalid, not_found, unavailable
from app.domain.constraints import PlanningDeadlineExceeded, effective_constraints
from app.domain.ports import Explainer, Planner, PlanningContext
from app.repositories.trips import TripRepository, version_conflict
from app.schemas.contracts import JST, Evidence, ProposalBundle, ProposalRequest, TripConstraints
from app.services.trips import request_hash

# A crashed instance's pending key becomes retryable once the lease passes the generation deadline.
LEASE_GRACE_SECONDS = 5


def utc_now() -> datetime:
    return datetime.now(UTC)


async def create_proposal(
    uid: str,
    trip_id: str,
    body: ProposalRequest,
    *,
    catalog,
    routes,
    repo: TripRepository,
    planner: Planner,
    timeout_seconds: int,
    explainer: Explainer | None = None,
    clock: Callable[[], datetime] = utc_now,
) -> ProposalBundle:
    stored = await repo.get_trip(uid, trip_id)
    if stored is None:
        raise not_found()

    key = str(body.client_request_id)
    now = clock()
    claim = await repo.claim_proposal(uid, trip_id, key, request_hash(body), now, now + timedelta(seconds=timeout_seconds + LEASE_GRACE_SECONDS))
    if claim.status == "completed":
        bundle = await repo.get_proposal(uid, trip_id, claim.proposal_id)
        if bundle is None:
            raise AppError(500, "INTERNAL_ERROR")
        return bundle
    if claim.status == "in_progress":
        raise AppError(409, "REQUEST_IN_PROGRESS", headers={"Retry-After": str(claim.retry_after_seconds)})

    try:
        bundle = await _generate(stored, body, catalog=catalog, routes=routes, planner=planner, timeout_seconds=timeout_seconds, explainer=explainer, clock=clock)
        await repo.complete_proposal(uid, key, bundle)
    except BaseException:
        # Free the key and lease so the same request can be retried. If even that fails, the lease
        # still expires on its own; keep the original error rather than masking it.
        with contextlib.suppress(Exception):
            await asyncio.shield(repo.release_proposal(uid, trip_id, key))
        raise
    return bundle


async def _generate(stored, body: ProposalRequest, *, catalog, routes, planner: Planner, timeout_seconds: int, explainer: Explainer | None, clock) -> ProposalBundle:
    trip = stored.trip
    if body.base_version != trip.version:
        raise version_conflict()
    if body.mode != ("refine" if trip.active_selection else "initial"):
        raise AppError(409, "MODE_CONFLICT")

    try:
        constraints = effective_constraints(trip.constraints, body.constraint_overrides)
    except ValidationError:
        raise invalid("body.constraint_overrides", "constraint_conflict") from None

    listing = catalog.list(constraints.area_id, constraints.start_at.astimezone(JST).date(), constraints.locale)
    if listing is None:
        # The area was valid when the Trip was created; losing it now is a server-side data problem.
        raise unavailable()
    evidence = _evidence(constraints, listing, routes, catalog)
    spots = tuple(listing.items)

    context = PlanningContext(
        trip=trip,
        request=body,
        effective_constraints=constraints,
        # Every spot in the area, not only the requested ones: place_shift picks unselected replacements.
        spots=spots,
        routes=routes.routes_between(spot.id for spot in spots),
        evidence=tuple(evidence.values()),
        deadline_monotonic=time.monotonic() + timeout_seconds,
        # B's planner explains each plan with it inside the same deadline; None keeps the template text.
        explainer=explainer,
    )
    try:
        result = await asyncio.wait_for(planner.generate(context), timeout_seconds)
    except (PlanningDeadlineExceeded, TimeoutError):
        raise AppError(504, "GENERATION_TIMEOUT") from None

    bundle = ProposalBundle(
        id="proposal_" + uuid4().hex,
        trip_id=trip.id,
        base_version=trip.version,
        request=body,
        effective_constraints=constraints,
        baseline=result.baseline,
        alternatives=list(result.alternatives),
        evidence=list(result.evidence),
        status=result.status,
        violations=list(result.violations),
        warnings=list(result.warnings),
        created_at=clock(),
    )
    # Re-validate from JSON: nested models built with model_copy skip field checks, and a stored
    # Proposal that cannot be read back would break GET proposal / GET trip later.
    return ProposalBundle.model_validate(bundle.model_dump(mode="json"))


def _evidence(constraints: TripConstraints, listing, routes, catalog) -> dict[str, Evidence]:
    """Evidence the planner may cite, in the response locale: spots, routes, and avoid-window references."""
    evidence = {item.id: item for item in listing.evidence}
    if routes.evidence is not None:
        evidence.setdefault(routes.evidence.id, routes.evidence)
    known = catalog.evidence(constraints.locale)
    for i, window in enumerate(constraints.avoid_windows):
        for ref in window.evidence_ids:
            # Overrides may carry new windows; a client-made reference is rejected as at Trip creation.
            if ref not in known:
                raise invalid(f"body.constraint_overrides.avoid_windows.{i}.evidence_ids", "unknown_evidence")
            evidence.setdefault(ref, known[ref])
    return evidence


def gemini_explainer_factory(settings) -> Callable[[], Explainer | None]:
    """Build the Gemini explainer once, only when EXPLANATION_PROVIDER=gemini and Vertex AI is configured."""
    built: list[Explainer | None] = []

    def get() -> Explainer | None:
        if settings.explanation_provider != "gemini":
            return None
        if not built:
            from google.auth.exceptions import GoogleAuthError

            from app.adapters.gemini_explainer import GeminiExplainer, GoogleGenAIExplanationClient
            try:
                built.append(GeminiExplainer(GoogleGenAIExplanationClient(settings)))
            except (ValueError, GoogleAuthError):
                # demo- project, no GEMINI_MODEL or no credentials: keep the planner's template explanations.
                built.append(None)
        return built[0]

    return get
