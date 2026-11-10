"""A-05: curated (real) spots served from data/curated with regular closures, end to end through HTTP."""
import importlib.util
import json
import shutil
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.auth import current_uid
from app.core.settings import Settings
from app.main import create_app
from app.repositories.routes import RouteCatalog
from app.repositories.spots import CURATED, CuratedSpotCatalog, spot_catalog_for
from app.repositories.trips import InMemoryTripRepository

ROOT = Path(__file__).resolve().parents[2]
AREA = "nagoya-central"
THURSDAY, TUESDAY = date(2026, 11, 12), date(2026, 11, 10)


@pytest.fixture(scope="module")
def catalog():
    return CuratedSpotCatalog()


def spot(catalog, spot_id, day):
    return next(item for item in catalog.list(AREA, day, "ja").items if item.id == spot_id)


def test_curated_mode_serves_the_real_area(catalog):
    listing = catalog.list(AREA, THURSDAY, "en")
    assert len(listing.items) == 12 and not any(item.is_demo for item in listing.items)
    assert {e.id for e in listing.evidence} == {ref for item in listing.items for ref in item.evidence_ids}
    assert catalog.list("demo-area", THURSDAY, "en") is None
    assert isinstance(spot_catalog_for("curated"), CuratedSpotCatalog)


def test_reference_hours_are_moved_to_the_requested_date(catalog):
    castle = spot(catalog, "nagoya-castle", THURSDAY)
    window = castle.opening_windows[0]
    assert (window.opens_at.date(), window.opens_at.hour, window.closes_at.hour, window.closes_at.minute) == (THURSDAY, 9, 16, 30)


@pytest.mark.parametrize(("spot_id", "closed", "open_"), [
    ("yamamotoya-honke", TUESDAY, THURSDAY),
    ("yamamotoya-honke", date(2026, 11, 11), THURSDAY),  # Wednesday
    ("atsuta-horaiken-matsuzakaya", TUESDAY, THURSDAY),
    ("nagoya-castle", date(2026, 12, 30), date(2026, 12, 28)),
    ("nagoya-castle", date(2027, 1, 1), date(2027, 1, 2)),
])
def test_regular_closures_are_served_as_closed(catalog, spot_id, closed, open_):
    shut = spot(catalog, spot_id, closed)
    assert shut.opening_status == "closed" and shut.opening_windows == []
    assert spot(catalog, spot_id, open_).opening_status == "verified"


def test_every_curated_spot_has_walking_routes_to_every_other(catalog):
    ids = [item.id for item in catalog.list(AREA, THURSDAY, "ja").items]
    pairs = {(r.from_spot_id, r.to_spot_id) for r in RouteCatalog().routes_between(ids)}
    assert pairs == {(a, b) for a in ids for b in ids if a != b}


def test_curated_file_passes_the_team_data_check():
    spec = importlib.util.spec_from_file_location("validate_spots", ROOT / "scripts/validate_spots.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = CuratedSpotCatalog()._data
    assert module.check_curated(data, date(2026, 11, 5), 8) == []


def test_closures_for_unknown_spots_are_rejected(tmp_path):
    shutil.copy(CURATED / "spots.json", tmp_path / "spots.json")
    (tmp_path / "closures.json").write_text(json.dumps({"weekly": {"invented-spot": ["mon"]}, "annual": {}}), encoding="utf-8")
    with pytest.raises(ValueError, match="unknown spots"):
        CuratedSpotCatalog(tmp_path)


# --- end to end in DATA_MODE=curated --------------------------------------------------------------

@pytest.fixture
def client():
    app = create_app(Settings(_env_file=None, app_env="test", data_mode="curated"), trip_repository=InMemoryTripRepository())
    app.dependency_overrides[current_uid] = lambda: "user-a"
    return TestClient(app)


def trip_body(day: date, stops, interests):
    start, end = f"{day.isoformat()}T09:00:00+09:00", f"{day.isoformat()}T17:00:00+09:00"
    return {
        "client_request_id": str(uuid4()),
        "intent_confirmed": True,
        "constraints": {
            "area_id": AREA, "timezone": "Asia/Tokyo", "start_at": start, "end_at": end,
            "start_spot_id": "sakae-station", "end_spot_id": "sakae-station", "mode": "walking",
            "max_walk_meters": 8000, "max_visits": 4, "interests": interests, "party_size": 1, "locale": "en",
            "avoid_windows": [{"id": "aw-1", "spot_id": stops[0][0], "starts_at": start, "ends_at": f"{day.isoformat()}T11:00:00+09:00", "basis": "user_preference", "evidence_ids": [], "note": ""}],
            "wait_assumptions": [],
        },
        "requested_stops": [{"spot_id": s, "requirement": r, "locked_start_at": None, "reservation_confirmed": False} for s, r in stops],
    }


def generate(client, trip_id):
    body = {"client_request_id": str(uuid4()), "base_version": 1, "mode": "initial", "constraint_overrides": {}}
    return client.post(f"/api/v1/trips/{trip_id}/proposals", json=body).json()


def test_real_spots_and_routes_produce_all_three_options(client):
    trip = client.post("/api/v1/trips", json=trip_body(THURSDAY, [("nagoya-castle", "must"), ("osu-kannon", "optional")], ["history"])).json()["trip"]
    proposal = generate(client, trip["id"])
    assert proposal["status"] == "complete", proposal["violations"]
    assert [p["strategy"] for p in proposal["alternatives"]] == ["time_shift", "place_shift"]
    route_evidence = RouteCatalog().evidence.id
    for plan in [proposal["baseline"], *proposal["alternatives"]]:
        # Real legs: Google-estimated walking routes, not demo assumptions.
        assert all(leg["source_kind"] == "estimated" and leg["evidence_ids"] == [route_evidence] for leg in plan["legs"])
    assert route_evidence in {e["id"] for e in proposal["evidence"]}
    plan = proposal["alternatives"][1]
    selected = client.post(f"/api/v1/trips/{trip['id']}/proposals/{proposal['id']}/selection", json={"plan_id": plan["id"], "expected_version": 1, "idempotency_key": str(uuid4())})
    assert selected.status_code == 200


def test_a_must_spot_on_its_closing_day_is_not_planned(client):
    trip = client.post("/api/v1/trips", json=trip_body(TUESDAY, [("yamamotoya-honke", "must"), ("osu-kannon", "optional")], ["food"])).json()["trip"]
    proposal = generate(client, trip["id"])
    assert proposal["status"] == "no_feasible_plan"
    assert {(v["code"], v["spot_id"]) for v in proposal["violations"]} >= {("CLOSED", "yamamotoya-honke")}
