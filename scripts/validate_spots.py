"""Validate curated candidate metadata. Does not certify facts or redistribution rights."""
import argparse
import json
import sys
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.schemas.contracts import SpotListResponse


def check_curated(data: SpotListResponse, visit_date: date, min_spots: int = 8) -> list[str]:
    errors = []
    if len(data.items) < min_spots:
        errors.append(f"Need at least {min_spots} candidates; got {len(data.items)}")
    if len({s.area_id for s in data.items}) != 1:
        errors.append("All candidates must be in one area")
    evidence = {item.id: item for item in data.evidence}
    for spot in data.items:
        if spot.is_demo:
            errors.append(f"{spot.id}: demo candidate cannot be a curated real candidate")
        refs = [evidence[ref] for ref in spot.evidence_ids]
        if not refs or any(ref.is_demo or ref.checked_at is None or not ref.source_url for ref in refs):
            errors.append(f"{spot.id}: needs non-demo evidence, source URL and verification date")
        if spot.stay_seconds > 0:
            if spot.opening_status != "verified" or not spot.opening_windows:
                errors.append(f"{spot.id}: visit candidate needs verified opening windows")
            if spot.reservation_required is None:
                errors.append(f"{spot.id}: reservation requirements are unknown")
        for window in spot.opening_windows:
            if window.opens_at.astimezone(ZoneInfo("Asia/Tokyo")).date() != visit_date or window.closes_at.astimezone(ZoneInfo("Asia/Tokyo")).date() != visit_date:
                errors.append(f"{spot.id}: opening windows do not match the requested Japan date")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, nargs="?")
    parser.add_argument("--visit-date", type=date.fromisoformat)
    parser.add_argument("--min-spots", type=int, default=8)
    parser.add_argument("--schema", action="store_true")
    args = parser.parse_args()
    if args.schema:
        print(json.dumps(SpotListResponse.model_json_schema(), ensure_ascii=False, indent=2))
        return
    if args.path is None or args.visit_date is None or not 1 <= args.min_spots <= 12:
        parser.error("Provide a JSON path, --visit-date YYYY-MM-DD and --min-spots between 1 and 12")
    if not args.path.is_file():
        parser.error("Candidate data file does not exist yet; see data/curated/README.md")
    data = SpotListResponse.model_validate_json(args.path.read_text(encoding="utf-8-sig"))
    errors = check_curated(data, args.visit_date, args.min_spots)
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"PASS: {len(data.items)} candidate records. Metadata checks only; humans must verify facts, walking routes and reuse rights.")


if __name__ == "__main__":
    main()
