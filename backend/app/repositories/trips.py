"""Trip/Proposal persistence with server-side ownership.

Stored documents keep owner_uid next to the public DTO; owner_uid is never returned to clients.
A resource that is missing and one owned by another uid both read as None (the API answers 404).
"""
import asyncio
import hashlib
import math
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.core.errors import AppError, unavailable
from app.schemas.contracts import (
    ActiveSelection,
    Evidence,
    Plan,
    ProposalBundle,
    RequestedStop,
    SelectionRequest,
    SelectionResponse,
    Trip,
    TripConstraints,
)

FIRESTORE_TIMEOUT_SECONDS = 10
# Read, decide, conditionally write; on a lost race read once more (the winner's write decides the answer).
OPTIMISTIC_ATTEMPTS = 3

@dataclass(frozen=True)
class StoredTrip:
    trip: Trip
    evidence: list[Evidence]


@dataclass(frozen=True)
class ProposalClaim:
    """acquired: this request may generate. completed: replay proposal_id. in_progress: answer 409 + Retry-After."""
    status: Literal["acquired", "completed", "in_progress"]
    proposal_id: str | None = None
    retry_after_seconds: int | None = None


def idempotency_doc_id(uid: str, action: str, client_request_id: str) -> str:
    # Scoped by uid so one user's key can never replay another user's resource.
    return hashlib.sha256(f"{uid}\n{action}\n{client_request_id}".encode()).hexdigest()


def proposal_key_id(uid: str, trip_id: str, client_request_id: str) -> str:
    return idempotency_doc_id(uid, f"create_proposal\n{trip_id}", client_request_id)


def lease_doc_id(uid: str) -> str:
    # One generation at a time per uid, shared by every instance (docs/DATA.md generation_leases).
    return hashlib.sha256(f"generation_lease\n{uid}".encode()).hexdigest()


def key_reused() -> AppError:
    return AppError(409, "IDEMPOTENCY_KEY_REUSED")


def version_conflict() -> AppError:
    return AppError(409, "VERSION_CONFLICT")


def _retry_after(until: datetime, now: datetime) -> ProposalClaim:
    return ProposalClaim("in_progress", retry_after_seconds=max(1, math.ceil((until - now).total_seconds())))


def decide_proposal_claim(record: dict | None, lease: dict | None, key_id: str, request_hash: str, now: datetime) -> ProposalClaim:
    """Shared by both repositories so replay, in-progress and lease takeover behave identically."""
    if record is not None:
        if record["request_hash"] != request_hash:
            raise key_reused()
        if record["status"] == "complete":
            return ProposalClaim("completed", proposal_id=record["proposal_id"])
        if record["lease_expires_at"] > now:
            return _retry_after(record["lease_expires_at"], now)
    # A pending record whose lease expired (crashed instance) may be taken over by the same key.
    if lease is not None and lease["key_id"] != key_id and lease["expires_at"] > now:
        return _retry_after(lease["expires_at"], now)
    return ProposalClaim("acquired")


def selection_key_id(uid: str, trip_id: str, idempotency_key: str) -> str:
    return idempotency_doc_id(uid, f"select_plan\n{trip_id}", idempotency_key)


@dataclass(frozen=True)
class SelectionDecision:
    """replay: answer the stored response. write: store trip_doc and the key, then answer response."""
    response: SelectionResponse
    trip_doc: dict | None = None


def decide_selection(
    uid: str,
    trip_doc: dict | None,
    proposal_doc: dict | None,
    key_record: dict | None,
    *,
    proposal_id: str,
    request: SelectionRequest,
    request_hash: str,
    now: datetime,
) -> SelectionDecision:
    """Adoption rules shared by both repositories (docs/API.md 採用・再送・競合), evaluated inside one transaction."""
    if not trip_doc or trip_doc.get("owner_uid") != uid:
        raise AppError(404, "NOT_FOUND")
    # A successful retry wins over the version check (the first success already bumped the version).
    if key_record is not None:
        if key_record["request_hash"] != request_hash:
            raise key_reused()
        return SelectionDecision(SelectionResponse.model_validate(key_record["response"]))
    if not proposal_doc or proposal_doc.get("owner_uid") != uid:
        raise AppError(404, "NOT_FOUND")
    # Re-validated on read: a stored plan that no longer satisfies the bundle's hard limits cannot be adopted.
    bundle = ProposalBundle.model_validate(proposal_doc["bundle"])
    trip = Trip.model_validate(trip_doc["trip"])
    if not request.expected_version == trip.version == bundle.base_version:
        raise version_conflict()
    plan = next((p for p in [bundle.baseline, *bundle.alternatives] if p is not None and p.id == request.plan_id), None)
    if plan is None:
        raise AppError(404, "NOT_FOUND")
    requested_stops = adopted_requested_stops(trip.requested_stops, plan)
    selected = trip.model_copy(update={
        "version": trip.version + 1,
        # Overrides used for this Proposal become the Trip's confirmed conditions once adopted.
        "constraints": constraints_for_visits(bundle.effective_constraints, requested_stops),
        # The adopted itinerary becomes the base of the next refine (order and any place replacement).
        "requested_stops": requested_stops,
        "active_selection": ActiveSelection(proposal_id=proposal_id, plan_id=plan.id, selected_at=now),
        "updated_at": now,
    })
    selected = Trip.model_validate(selected.model_dump(mode="json"))
    response = SelectionResponse(trip=selected, active_plan=plan, evidence=bundle.evidence)
    return SelectionDecision(response, trip_doc={**trip_doc, "trip": selected.model_dump(mode="json")})


def adopted_requested_stops(original: list[RequestedStop], plan: Plan) -> list[RequestedStop]:
    """Visits of the adopted plan, in its order. A spot kept from the request keeps its confirmed reservation;
    a replacement is the planner's optional and never assumed reserved. must and locked times come from the plan,
    which the planner guarantees to preserve."""
    before = {stop.spot_id: stop for stop in original}
    return [
        RequestedStop(
            spot_id=stop.spot_id,
            requirement=stop.requirement,
            locked_start_at=stop.locked_start_at,
            reservation_confirmed=before[stop.spot_id].reservation_confirmed if stop.spot_id in before else False,
        )
        for stop in plan.stops[1:-1]
    ]


def constraints_for_visits(constraints: TripConstraints, stops: list[RequestedStop]) -> TripConstraints:
    """Drop avoid windows and wait assumptions of spots no longer visited (a replaced optional): the planner
    rejects preferences that refer to non-visits, which would make every later refine fail."""
    visits = {stop.spot_id for stop in stops}
    return constraints.model_copy(update={
        "avoid_windows": [window for window in constraints.avoid_windows if window.spot_id in visits],
        "wait_assumptions": [wait for wait in constraints.wait_assumptions if wait.spot_id in visits],
        # The adopted plan's お任せ picks are now concrete visits in requested_stops; keeping the slots would
        # make the next refine add another spot on top of them.
        "omakase_visits": 0,
    })


def selection_key_doc(uid: str, trip_id: str, request_hash: str, response: SelectionResponse, now: datetime) -> dict:
    return {"owner_uid": uid, "action": "select_plan", "trip_id": trip_id, "request_hash": request_hash, "response": response.model_dump(mode="json"), "created_at": now}


class TripRepository(Protocol):
    async def create_trip(self, uid: str, client_request_id: str, request_hash: str, trip: Trip, evidence: list[Evidence]) -> StoredTrip:
        """Create once per (uid, client_request_id). Same key+payload returns the first result; another payload is 409."""

    async def get_trip(self, uid: str, trip_id: str) -> StoredTrip | None: ...

    async def save_proposal(self, uid: str, bundle: ProposalBundle) -> None:
        """Proposals are immutable once written (A-03 caller)."""

    async def get_proposal(self, uid: str, trip_id: str, proposal_id: str) -> ProposalBundle | None: ...

    async def claim_proposal(self, uid: str, trip_id: str, client_request_id: str, request_hash: str, now: datetime, lease_until: datetime) -> ProposalClaim:
        """Atomically decide replay / in-progress, or record a pending key and take the uid's generation lease."""

    async def complete_proposal(self, uid: str, client_request_id: str, bundle: ProposalBundle) -> None:
        """Atomically re-check Trip.version == bundle.base_version, write the immutable Proposal, mark the key complete, free the lease."""

    async def release_proposal(self, uid: str, trip_id: str, client_request_id: str) -> None:
        """After a failure: drop the pending key (same key may retry) and free the lease. Never touches a completed key."""

    async def select_plan(self, uid: str, trip_id: str, proposal_id: str, request: SelectionRequest, request_hash: str, now: datetime) -> SelectionResponse:
        """In one transaction: replay the same key, or check versions/plan and store the adopted Trip with its replay record."""


def _trip_doc(uid: str, stored: StoredTrip) -> dict:
    return {"owner_uid": uid, "trip": stored.trip.model_dump(mode="json"), "evidence": [e.model_dump(mode="json") for e in stored.evidence]}


def _from_doc(doc: dict) -> StoredTrip:
    return StoredTrip(Trip.model_validate(doc["trip"]), [Evidence.model_validate(e) for e in doc["evidence"]])


class InMemoryTripRepository:
    """Process-local implementation for tests/CI. Same semantics as Firestore, no durability."""

    def __init__(self):
        self._trips: dict[str, dict] = {}
        self._proposals: dict[tuple[str, str], dict] = {}
        self._keys: dict[str, dict] = {}
        self._leases: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    async def create_trip(self, uid, client_request_id, request_hash, trip, evidence):
        key = idempotency_doc_id(uid, "create_trip", client_request_id)
        async with self._lock:
            record = self._keys.get(key)
            if record:
                if record["request_hash"] != request_hash:
                    raise key_reused()
                return _from_doc(self._trips[record["trip_id"]])
            self._trips[trip.id] = _trip_doc(uid, StoredTrip(trip, evidence))
            self._keys[key] = {"request_hash": request_hash, "trip_id": trip.id}
            return StoredTrip(trip, evidence)

    async def get_trip(self, uid, trip_id):
        doc = self._trips.get(trip_id)
        return _from_doc(doc) if doc and doc["owner_uid"] == uid else None

    async def save_proposal(self, uid, bundle):
        if await self.get_trip(uid, bundle.trip_id) is None:
            raise AppError(404, "NOT_FOUND")
        key = (bundle.trip_id, bundle.id)
        if key in self._proposals:
            raise AppError(409, "MODE_CONFLICT")
        self._proposals[key] = {"owner_uid": uid, "bundle": bundle.model_dump(mode="json")}

    async def get_proposal(self, uid, trip_id, proposal_id):
        if await self.get_trip(uid, trip_id) is None:
            return None
        doc = self._proposals.get((trip_id, proposal_id))
        return ProposalBundle.model_validate(doc["bundle"]) if doc and doc["owner_uid"] == uid else None

    async def claim_proposal(self, uid, trip_id, client_request_id, request_hash, now, lease_until):
        key_id = proposal_key_id(uid, trip_id, client_request_id)
        async with self._lock:
            claim = decide_proposal_claim(self._keys.get(key_id), self._leases.get(lease_doc_id(uid)), key_id, request_hash, now)
            if claim.status == "acquired":
                self._keys[key_id] = {"owner_uid": uid, "trip_id": trip_id, "request_hash": request_hash, "status": "pending", "proposal_id": None, "lease_expires_at": lease_until}
                self._leases[lease_doc_id(uid)] = {"key_id": key_id, "expires_at": lease_until}
            return claim

    async def complete_proposal(self, uid, client_request_id, bundle):
        key_id = proposal_key_id(uid, bundle.trip_id, client_request_id)
        async with self._lock:
            doc = self._trips.get(bundle.trip_id)
            if not doc or doc["owner_uid"] != uid:
                raise AppError(404, "NOT_FOUND")
            if doc["trip"]["version"] != bundle.base_version:
                raise version_conflict()
            key = (bundle.trip_id, bundle.id)
            if key in self._proposals:
                raise AppError(409, "MODE_CONFLICT")
            self._proposals[key] = {"owner_uid": uid, "bundle": bundle.model_dump(mode="json")}
            self._keys[key_id].update(status="complete", proposal_id=bundle.id)
            if self._leases.get(lease_doc_id(uid), {}).get("key_id") == key_id:
                del self._leases[lease_doc_id(uid)]

    async def release_proposal(self, uid, trip_id, client_request_id):
        key_id = proposal_key_id(uid, trip_id, client_request_id)
        async with self._lock:
            if self._keys.get(key_id, {}).get("status") == "pending":
                del self._keys[key_id]
            if self._leases.get(lease_doc_id(uid), {}).get("key_id") == key_id:
                del self._leases[lease_doc_id(uid)]

    async def select_plan(self, uid, trip_id, proposal_id, request, request_hash, now):
        key_id = selection_key_id(uid, trip_id, str(request.idempotency_key))
        async with self._lock:
            decision = decide_selection(
                uid, self._trips.get(trip_id), self._proposals.get((trip_id, proposal_id)), self._keys.get(key_id),
                proposal_id=proposal_id, request=request, request_hash=request_hash, now=now,
            )
            if decision.trip_doc is not None:
                self._trips[trip_id] = decision.trip_doc
                self._keys[key_id] = selection_key_doc(uid, trip_id, request_hash, decision.response, now)
            return decision.response


class FirestoreTripRepository:
    """Collections (docs/DATA.md): trips/{id}, trips/{id}/proposals/{id}, idempotency/{hash}, generation_leases/{hash}."""

    def __init__(self, project_id: str, emulator_host: str | None, database: str = "(default)"):
        self._project_id = project_id
        self._emulator_host = emulator_host
        self._database = database
        self._client = None

    def _db(self):
        # A demo- project only ever exists in the local emulator; never reach the network without it.
        if self._project_id.startswith("demo-") and not self._emulator_host:
            raise unavailable()
        if self._client is None:
            from google.cloud import firestore
            if self._emulator_host:
                os.environ["FIRESTORE_EMULATOR_HOST"] = self._emulator_host
            self._client = firestore.AsyncClient(project=self._project_id, database=self._database)
        return self._client

    async def _guard(self, operation):
        from google.api_core.exceptions import GoogleAPICallError, RetryError
        from google.auth.exceptions import GoogleAuthError
        try:
            # The client otherwise retries an unreachable backend for minutes; fail fast as 503 instead.
            return await asyncio.wait_for(operation(), FIRESTORE_TIMEOUT_SECONDS)
        except AppError:
            raise
        except (GoogleAPICallError, RetryError, GoogleAuthError, TimeoutError, OSError):
            # Do not expose infrastructure details to clients.
            raise unavailable() from None

    async def create_trip(self, uid, client_request_id, request_hash, trip, evidence):
        from google.api_core.exceptions import Aborted, AlreadyExists

        async def run():
            db = self._db()
            key_ref = db.collection("idempotency").document(idempotency_doc_id(uid, "create_trip", client_request_id))
            trip_ref = db.collection("trips").document(trip.id)

            # One atomic batch with create-only preconditions: exactly one retry of a key can create its
            # key document, and the Trip is written only with it. Unlike the previous read-then-write
            # transaction it takes no read locks, so concurrent retries no longer queue for 4-10 s (past
            # the 10 s guard, answered as a false 503).
            batch = db.batch()
            batch.create(trip_ref, _trip_doc(uid, StoredTrip(trip, evidence)))
            batch.create(key_ref, {"owner_uid": uid, "action": "create_trip", "request_hash": request_hash, "trip_id": trip.id, "created_at": trip.created_at})
            try:
                await batch.commit()
                return StoredTrip(trip, evidence)
            except (AlreadyExists, Aborted):
                # AlreadyExists: another retry created this key. Aborted: our commit waited on that retry's
                # lock (the emulator locks every commit). Either way, replay whatever that retry wrote.
                pass
            snapshot = await key_ref.get()
            if not snapshot.exists:
                raise AppError(409, "REQUEST_IN_PROGRESS", headers={"Retry-After": "1"})
            record = snapshot.to_dict()
            if record["request_hash"] != request_hash:
                raise key_reused()
            existing = await db.collection("trips").document(record["trip_id"]).get()
            return _from_doc(existing.to_dict())

        return await self._guard(run)

    async def get_trip(self, uid, trip_id):
        async def run():
            snapshot = await self._db().collection("trips").document(trip_id).get()
            doc = snapshot.to_dict() if snapshot.exists else None
            return _from_doc(doc) if doc and doc.get("owner_uid") == uid else None

        return await self._guard(run)

    async def save_proposal(self, uid, bundle):
        async def run():
            if await self.get_trip(uid, bundle.trip_id) is None:
                raise AppError(404, "NOT_FOUND")
            ref = self._db().collection("trips").document(bundle.trip_id).collection("proposals").document(bundle.id)
            from google.api_core.exceptions import AlreadyExists
            try:
                await ref.create({"owner_uid": uid, "bundle": bundle.model_dump(mode="json")})
            except AlreadyExists:
                raise AppError(409, "MODE_CONFLICT") from None

        return await self._guard(run)

    async def get_proposal(self, uid, trip_id, proposal_id):
        async def run():
            if await self.get_trip(uid, trip_id) is None:
                return None
            snapshot = await self._db().collection("trips").document(trip_id).collection("proposals").document(proposal_id).get()
            doc = snapshot.to_dict() if snapshot.exists else None
            return ProposalBundle.model_validate(doc["bundle"]) if doc and doc.get("owner_uid") == uid else None

        return await self._guard(run)

    def _conditional(self, batch, ref, snap, data: dict) -> None:
        """Write only if the document is unchanged since `snap` was read (create if it did not exist)."""
        if snap.exists:
            batch.update(ref, data, option=self._db().write_option(last_update_time=snap.update_time))
        else:
            batch.create(ref, data)

    async def claim_proposal(self, uid, trip_id, client_request_id, request_hash, now, lease_until):
        async def run():
            db = self._db()
            key_id = proposal_key_id(uid, trip_id, client_request_id)
            key_ref = db.collection("idempotency").document(key_id)
            lease_ref = db.collection("generation_leases").document(lease_doc_id(uid))
            # Optimistic, not a read-then-write transaction: concurrent claims of one uid otherwise deadlock on
            # each other's read locks for 4-10 s (past the 10 s guard -> false 503), like createTrip did.
            for _ in range(OPTIMISTIC_ATTEMPTS):
                key_snap, lease_snap = await asyncio.gather(key_ref.get(), lease_ref.get())
                result = decide_proposal_claim(
                    key_snap.to_dict() if key_snap.exists else None,
                    lease_snap.to_dict() if lease_snap.exists else None,
                    key_id, request_hash, now,
                )
                if result.status != "acquired":
                    return result
                batch = db.batch()
                self._conditional(batch, key_ref, key_snap, {"owner_uid": uid, "action": "create_proposal", "trip_id": trip_id, "request_hash": request_hash, "status": "pending", "proposal_id": None, "lease_expires_at": lease_until, "created_at": now})
                self._conditional(batch, lease_ref, lease_snap, {"owner_uid": uid, "key_id": key_id, "expires_at": lease_until})
                if await self._commit_unless_changed(batch):
                    return result
                # Someone wrote the key or lease after our read: decide again from what they wrote.
            return ProposalClaim("in_progress", retry_after_seconds=1)

        return await self._guard(run)

    @staticmethod
    async def _commit_unless_changed(batch) -> bool:
        from google.api_core.exceptions import Aborted, AlreadyExists, FailedPrecondition
        try:
            await batch.commit()
            return True
        except (AlreadyExists, FailedPrecondition, Aborted):
            # AlreadyExists/FailedPrecondition: a concurrent writer won. Aborted: the emulator also locks commits.
            return False

    async def complete_proposal(self, uid, client_request_id, bundle):
        from google.cloud import firestore

        async def run():
            db = self._db()
            key_id = proposal_key_id(uid, bundle.trip_id, client_request_id)
            trip_ref = db.collection("trips").document(bundle.trip_id)
            key_ref = db.collection("idempotency").document(key_id)
            lease_ref = db.collection("generation_leases").document(lease_doc_id(uid))
            proposal_ref = trip_ref.collection("proposals").document(bundle.id)

            @firestore.async_transactional
            async def complete(transaction):
                # The Trip may have been adopted elsewhere while the planner ran: re-check inside the transaction.
                trip_snap = await trip_ref.get(transaction=transaction)
                lease_snap = await lease_ref.get(transaction=transaction)
                doc = trip_snap.to_dict() if trip_snap.exists else None
                if not doc or doc.get("owner_uid") != uid:
                    raise AppError(404, "NOT_FOUND")
                if doc["trip"]["version"] != bundle.base_version:
                    raise version_conflict()
                transaction.create(proposal_ref, {"owner_uid": uid, "bundle": bundle.model_dump(mode="json")})
                transaction.update(key_ref, {"status": "complete", "proposal_id": bundle.id})
                if lease_snap.exists and lease_snap.to_dict().get("key_id") == key_id:
                    transaction.delete(lease_ref)

            await complete(db.transaction())

        return await self._guard(run)

    async def release_proposal(self, uid, trip_id, client_request_id):
        from google.cloud import firestore

        async def run():
            db = self._db()
            key_id = proposal_key_id(uid, trip_id, client_request_id)
            key_ref = db.collection("idempotency").document(key_id)
            lease_ref = db.collection("generation_leases").document(lease_doc_id(uid))

            @firestore.async_transactional
            async def release(transaction):
                key_snap = await key_ref.get(transaction=transaction)
                lease_snap = await lease_ref.get(transaction=transaction)
                if key_snap.exists and key_snap.to_dict().get("status") == "pending":
                    transaction.delete(key_ref)
                if lease_snap.exists and lease_snap.to_dict().get("key_id") == key_id:
                    transaction.delete(lease_ref)

            await release(db.transaction())

        return await self._guard(run)

    async def select_plan(self, uid, trip_id, proposal_id, request, request_hash, now):
        async def run():
            db = self._db()
            trip_ref = db.collection("trips").document(trip_id)
            proposal_ref = trip_ref.collection("proposals").document(proposal_id)
            key_ref = db.collection("idempotency").document(selection_key_id(uid, trip_id, str(request.idempotency_key)))
            for _ in range(OPTIMISTIC_ATTEMPTS):
                trip_snap, proposal_snap, key_snap = await asyncio.gather(trip_ref.get(), proposal_ref.get(), key_ref.get())
                decision = decide_selection(
                    uid,
                    trip_snap.to_dict() if trip_snap.exists else None,
                    proposal_snap.to_dict() if proposal_snap.exists else None,
                    key_snap.to_dict() if key_snap.exists else None,
                    proposal_id=proposal_id, request=request, request_hash=request_hash, now=now,
                )
                if decision.trip_doc is None:
                    return decision.response
                # Atomic: the Trip is updated only if unchanged since our read (so two tabs cannot both pass the
                # version check) and the replay record only if this key is new. Proposals are immutable.
                batch = db.batch()
                self._conditional(batch, trip_ref, trip_snap, {"trip": decision.trip_doc["trip"]})
                batch.create(key_ref, selection_key_doc(uid, trip_id, request_hash, decision.response, now))
                if await self._commit_unless_changed(batch):
                    return decision.response
                # Lost a race: re-reading yields our own replay (same key) or VERSION_CONFLICT (another adoption).
            raise AppError(409, "REQUEST_IN_PROGRESS", headers={"Retry-After": "1"})

        return await self._guard(run)
