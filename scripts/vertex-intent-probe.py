"""One-shot ja/en probe for the intent adapter without logging text or responses."""

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.adapters.gemini_intent import (
    GeminiIntentInterpreter,
    GoogleGenAIIntentClient,
)
from app.core.settings import Settings
from app.schemas.contracts import IntentInterpretRequest, SpotListResponse


def load_spots():
    path = ROOT / "contracts" / "fixtures" / "v3" / "spots.en.json"
    return tuple(SpotListResponse.model_validate_json(path.read_text(encoding="utf-8")).items)


def request_for(locale: str) -> IntentInterpretRequest:
    text = (
        "架空資料館には必ず行きたい。静かな場所にも寄りたい。歩行は2kmまで。"
        if locale == "ja"
        else "I must visit Demo Museum, prefer a quiet place, and can walk up to 2 km."
    )
    return IntentInterpretRequest.model_validate(
        {
            "client_request_id": "00000000-0000-4000-8000-000000000123",
            "area_id": "demo-area",
            "visit_date": "2026-11-05",
            "locale": locale,
            "text": text,
            "current_input": {},
        }
    )


async def run() -> int:
    started = time.monotonic()
    spots = load_spots()
    allowed_ids = {spot.id for spot in spots}
    interpreter = GeminiIntentInterpreter(GoogleGenAIIntentClient(Settings()))
    results = []
    for locale in ("ja", "en"):
        response = await interpreter.interpret(
            request_for(locale),
            spots,
            time.monotonic() + 25,
        )
        returned_ids = {stop.spot_id for stop in response.draft.requested_stops}
        results.append(
            {
                "locale": locale,
                "generation_mode": response.generation_mode,
                "requires_confirmation": response.requires_confirmation,
                "allowed_ids_only": returned_ids <= allowed_ids,
                "requested_stop_count": len(returned_ids),
                "unresolved_count": len(response.unresolved),
            }
        )
    ok = all(
        result["generation_mode"] == "gemini"
        and result["requires_confirmation"]
        and result["allowed_ids_only"]
        for result in results
    )
    print(
        json.dumps(
            {
                "status": "ok" if ok else "failed",
                "elapsed_ms": round((time.monotonic() - started) * 1000),
                "results": results,
                "input_logged": False,
                "response_logged": False,
                "credentials_logged": False,
            },
            ensure_ascii=True,
            sort_keys=True,
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
