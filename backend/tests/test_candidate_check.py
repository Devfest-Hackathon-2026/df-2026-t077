import copy
import importlib.util
import json
from datetime import date
from pathlib import Path

from app.schemas.contracts import SpotListResponse

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("candidate_check", ROOT/"scripts/validate_spots.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_candidate_check_rejects_demo_data_and_wrong_visit_date():
    path = ROOT/"contracts/fixtures/v3/spots.ja.json"
    data = SpotListResponse.model_validate_json(path.read_text(encoding="utf-8"))
    errors = module.check_curated(data, date(2026, 11, 6))
    assert any("demo candidate" in error for error in errors)
    assert any("requested Japan date" in error for error in errors)


def test_candidate_check_requires_sources_even_when_demo_labels_are_removed():
    value = json.loads((ROOT/"contracts/fixtures/v3/spots.ja.json").read_text(encoding="utf-8"))
    for spot in value["items"]:
        spot["is_demo"] = False
    value["evidence"][0].update(is_demo=False, source_kind="curated")
    data = SpotListResponse.model_validate(copy.deepcopy(value))
    assert any("source URL" in error for error in module.check_curated(data, date(2026, 11, 5)))
