"""Fetch walking durations/distances for every ordered pair in data/curated/route-points.json.

One-off, run by A on a developer machine with ADC (no API key):
    gcloud auth application-default login
    gcloud auth application-default set-quota-project zurashitabi
    backend/.venv/Scripts/python.exe scripts/fetch_route_matrix.py   # writes data/curated/routes.json

Google Maps Platform terms restrict caching route results. The team decided to store one snapshot
for the hackathon demo only, with attribution, and to delete it after the event (docs/DATA.md).
"""
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POINTS = ROOT / "data/curated/route-points.json"
OUTPUT = ROOT / "data/curated/routes.json"
ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
QUOTA_PROJECT = "zurashitabi"


def build_routes(points: list[dict], rows: list[dict], retrieved_at: str) -> dict:
    """Pure conversion from the API rows to the routes.json document."""
    ids = [p["id"] for p in points]
    pairs = []
    for row in sorted(rows, key=lambda r: (r.get("originIndex", 0), r.get("destinationIndex", 0))):
        i, j = row.get("originIndex", 0), row.get("destinationIndex", 0)
        if i == j:
            continue
        if row.get("condition") != "ROUTE_EXISTS" or "duration" not in row:
            raise ValueError(f"no walking route: {ids[i]} -> {ids[j]}")
        pairs.append({
            "from_spot_id": ids[i],
            "to_spot_id": ids[j],
            "duration_seconds": int(row["duration"].rstrip("s")),
            "distance_meters": int(row["distanceMeters"]),
        })
    return {
        "provider": "google_maps_routes",
        "travel_mode": "WALK",
        "retrieved_at": retrieved_at,
        "source_kind": "estimated",
        "usage": "hackathon demo only; delete after the event",
        "attribution": "Google Maps",
        "evidence": {
            "id": "route-google-maps-" + retrieved_at[:10].replace("-", ""),
            "source_kind": "estimated",
            "provider": "Google Maps Platform Routes API",
            "title": "Walking route estimate / 徒歩経路の推定",
            "source_url": "https://developers.google.com/maps/documentation/routes",
            "checked_at": retrieved_at,
            "confidence": "medium",
            "is_demo": False,
            "note": "Google Maps walking estimate between entrance points. Not a measured time.",
        },
        "pairs": pairs,
    }


def fetch_rows(points: list[dict]) -> list[dict]:
    import google.auth
    import httpx
    from google.auth.transport.requests import Request

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(Request())
    waypoints = [{"waypoint": {"location": {"latLng": {"latitude": p["lat"], "longitude": p["lng"]}}}} for p in points]
    response = httpx.post(
        ENDPOINT,
        headers={
            "Authorization": "Bearer " + credentials.token,
            "X-Goog-User-Project": QUOTA_PROJECT,
            "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
        },
        json={"origins": waypoints, "destinations": waypoints, "travelMode": "WALK"},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def main() -> int:
    points = json.loads(POINTS.read_text(encoding="utf-8"))["points"]
    retrieved_at = datetime.now().astimezone().isoformat(timespec="seconds")
    document = build_routes(points, fetch_rows(points), retrieved_at)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(document['pairs'])} pairs to {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
