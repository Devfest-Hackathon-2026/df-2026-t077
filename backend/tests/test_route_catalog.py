"""A-05: curated walking-route snapshot is complete, plausible and attributed."""
import json
import math
from pathlib import Path

from app.repositories.routes import CURATED_ROUTES, RouteCatalog

ROOT = Path(__file__).resolve().parents[2]
POINTS = json.loads((ROOT / "data/curated/route-points.json").read_text(encoding="utf-8"))["points"]
DOCUMENT = json.loads(CURATED_ROUTES.read_text(encoding="utf-8"))


def straight_line_meters(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def test_every_ordered_pair_of_points_has_a_route():
    ids = [p["id"] for p in POINTS]
    routes = RouteCatalog().routes_between(ids)
    assert len(routes) == len(ids) * (len(ids) - 1)


def test_routes_are_plausible_walking_values():
    points = {p["id"]: p for p in POINTS}
    for pair in DOCUMENT["pairs"]:
        straight = straight_line_meters(points[pair["from_spot_id"]], points[pair["to_spot_id"]])
        # A walking route cannot be much shorter than the straight line (small tolerance for snapping to roads).
        assert pair["distance_meters"] >= straight - 20, pair
        # Walking pace between roughly 0.8 and 1.8 m/s, except very short hops.
        if pair["distance_meters"] > 100:
            assert 0.8 <= pair["distance_meters"] / pair["duration_seconds"] <= 1.8, pair


def test_routes_carry_source_and_demo_only_attribution():
    catalog = RouteCatalog()
    route = catalog.routes_between(["sakae-station", "oasis21"])[0]
    assert route.source_kind == "estimated"
    assert route.evidence_ids == (catalog.evidence.id,)
    assert route.persistence.persistable is False
    assert route.persistence.required_attribution == "Google Maps"
    assert catalog.evidence.checked_at is not None
    assert "demo" in DOCUMENT["usage"]


def test_missing_pairs_are_left_for_the_planner_to_report():
    routes = RouteCatalog().routes_between(["sakae-station", "not-a-curated-spot"])
    assert routes == ()
