"""Cross-resource checks supplement the DTO invariants."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.schemas.contracts import PUBLIC_MODELS, ProposalBundle


def main():
    folder = ROOT/"contracts/fixtures/v3"
    loaded = {}
    for entry in json.loads((folder/"manifest.json").read_text(encoding="utf-8")):
        loaded[entry["file"]] = PUBLIC_MODELS[entry["model"]].model_validate_json((folder/entry["file"]).read_text(encoding="utf-8"))
    for locale in ["ja", "en"]:
        spots = {spot.id: spot for spot in loaded[f"spots.{locale}.json"].items}
        requested = loaded[f"trip.{locale}.json"].trip.requested_stops
        for name, bundle in loaded.items():
            if not isinstance(bundle, ProposalBundle) or bundle.effective_constraints.locale != locale:
                continue
            for plan in ([bundle.baseline] if bundle.baseline else []) + bundle.alternatives:
                visits = {stop.spot_id: stop for stop in plan.stops[1:-1]}
                assert {stop.spot_id for stop in requested if stop.requirement == "must"} <= visits.keys()
                for stop in visits.values():
                    spot = spots[stop.spot_id]
                    assert spot.opening_status == "verified"
                    assert any(w.opens_at <= stop.start_at <= stop.departure_at <= w.closes_at for w in spot.opening_windows)
                    assert (stop.departure_at-stop.start_at).total_seconds() == spot.stay_seconds
                    assert not spot.reservation_required
        for scenario in ["normal", "unknown", "partial", "no_feasible", "time_shift", "place_shift"]:
            ja = loaded[f"proposal-{scenario}.ja.json"]
            en = loaded[f"proposal-{scenario}.en.json"]
            for left, right in zip(([ja.baseline] if ja.baseline else []) + ja.alternatives, ([en.baseline] if en.baseline else []) + en.alternatives):
                assert left.metrics == right.metrics and left.stops == right.stops and left.legs == right.legs
    print(f"PASS: {len(loaded)} v3 fixtures; must, opening, return legs, fair queues, unknown waits, references and ja/en numerical parity.")


if __name__ == "__main__":
    main()
