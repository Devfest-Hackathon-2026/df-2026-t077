"""A-02/A-03/A-04 repositories against the local Firestore emulator. Skipped unless FIRESTORE_EMULATOR_HOST is set.

Run: npm run test:firestore   (starts the emulator for demo-zurashitabi only)
"""
import asyncio
import copy
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest

from app.core.errors import AppError
from app.repositories.trips import FirestoreTripRepository
from app.schemas.contracts import ProposalBundle, SelectionRequest, Trip, TripCreateRequest

EMULATOR = os.environ.get("FIRESTORE_EMULATOR_HOST")
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not EMULATOR, reason="Firestore emulator not running")]
FIXTURES = Path(__file__).resolve().parents[2] / "contracts/fixtures/v3"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def new_trip() -> Trip:
    body = TripCreateRequest.model_validate(fixture("trip-create.request.json"))
    now = datetime.now(UTC)
    return Trip(id="trip_" + uuid4().hex, constraints=body.constraints, requested_stops=body.requested_stops, version=1, active_selection=None, created_at=now, updated_at=now)


@pytest.fixture
def repo():
    assert EMULATOR and EMULATOR.split(":")[0] in {"127.0.0.1", "localhost"}
    return FirestoreTripRepository("demo-zurashitabi", EMULATOR)


async def test_owner_reads_and_others_get_nothing(repo):
    trip = new_trip()
    await repo.create_trip("uid-a", str(uuid4()), "hash", trip, [])
    stored = await repo.get_trip("uid-a", trip.id)
    assert stored.trip == trip
    assert await repo.get_trip("uid-b", trip.id) is None
    assert await repo.get_trip("uid-a", "trip_missing") is None


async def test_retry_and_reused_key(repo):
    key = str(uuid4())
    first = new_trip()
    await repo.create_trip("uid-a", key, "hash-1", first, [])
    replay = await repo.create_trip("uid-a", key, "hash-1", new_trip(), [])
    assert replay.trip.id == first.id
    with pytest.raises(AppError) as error:
        await repo.create_trip("uid-a", key, "hash-2", new_trip(), [])
    assert error.value.code == "IDEMPOTENCY_KEY_REUSED"


async def test_concurrent_retries_create_one_trip(repo):
    key = str(uuid4())
    results = await asyncio.gather(*(repo.create_trip("uid-a", key, "hash", new_trip(), []) for _ in range(5)))
    # Every retry succeeds (no 503 from lock waits) and all of them return the same single Trip.
    assert len({result.trip.id for result in results}) == 1


async def test_proposals_follow_trip_ownership_and_are_immutable(repo):
    trip = new_trip()
    await repo.create_trip("uid-a", str(uuid4()), "hash", trip, [])
    value = copy.deepcopy(fixture("proposal-normal.ja.json"))
    value["trip_id"] = trip.id
    bundle = ProposalBundle.model_validate(value)
    with pytest.raises(AppError):
        await repo.save_proposal("uid-b", bundle)
    await repo.save_proposal("uid-a", bundle)
    assert (await repo.get_proposal("uid-a", trip.id, bundle.id)) == bundle
    assert await repo.get_proposal("uid-b", trip.id, bundle.id) is None
    with pytest.raises(AppError) as error:
        await repo.save_proposal("uid-a", bundle)
    assert error.value.code == "MODE_CONFLICT"


def bundle_for(trip: Trip, version: int = 1) -> ProposalBundle:
    value = copy.deepcopy(fixture("proposal-normal.ja.json"))
    value.update(id="proposal_" + uuid4().hex, trip_id=trip.id, base_version=version)
    value["request"]["base_version"] = version
    return ProposalBundle.model_validate(value)


def lease_window():
    now = datetime.now(UTC)
    return now, now + timedelta(seconds=30)


async def test_proposal_claim_complete_and_replay(repo):
    uid = "uid-" + uuid4().hex
    trip = new_trip()
    await repo.create_trip(uid, str(uuid4()), "hash", trip, [])
    key = str(uuid4())
    assert (await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())).status == "acquired"
    # The same key is in progress until completed; another key of the same uid is blocked by the lease.
    assert (await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())).status == "in_progress"
    assert (await repo.claim_proposal(uid, trip.id, str(uuid4()), "h", *lease_window())).status == "in_progress"
    bundle = bundle_for(trip)
    await repo.complete_proposal(uid, key, bundle)
    replay = await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())
    assert replay.status == "completed" and replay.proposal_id == bundle.id
    assert await repo.get_proposal(uid, trip.id, bundle.id) == bundle
    with pytest.raises(AppError) as error:
        await repo.claim_proposal(uid, trip.id, key, "other-payload", *lease_window())
    assert error.value.code == "IDEMPOTENCY_KEY_REUSED"
    # The lease was freed on completion.
    assert (await repo.claim_proposal(uid, trip.id, str(uuid4()), "h", *lease_window())).status == "acquired"


async def test_concurrent_claims_acquire_once(repo):
    uid = "uid-" + uuid4().hex
    trip = new_trip()
    await repo.create_trip(uid, str(uuid4()), "hash", trip, [])
    key = str(uuid4())
    results = await asyncio.gather(*(repo.claim_proposal(uid, trip.id, key, "h", *lease_window()) for _ in range(5)))
    # Exactly one generator; the rest wait (lock contention is reported as in_progress, never a second winner).
    assert sorted(r.status for r in results) == ["acquired", *["in_progress"] * 4]


async def test_complete_rechecks_version_and_release_allows_retry(repo):
    uid = "uid-" + uuid4().hex
    trip = new_trip()
    await repo.create_trip(uid, str(uuid4()), "hash", trip, [])
    key = str(uuid4())
    await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())
    with pytest.raises(AppError) as error:
        await repo.complete_proposal(uid, key, bundle_for(trip, version=2))
    assert error.value.code == "VERSION_CONFLICT"
    await repo.release_proposal(uid, trip.id, key)
    assert (await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())).status == "acquired"


async def stored_trip_and_proposal(repo):
    uid = "uid-" + uuid4().hex
    trip = new_trip()
    await repo.create_trip(uid, str(uuid4()), "hash", trip, [])
    bundle = bundle_for(trip)
    await repo.save_proposal(uid, bundle)
    return uid, trip, bundle


def selection(plan_id: str, version: int = 1, key: str | None = None) -> SelectionRequest:
    return SelectionRequest(plan_id=plan_id, expected_version=version, idempotency_key=key or str(uuid4()))


async def test_selection_is_atomic_and_replayable(repo):
    uid, trip, bundle = await stored_trip_and_proposal(repo)
    request = selection(bundle.baseline.id)
    first = await repo.select_plan(uid, trip.id, bundle.id, request, "h", datetime.now(UTC))
    assert first.trip.version == 2 and first.active_plan.id == bundle.baseline.id
    stored = await repo.get_trip(uid, trip.id)
    assert stored.trip.active_selection.plan_id == bundle.baseline.id
    # Same key replays even though expected_version is now stale; another key with it is a conflict.
    assert await repo.select_plan(uid, trip.id, bundle.id, request, "h", datetime.now(UTC)) == first
    with pytest.raises(AppError) as error:
        await repo.select_plan(uid, trip.id, bundle.id, selection(bundle.baseline.id), "h2", datetime.now(UTC))
    assert error.value.code == "VERSION_CONFLICT"
    with pytest.raises(AppError) as error:
        await repo.select_plan("uid-other", trip.id, bundle.id, selection(bundle.baseline.id), "h", datetime.now(UTC))
    assert error.value.status == 404


async def test_two_tabs_adopting_at_once_produce_one_adoption(repo):
    uid, trip, bundle = await stored_trip_and_proposal(repo)
    plan_ids = [plan.id for plan in [bundle.baseline, *bundle.alternatives]]
    results = await asyncio.gather(
        *(repo.select_plan(uid, trip.id, bundle.id, selection(plan_ids[i % len(plan_ids)]), f"h{i}", datetime.now(UTC)) for i in range(3)),
        return_exceptions=True,
    )
    wins = [r for r in results if not isinstance(r, BaseException)]
    losses = [r for r in results if isinstance(r, BaseException)]
    # Exactly one adoption; the others are told to reload (409), never a silent second write.
    assert len(wins) == 1 and wins[0].trip.version == 2
    assert all(isinstance(e, AppError) and e.code in {"VERSION_CONFLICT", "REQUEST_IN_PROGRESS"} for e in losses), losses
    assert (await repo.get_trip(uid, trip.id)).trip.version == 2


async def test_expired_claim_is_taken_over_by_the_same_key(repo):
    uid = "uid-" + uuid4().hex
    trip = new_trip()
    await repo.create_trip(uid, str(uuid4()), "hash", trip, [])
    key = str(uuid4())
    past = datetime.now(UTC) - timedelta(minutes=5)
    # A crashed instance left a pending key and lease that expired long ago.
    assert (await repo.claim_proposal(uid, trip.id, key, "h", past, past + timedelta(seconds=30))).status == "acquired"
    assert (await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())).status == "acquired"
    assert (await repo.claim_proposal(uid, trip.id, key, "h", *lease_window())).status == "in_progress"
