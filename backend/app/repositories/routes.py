"""Walking routes between curated spots, read from data/curated/routes.json (team-prepared snapshot),
and labelled demo legs between the fictional demo spots (DATA_MODE=demo).

The planner (B) only receives RouteEstimate values; it never calls a map provider itself.
"""
import json
from collections.abc import Iterable
from itertools import permutations
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

from app.domain.ports import PersistenceHint, RouteEstimate
from app.schemas.contracts import Evidence, Spot, SpotListResponse

CURATED_ROUTES = Path(__file__).resolve().parents[3] / "data/curated/routes.json"


class RouteCatalog:
    def __init__(self, path: Path = CURATED_ROUTES):
        document = json.loads(path.read_text(encoding="utf-8"))
        self.evidence = Evidence.model_validate(document["evidence"])
        # Google Maps terms restrict caching: the snapshot is demo-only, so results are marked non-persistable.
        hint = PersistenceHint(
            persistable=False,
            expires_at=None,
            required_attribution=document["attribution"],
            provider=document["provider"],
            reference=None,
        )
        self._routes: dict[tuple[str, str], RouteEstimate] = {}
        for pair in document["pairs"]:
            key = (pair["from_spot_id"], pair["to_spot_id"])
            if key in self._routes or key[0] == key[1]:
                raise ValueError(f"duplicate or self route: {key}")
            if pair["duration_seconds"] < 0 or pair["distance_meters"] < 0:
                raise ValueError(f"negative route value: {key}")
            self._routes[key] = RouteEstimate(
                from_spot_id=key[0],
                to_spot_id=key[1],
                duration_seconds=pair["duration_seconds"],
                distance_meters=pair["distance_meters"],
                source_kind=document["source_kind"],
                evidence_ids=(self.evidence.id,),
                persistence=hint,
            )

    def routes_between(self, spot_ids: Iterable[str]) -> tuple[RouteEstimate, ...]:
        """Every known ordered pair among the given spots. Missing pairs are left out so the planner reports ROUTE_UNKNOWN."""
        ids = list(dict.fromkeys(spot_ids))
        return tuple(self._routes[pair] for pair in permutations(ids, 2) if pair in self._routes)


DEMO_SPOTS = Path(__file__).resolve().parents[3] / "contracts/fixtures/v3/spots.ja.json"
DEMO_DETOUR_FACTOR = 1.3
DEMO_WALK_METERS_PER_SECOND = 1.2


class DemoRouteCatalog:
    """Assumed legs between the fictional v3 demo spots, for DATA_MODE=demo only.

    These are not walking routes: the fictional coordinates' straight-line distance times a fixed detour
    factor, at a fixed pace. Every leg is source_kind="demo" and cites the demo spots' own evidence, so the
    UI keeps the demo label. Real spots always use RouteCatalog (A-05); this class never sees them.
    """

    # Demo legs cite the spot evidence already in the listing, so no extra route Evidence is added.
    evidence: Evidence | None = None

    def __init__(self, path: Path = DEMO_SPOTS):
        listing = SpotListResponse.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if not all(spot.is_demo for spot in listing.items):
            raise ValueError("demo routes are only for demo spots")
        self._spots = {spot.id: spot for spot in listing.items}
        self._hint = PersistenceHint(persistable=True, expires_at=None, required_attribution=None, provider="demo", reference=None)

    def routes_between(self, spot_ids: Iterable[str]) -> tuple[RouteEstimate, ...]:
        ids = [spot_id for spot_id in dict.fromkeys(spot_ids) if spot_id in self._spots]
        return tuple(self._route(self._spots[a], self._spots[b]) for a, b in permutations(ids, 2))

    def _route(self, origin: Spot, target: Spot) -> RouteEstimate:
        meters = round(_straight_line_meters(origin, target) * DEMO_DETOUR_FACTOR / 10) * 10
        return RouteEstimate(
            from_spot_id=origin.id,
            to_spot_id=target.id,
            duration_seconds=round(meters / DEMO_WALK_METERS_PER_SECOND),
            distance_meters=meters,
            source_kind="demo",
            evidence_ids=tuple(dict.fromkeys([*origin.evidence_ids, *target.evidence_ids])),
            persistence=self._hint,
        )


def _straight_line_meters(a: Spot, b: Spot) -> float:
    lat1, lng1, lat2, lng2 = map(radians, (a.location.lat, a.location.lng, b.location.lat, b.location.lng))
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * asin(sqrt(h))


def route_catalog_for(data_mode: str):
    return DemoRouteCatalog() if data_mode == "demo" else RouteCatalog()
