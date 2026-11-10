"""Read-only spot catalog. Spots are prepared by the team, never written by users."""
import json
from datetime import date, datetime
from pathlib import Path

from app.core.errors import unavailable
from app.schemas.contracts import JST, Evidence, Locale, Spot, SpotListResponse

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "contracts/fixtures/v3"
CURATED = ROOT / "data/curated"
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _on_date(value: datetime, visit_date: date) -> datetime:
    local = value.astimezone(JST)
    return datetime.combine(visit_date, local.timetz())


def _dated(spot: Spot, visit_date: date) -> Spot:
    windows = [
        window.model_copy(update={"opens_at": _on_date(window.opens_at, visit_date), "closes_at": _on_date(window.closes_at, visit_date)})
        for window in spot.opening_windows
    ]
    return spot.model_copy(update={"opening_windows": windows})


def _listing(source: SpotListResponse, area_id: str, q: str | None, dated) -> SpotListResponse | None:
    """None means the area is not configured."""
    items = [spot for spot in source.items if spot.area_id == area_id]
    if not items:
        return None
    if q:
        needle = q.casefold()
        items = [spot for spot in items if needle in spot.name_ja.casefold() or needle in spot.name_en.casefold()]
    items = [dated(spot) for spot in items]
    referenced = {ref for spot in items for ref in spot.evidence_ids}
    return SpotListResponse(items=items, evidence=[e for e in source.evidence if e.id in referenced])


class DemoSpotCatalog:
    """Fictional demo spots from the v3 fixtures (is_demo=true). Opening windows are moved to the visit date."""

    def __init__(self, fixtures: Path = FIXTURES):
        self._data = {
            locale: SpotListResponse.model_validate(json.loads((fixtures / f"spots.{locale}.json").read_text(encoding="utf-8")))
            for locale in ("ja", "en")
        }

    def list(self, area_id: str, visit_date: date, locale: Locale, q: str | None = None) -> SpotListResponse | None:
        return _listing(self._data[locale], area_id, q, lambda spot: _dated(spot, visit_date))

    def evidence(self, locale: Locale) -> dict[str, Evidence]:
        return {item.id: item for item in self._data[locale].evidence}


class CuratedSpotCatalog:
    """Real spots from data/curated/spots.json (team-confirmed, with evidence).

    The file holds one reference day of regular hours. Those hours are copied onto the requested date, and a
    spot is served as closed on its regular closing days (closures.json), so the planner never schedules a
    visit on a known closed weekday. Spots carry ja/en fields; evidence is one shared set for both locales.
    """

    def __init__(self, directory: Path = CURATED):
        self._data = SpotListResponse.model_validate(json.loads((directory / "spots.json").read_text(encoding="utf-8")))
        closures = json.loads((directory / "closures.json").read_text(encoding="utf-8"))
        self._weekly: dict[str, set[str]] = {spot_id: set(days) for spot_id, days in closures["weekly"].items()}
        self._annual: dict[str, list[tuple[tuple[int, int], tuple[int, int]]]] = {
            spot_id: [(_month_day(r["from"]), _month_day(r["to"])) for r in ranges] for spot_id, ranges in closures["annual"].items()
        }
        known = {spot.id for spot in self._data.items}
        unknown = (set(self._weekly) | set(self._annual)) - known
        if unknown:
            raise ValueError(f"closures refer to unknown spots: {sorted(unknown)}")
        if any(day not in WEEKDAYS for days in self._weekly.values() for day in days):
            raise ValueError("weekly closures must use mon..sun")

    def list(self, area_id: str, visit_date: date, locale: Locale, q: str | None = None) -> SpotListResponse | None:
        return _listing(self._data, area_id, q, lambda spot: self._on(spot, visit_date))

    def evidence(self, locale: Locale) -> dict[str, Evidence]:
        return {item.id: item for item in self._data.evidence}

    def _on(self, spot: Spot, visit_date: date) -> Spot:
        if self._closed(spot.id, visit_date):
            return spot.model_copy(update={"opening_status": "closed", "opening_windows": []})
        return _dated(spot, visit_date)

    def _closed(self, spot_id: str, visit_date: date) -> bool:
        if WEEKDAYS[visit_date.weekday()] in self._weekly.get(spot_id, set()):
            return True
        day = (visit_date.month, visit_date.day)
        # A range like 12-29..01-01 wraps the new year.
        return any(start <= day <= end if start <= end else day >= start or day <= end for start, end in self._annual.get(spot_id, []))


def _month_day(value: str) -> tuple[int, int]:
    month, day = (int(part) for part in value.split("-"))
    date(2000, month, day)  # reject impossible dates (2000 is a leap year, so 02-29 is allowed)
    return month, day


class UnavailableSpotCatalog:
    """curated mode without data/curated/spots.json: fail explicitly instead of serving demo data."""

    def list(self, *args, **kwargs):
        raise unavailable()

    def evidence(self, locale):
        raise unavailable()


def spot_catalog_for(data_mode: str):
    if data_mode == "demo":
        return DemoSpotCatalog()
    return CuratedSpotCatalog() if (CURATED / "spots.json").exists() else UnavailableSpotCatalog()
