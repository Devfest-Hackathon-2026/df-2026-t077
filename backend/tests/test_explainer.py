import copy
import time
from dataclasses import replace

import pytest
from test_planner_alternatives import context_with_alternative_routes

from app.adapters.gemini_explainer import GeminiExplainer
from app.domain.explainer import (
    RawExplanationOutput,
    reconcile_explanation,
    template_explanation,
)
from app.domain.planner import BaselinePlanner
from app.domain.ports import ExplanationInput
from app.schemas.contracts import Fact


def facts(locale: str = "ja") -> tuple[Fact, ...]:
    if locale == "ja":
        texts = (
            "オアシス21を含む場所案です。",
            "元の体験は失われ、徒歩時間も変わります。",
            "待ち時間は未入力であり、空いているという意味ではありません。",
        )
    else:
        texts = (
            "This option includes Oasis 21.",
            "The original experience is lost and walking time changes.",
            "Wait time is unknown; this does not mean the place is empty.",
        )
    return (
        Fact(
            id="reason",
            kind="change",
            text=texts[0],
            evidence_ids=["spot-source"],
            is_demo=False,
        ),
        Fact(
            id="tradeoff",
            kind="tradeoff",
            text=texts[1],
            evidence_ids=[],
            is_demo=False,
        ),
        Fact(
            id="uncertainty",
            kind="uncertainty",
            text=texts[2],
            evidence_ids=[],
            is_demo=False,
        ),
    )


def raw(summary: str) -> RawExplanationOutput:
    return RawExplanationOutput(
        summary=summary,
        reason_fact_ids=["reason"],
        tradeoff_fact_ids=["tradeoff"],
        uncertainty_fact_ids=["uncertainty"],
    )


class FakeClient:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = 0

    async def generate(self, request, timeout_seconds):
        self.calls += 1
        assert 0 < timeout_seconds <= 8
        if self.error:
            raise self.error
        return self.result


def test_reconciles_japanese_summary_and_grounded_references():
    request = ExplanationInput(locale="ja", facts=facts())
    result = reconcile_explanation(
        request,
        raw("訪問先を変えた案です。不利益と不確実性も確認してください。"),
    )
    assert result.generation_mode == "gemini"
    assert result.reason_fact_ids == ["reason"]
    assert result.tradeoff_fact_ids == ["tradeoff"]
    assert result.uncertainty_fact_ids == ["uncertainty"]


def test_reconciles_english_without_changing_fact_values():
    request = ExplanationInput(locale="en", facts=facts("en"))
    before = copy.deepcopy(request)
    result = reconcile_explanation(
        request,
        raw("This option changes the visit while retaining the documented caveats."),
    )
    assert result.generation_mode == "gemini"
    assert request == before


@pytest.mark.parametrize(
    "field,value",
    [
        ("reason_fact_ids", ["missing"]),
        ("tradeoff_fact_ids", ["reason"]),
        ("uncertainty_fact_ids", []),
    ],
)
def test_rejects_unknown_wrong_kind_or_omitted_safety_fact(field, value):
    values = raw("確認済み情報だけをまとめた案です。").model_dump()
    values[field] = value
    with pytest.raises(ValueError):
        reconcile_explanation(
            ExplanationInput(locale="ja", facts=facts()),
            RawExplanationOutput.model_validate(values),
        )


def test_rejects_numeric_detail_in_summary():
    with pytest.raises(ValueError, match="numeric"):
        reconcile_explanation(
            ExplanationInput(locale="ja", facts=facts()),
            raw("徒歩時間を10分減らす案です。"),
        )


def test_rejects_unseen_name_in_summary():
    with pytest.raises(ValueError, match="name"):
        reconcile_explanation(
            ExplanationInput(locale="en", facts=facts("en")),
            raw("This option adds Tokyo while retaining the documented caveats."),
        )


def test_template_fallback_keeps_all_tradeoffs_and_uncertainties():
    result = template_explanation(ExplanationInput(locale="ja", facts=facts()))
    assert result.generation_mode == "template"
    assert result.summary == facts()[0].text
    assert result.tradeoff_fact_ids == ["tradeoff"]
    assert result.uncertainty_fact_ids == ["uncertainty"]


@pytest.mark.asyncio
async def test_timeout_returns_template_fallback():
    request = ExplanationInput(locale="en", facts=facts("en"))
    result = await GeminiExplainer(FakeClient(error=TimeoutError())).explain(
        request,
        time.monotonic() + 10,
    )
    assert result.generation_mode == "template"
    assert result.tradeoff_fact_ids == ["tradeoff"]


@pytest.mark.asyncio
async def test_expired_deadline_falls_back_without_client_call():
    client = FakeClient(result=raw("A grounded summary of this option."))
    result = await GeminiExplainer(client).explain(
        ExplanationInput(locale="en", facts=facts("en")),
        time.monotonic() - 1,
    )
    assert result.generation_mode == "template"
    assert client.calls == 0


class FixedExplainer:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    async def explain(self, request, deadline_monotonic):
        self.calls += 1
        if self.fail:
            raise RuntimeError("provider failed")
        fallback = template_explanation(request)
        return fallback.model_copy(
            update={"summary": "確認済みFactに基づく説明です。", "generation_mode": "gemini"}
        )


@pytest.mark.asyncio
async def test_planner_explains_baseline_and_both_alternatives_only():
    context = context_with_alternative_routes()
    explainer = FixedExplainer()
    before = copy.deepcopy(context)
    result = await BaselinePlanner().generate(replace(context, explainer=explainer))
    assert result.baseline is not None
    plans = (result.baseline, *result.alternatives)
    assert explainer.calls == len(plans) == 3
    assert all(plan.explanation.generation_mode == "gemini" for plan in plans)
    assert context == before


@pytest.mark.asyncio
async def test_explainer_failure_keeps_valid_plans_and_template_explanations():
    context = context_with_alternative_routes()
    result = await BaselinePlanner().generate(
        replace(context, explainer=FixedExplainer(fail=True))
    )
    assert result.baseline is not None
    plans = (result.baseline, *result.alternatives)
    assert len(plans) == 3
    assert all(plan.explanation.generation_mode == "template" for plan in plans)
    assert all(plan.facts for plan in plans)


@pytest.mark.parametrize(("locale", "summary"), [
    ("ja", "元の体験を変えて、空いている時間に訪れる案です。"),
    ("ja", "混雑を避けられる場所案です。"),
    ("en", "This option visits when it is less busy."),
    ("en", "This option avoids the crowds."),
])
def test_rejects_crowd_or_emptiness_claims(locale, summary):
    # The app has no crowd data, so the model may never claim a place or time is emptier.
    with pytest.raises(ValueError, match="crowding"):
        reconcile_explanation(ExplanationInput(locale=locale, facts=facts(locale)), raw(summary))


@pytest.mark.parametrize(("locale", "summary"), [
    ("ja", "場所を入れ替える案です。待ち時間は未入力であり、空いているという意味ではありません。"),
    ("en", "This option swaps a place. Wait time is unknown; this does not mean the place is empty."),
])
def test_accepts_a_disclaimer_copied_verbatim_from_a_fact(locale, summary):
    explanation = reconcile_explanation(ExplanationInput(locale=locale, facts=facts(locale)), raw(summary))
    assert explanation.generation_mode == "gemini"


@pytest.mark.parametrize(("locale", "summary"), [
    ("ja", "元の体験が変わるプランです。徒歩のルートも変わります。"),
    ("en", "Visit a different place on this route. The original experience is lost."),
])
def test_ordinary_words_and_sentence_starts_are_not_treated_as_names(locale, summary):
    explanation = reconcile_explanation(ExplanationInput(locale=locale, facts=facts(locale)), raw(summary))
    assert explanation.summary == summary


@pytest.mark.asyncio
async def test_fallback_keeps_the_planner_explanation_and_marks_the_result_partial():
    context = context_with_alternative_routes()
    plain = await BaselinePlanner().generate(context)
    result = await BaselinePlanner().generate(replace(context, explainer=FixedExplainer(fail=True)))
    assert result.status == "partial"
    assert "EXPLANATION_FALLBACK" in result.warnings
    # The planner's own template text is kept, not replaced by a generic fallback.
    assert [p.explanation for p in (result.baseline, *result.alternatives)] == [p.explanation for p in (plain.baseline, *plain.alternatives)]


@pytest.mark.asyncio
async def test_successful_explanations_keep_status_complete():
    result = await BaselinePlanner().generate(replace(context_with_alternative_routes(), explainer=FixedExplainer()))
    assert result.status == "complete" and "EXPLANATION_FALLBACK" not in result.warnings
