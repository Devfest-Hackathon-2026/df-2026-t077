"""Safe real-Vertex probe for B-04; prints no Fact text, model output or credentials."""

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.adapters.gemini_explainer import (
    GeminiExplainer,
    GoogleGenAIExplanationClient,
)
from app.core.settings import Settings
from app.domain.ports import ExplanationInput
from app.schemas.contracts import Fact


def probe_facts(locale: str) -> tuple[Fact, ...]:
    texts = (
        (
            "訪問先を保ち、本人が避けたい時間帯との重複を減らす時間案です。",
            "予定調整の待機があり、実際の混雑減少を示すものではありません。",
            "待ち時間が未入力の場所は計算に含めていません。",
        )
        if locale == "ja"
        else (
            "This time option keeps every visit and reduces overlap with the user's avoid window.",
            "It adds schedule waiting and does not demonstrate actual crowd reduction.",
            "Unspecified waits are not included in the calculation.",
        )
    )
    return (
        Fact(id="reason", kind="change", text=texts[0], evidence_ids=[], is_demo=False),
        Fact(id="tradeoff", kind="tradeoff", text=texts[1], evidence_ids=[], is_demo=False),
        Fact(id="uncertainty", kind="uncertainty", text=texts[2], evidence_ids=[], is_demo=False),
    )


async def main() -> int:
    settings = Settings()
    explainer = GeminiExplainer(GoogleGenAIExplanationClient(settings))
    results = []
    started = time.monotonic()
    for locale in ("ja", "en"):
        facts = probe_facts(locale)
        explanation = await explainer.explain(
            ExplanationInput(locale=locale, facts=facts),
            time.monotonic() + 15,
        )
        known = {fact.id for fact in facts}
        refs = {
            *explanation.reason_fact_ids,
            *explanation.tradeoff_fact_ids,
            *explanation.uncertainty_fact_ids,
        }
        results.append(
            {
                "locale": locale,
                "generation_mode": explanation.generation_mode,
                "references_valid": refs <= known,
                "reason_count": len(explanation.reason_fact_ids),
                "tradeoff_count": len(explanation.tradeoff_fact_ids),
                "uncertainty_count": len(explanation.uncertainty_fact_ids),
            }
        )
    ok = all(
        item["generation_mode"] == "gemini"
        and item["references_valid"]
        and item["reason_count"] >= 1
        and item["tradeoff_count"] == 1
        and item["uncertainty_count"] == 1
        for item in results
    )
    print(
        json.dumps(
            {
                "status": "ok" if ok else "failed",
                "elapsed_ms": round((time.monotonic() - started) * 1000),
                "input_logged": False,
                "response_logged": False,
                "credentials_logged": False,
                "results": results,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
