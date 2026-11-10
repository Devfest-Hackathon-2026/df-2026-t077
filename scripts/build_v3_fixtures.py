"""Deterministic synthetic contract examples; never a route optimizer or real places."""
import copy
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.schemas.contracts import PUBLIC_MODELS

DEST = ROOT / "contracts/fixtures/v3"
NOW = "2026-11-05T09:00:00+09:00"
REQUEST_ID = "00000000-0000-4000-8000-000000000001"


def at(hour, minute=0):
    return f"2026-11-05T{hour:02}:{minute:02}:00+09:00"


def evidence(locale):
    return [{"id": "demo-evidence", "source_kind": "demo", "provider": "team-synthetic-fixture", "title": "架空の開発サンプル" if locale == "ja" else "Synthetic development sample", "source_url": None, "checked_at": NOW, "confidence": "unknown", "is_demo": True, "note": "施設・座標・経路・営業時間は架空。実際の旅行には使えません。" if locale == "ja" else "Places, coordinates, routes and hours are synthetic. Do not use for travel."}]


def constraints(locale, unknown=False):
    return {"area_id": "demo-area", "timezone": "Asia/Tokyo", "start_at": NOW, "end_at": at(13), "start_spot_id": "demo-origin", "end_spot_id": "demo-origin", "mode": "walking", "max_walk_meters": 3000, "max_visits": 3, "interests": ["history", "quiet"], "party_size": 1, "locale": locale, "avoid_windows": [{"id": "avoid-museum", "spot_id": "demo-museum", "starts_at": NOW, "ends_at": at(10), "basis": "demo_assumption", "evidence_ids": ["demo-evidence"], "note": "demo preference, not measured crowd"}], "wait_assumptions": [] if unknown else [{"spot_id": "demo-museum", "wait_seconds": 600, "basis": "demo_assumption", "observed_at": None, "note": "same assumption for all plans"}], "omakase_visits": 0}


REQUESTED = [{"spot_id": "demo-museum", "requirement": "must", "locked_start_at": None, "reservation_confirmed": False}, {"spot_id": "demo-cafe", "requirement": "optional", "locked_start_at": None, "reservation_confirmed": False}]


def plan(strategy, c):
    locale = c["locale"]
    ja = locale == "ja"
    sequence = ["demo-museum", "demo-garden" if strategy == "place_shift" else "demo-cafe"]
    if strategy == "time_shift":
        sequence.reverse()
    waits = {w["spot_id"]: w["wait_seconds"] for w in c["wait_assumptions"]}
    start = datetime.fromisoformat(NOW)
    current = start
    stops = [{"id": "origin", "spot_id": "demo-origin", "role": "origin", "requirement": None, "arrival_at": NOW, "start_at": NOW, "departure_at": NOW, "locked_start_at": None, "opening_wait_seconds": 0, "queue_seconds": 0, "schedule_wait_seconds": 0, "evidence_ids": ["demo-evidence"]}]
    legs = []
    for index, spot in enumerate(sequence + ["demo-origin"]):
        arrival = current + timedelta(seconds=720)
        queue = waits.get(spot, 0) if index < 2 else 0
        visit_start = arrival + timedelta(seconds=queue)
        if strategy == "time_shift" and spot == "demo-museum":
            visit_start = max(visit_start, datetime.fromisoformat(at(10)))
        schedule = int((visit_start - arrival).total_seconds()) - queue
        duration = (1800 if spot == "demo-museum" else 1200) if index < 2 else 0
        departure = visit_start + timedelta(seconds=duration)
        sid = f"stop-{index}"
        legs.append({"from_stop_id": stops[-1]["id"], "to_stop_id": sid, "mode": "walking", "duration_seconds": 600, "buffer_seconds": 120, "distance_meters": 500, "source_kind": "demo", "evidence_ids": ["demo-evidence"]})
        stops.append({"id": sid, "spot_id": spot, "role": "visit" if index < 2 else "destination", "requirement": ("must" if spot == "demo-museum" else "optional") if index < 2 else None, "arrival_at": arrival.isoformat(), "start_at": visit_start.isoformat(), "departure_at": departure.isoformat(), "locked_start_at": None, "opening_wait_seconds": 0, "queue_seconds": queue, "schedule_wait_seconds": schedule, "evidence_ids": ["demo-evidence"]})
        current = departure
    overlap = 0
    for stop in stops[1:-1]:
        for window in c["avoid_windows"]:
            if stop["spot_id"] == window["spot_id"]:
                overlap += max(0, int((min(datetime.fromisoformat(stop["departure_at"]), datetime.fromisoformat(window["ends_at"])) - max(datetime.fromisoformat(stop["start_at"]), datetime.fromisoformat(window["starts_at"]))).total_seconds()))
    texts = {
        "baseline": ("元の訪問順を保つ架空サンプルです。", "Synthetic sample preserving the requested visit order."),
        "time_shift": ("必須の訪問先を保ち、本人が避けたい時間帯を外す架空サンプルです。", "Synthetic sample retaining required visits and avoiding the requested time window."),
        "place_shift": ("任意のカフェを庭園に交換する架空サンプルです。", "Synthetic sample replacing the optional cafe with a garden."),
    }
    facts = [{"id": "reason", "kind": "change", "text": texts[strategy][0 if ja else 1], "evidence_ids": ["demo-evidence"], "is_demo": True}, {"id": "tradeoff", "kind": "tradeoff", "text": ("カフェの体験を失います。" if strategy == "place_shift" else "時間の変更には待機や順序変更が伴います。") if ja else ("The cafe experience is lost." if strategy == "place_shift" else "Changing time can add waiting or change visit order."), "evidence_ids": ["demo-evidence"], "is_demo": True}, {"id": "uncertainty", "kind": "uncertainty", "text": "混雑は不明です。未入力の待ち時間は計算に含めていません。" if ja else "Crowding is unknown. Unspecified queue times are not included.", "evidence_ids": ["demo-evidence"], "is_demo": True}]
    changes = []
    if strategy != "baseline":
        changes.append({"kind": "place_replacement" if strategy == "place_shift" else "time_shift", "original_spot_id": "demo-cafe" if strategy == "place_shift" else "demo-museum", "replacement_spot_id": "demo-garden" if strategy == "place_shift" else None, "before_start_at": None, "after_start_at": None, "reason_fact_ids": ["reason"]})
    return {"id": f"plan-{strategy}", "strategy": strategy, "stops": stops, "legs": legs, "metrics": {"walk_meters": 1500, "travel_seconds": 1800, "total_seconds": int((current-start).total_seconds()), "finish_slack_seconds": int((datetime.fromisoformat(c["end_at"])-current).total_seconds()), "modeled_queue_seconds": sum(s["queue_seconds"] for s in stops), "schedule_wait_seconds": sum(s["schedule_wait_seconds"] for s in stops), "avoid_overlap_seconds": overlap, "optional_kept_count": 0 if strategy == "place_shift" else 1, "optional_replaced_count": int(strategy == "place_shift"), "optional_removed_count": 0, "wait_not_included_spot_ids": [s for s in sequence if s not in waits]}, "facts": facts, "explanation": {"summary": texts[strategy][0 if ja else 1], "reason_fact_ids": ["reason"], "tradeoff_fact_ids": ["tradeoff"], "uncertainty_fact_ids": ["uncertainty"], "generation_mode": "template"}, "changes": changes, "warnings": [facts[2]["text"]]}


def bundle(locale, scenario):
    c = constraints(locale, unknown=scenario == "unknown")
    result = {"id": "demo-proposal", "trip_id": "demo-trip", "base_version": 1, "request": {"client_request_id": REQUEST_ID, "base_version": 1, "mode": "initial", "constraint_overrides": {}}, "effective_constraints": c, "baseline": plan("baseline", c), "alternatives": [plan("time_shift", c), plan("place_shift", c)], "evidence": evidence(locale), "status": "complete", "violations": [], "warnings": [], "created_at": NOW}
    if scenario in {"time_shift", "place_shift"}:
        result["alternatives"] = [p for p in result["alternatives"] if p["strategy"] == scenario]
    if scenario == "partial":
        result.update(status="partial", warnings=["EXPLANATION_FALLBACK"])
    if scenario == "no_feasible":
        result.update(status="no_feasible_plan", baseline=None, alternatives=[], violations=[{"code": "WALK_LIMIT", "spot_id": None, "message": "徒歩上限で不成立の架空サンプル" if locale == "ja" else "Synthetic infeasible walking-limit example", "suggested_action": "条件を確認" if locale == "ja" else "Review your constraints"}])
        c["max_walk_meters"] = 100
    return result


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = []
    def save(name, model, value):
        PUBLIC_MODELS[model].model_validate(value)
        (DEST/name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        manifest.append({"file": name, "model": model})
    for locale in ["ja", "en"]:
        spots = []
        names = [("origin", "起終点", "Start / finish"), ("museum", "資料館", "Museum"), ("cafe", "カフェ", "Cafe"), ("garden", "庭園", "Garden"), ("art", "工房", "Studio"), ("park", "公園", "Park"), ("market", "市場", "Market"), ("gallery", "展示室", "Gallery")]
        for index, (sid, ja, en) in enumerate(names):
            spots.append({"id": "demo-"+sid, "area_id": "demo-area", "google_place_id": None, "name_ja": "架空"+ja, "name_en": "Demo "+en, "description_ja": "実在しない開発用施設です。", "description_en": "A synthetic development-only place.", "visitor_info_ja": "料金・営業時間等は検証用の仮定です。", "visitor_info_en": "Fees and hours are synthetic test assumptions.", "reservation_required": False, "location": {"lat": 35.18 + index * .001, "lng": 136.9}, "tags": ["history" if sid == "museum" else "quiet"], "stay_seconds": 0 if sid == "origin" else (1800 if sid == "museum" else 1200), "opening_status": "verified", "opening_windows": [{"opens_at": NOW, "closes_at": at(18)}], "evidence_ids": ["demo-evidence"], "is_demo": True})
        save(f"spots.{locale}.json", "SpotListResponse", {"items": spots, "evidence": evidence(locale)})
        trip = {"id": "demo-trip", "constraints": constraints(locale), "requested_stops": REQUESTED, "version": 1, "active_selection": None, "created_at": NOW, "updated_at": NOW}
        save(f"trip.{locale}.json", "TripResponse", {"trip": trip, "active_plan": None, "evidence": evidence(locale)})
        for scenario in ["normal", "time_shift", "place_shift", "unknown", "partial", "no_feasible"]:
            save(f"proposal-{scenario}.{locale}.json", "ProposalBundle", bundle(locale, scenario))
        draft = {"draft": {"interests": None, "requested_stops": [], "max_walk_meters": None, "end_at": None, "avoid_windows": [], "wait_assumptions": [], "field_notes": []}, "unresolved": [{"field": "max_walk_meters", "question": "歩ける距離を入力してください。" if locale == "ja" else "Enter your walking limit.", "source_quote": "あまり歩きたくない" if locale == "ja" else "I do not want to walk much"}], "warnings": [], "generation_mode": "template", "requires_confirmation": True}
        save(f"intent-ambiguous.{locale}.json", "IntentDraftResponse", draft)
        conflict = copy.deepcopy(draft)
        conflict["unresolved"][0].update(field="requested_stops", source_quote="変更不可 / fixed", question="固定した希望と異なるため確認してください。" if locale == "ja" else "Confirm this conflict with your fixed preferences.")
        save(f"intent-conflict.{locale}.json", "IntentDraftResponse", conflict)
        selection = copy.deepcopy(trip)
        selection.update(version=2, active_selection={"proposal_id": "demo-proposal", "plan_id": "plan-time_shift", "selected_at": at(9, 1)}, updated_at=at(9, 1))
        save(f"selection.{locale}.json", "SelectionResponse", {"trip": selection, "active_plan": plan("time_shift", constraints(locale)), "evidence": evidence(locale)})
    save("trip-create.request.json", "TripCreateRequest", {"client_request_id": REQUEST_ID, "constraints": constraints("ja"), "requested_stops": REQUESTED, "intent_confirmed": True})
    save("conflict.response.json", "ErrorResponse", {"error": {"code": "VERSION_CONFLICT", "message": "VERSION_CONFLICT", "details": [], "request_id": REQUEST_ID}})
    save("intent.request.json", "IntentInterpretRequest", {"client_request_id": REQUEST_ID, "area_id": "demo-area", "visit_date": "2026-11-05", "locale": "ja", "text": "あまり歩きたくない", "current_input": {"constraints": {"max_walk_meters": 3000}}})
    (DEST/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
    print(f"Generated and validated {len(manifest)} v3 synthetic fixtures.")


if __name__ == "__main__":
    main()
