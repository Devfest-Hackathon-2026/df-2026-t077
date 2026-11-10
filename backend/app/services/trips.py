"""Trip creation/reading. The uid always comes from the verified token, never from the request body."""
import hashlib
import json
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel

from app.core.errors import AppError, invalid, not_found
from app.repositories.trips import StoredTrip, TripRepository
from app.schemas.contracts import (
    JST,
    ProposalBundle,
    SelectionRequest,
    SelectionResponse,
    Trip,
    TripCreateRequest,
    TripResponse,
)


def request_hash(body: BaseModel) -> str:
    """Canonical payload hash: the same idempotency key with a different body is rejected."""
    canonical = json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


async def create_trip(uid: str, body: TripCreateRequest, catalog, repo: TripRepository) -> TripResponse:
    c = body.constraints
    listing = catalog.list(c.area_id, c.start_at.astimezone(JST).date(), c.locale)
    if listing is None:
        raise invalid("body.constraints.area_id", "unknown_area")

    # Every referenced spot must be a server-held candidate of this area (no client-invented IDs).
    known = {spot.id for spot in listing.items}
    references = [("body.constraints.start_spot_id", c.start_spot_id), ("body.constraints.end_spot_id", c.end_spot_id)]
    references += [(f"body.requested_stops.{i}.spot_id", stop.spot_id) for i, stop in enumerate(body.requested_stops)]
    for field, spot_id in references:
        if spot_id not in known:
            raise invalid(field, "unknown_spot")

    # A client-supplied evidence ID is accepted only if the server holds that Evidence.
    evidence = catalog.evidence(c.locale)
    used: list[str] = []
    for i, window in enumerate(c.avoid_windows):
        for ref in window.evidence_ids:
            if ref not in evidence:
                raise invalid(f"body.constraints.avoid_windows.{i}.evidence_ids", "unknown_evidence")
            if ref not in used:
                used.append(ref)

    now = datetime.now(UTC)
    trip = Trip(
        id="trip_" + uuid4().hex,
        constraints=c,
        requested_stops=body.requested_stops,
        version=1,
        active_selection=None,
        created_at=now,
        updated_at=now,
    )
    stored = await repo.create_trip(uid, str(body.client_request_id), request_hash(body), trip, [evidence[ref] for ref in used])
    return await trip_response(uid, stored, repo)


async def get_trip(uid: str, trip_id: str, repo: TripRepository) -> TripResponse:
    stored = await repo.get_trip(uid, trip_id)
    if stored is None:
        raise not_found()
    return await trip_response(uid, stored, repo)


async def select_plan(uid: str, trip_id: str, proposal_id: str, body: SelectionRequest, repo: TripRepository) -> SelectionResponse:
    """A-04: explicit adoption. Only server-stored plans can be adopted; the client sends just the plan id."""
    # The proposal is part of the request: the same key used for another proposal is a reused key.
    hashed = hashlib.sha256(json.dumps({"proposal_id": proposal_id, **body.model_dump(mode="json")}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return await repo.select_plan(uid, trip_id, proposal_id, body, hashed, datetime.now(UTC))


async def get_proposal(uid: str, trip_id: str, proposal_id: str, repo: TripRepository) -> ProposalBundle:
    bundle = await repo.get_proposal(uid, trip_id, proposal_id)
    if bundle is None:
        raise not_found()
    return bundle


async def trip_response(uid: str, stored: StoredTrip, repo: TripRepository) -> TripResponse:
    selection = stored.trip.active_selection
    if selection is None:
        return TripResponse(trip=stored.trip, active_plan=None, evidence=stored.evidence)
    # Adopted plan is read back from its immutable Proposal (written by A-04).
    bundle = await repo.get_proposal(uid, stored.trip.id, selection.proposal_id)
    plans = ([bundle.baseline] if bundle and bundle.baseline else []) + (bundle.alternatives if bundle else [])
    plan = next((p for p in plans if p.id == selection.plan_id), None)
    if plan is None:
        raise AppError(500, "INTERNAL_ERROR")
    return TripResponse(trip=stored.trip, active_plan=plan, evidence=bundle.evidence)
