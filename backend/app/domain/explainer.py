"""Deterministic validation and fallback for AI-authored plan explanations."""

import re

from pydantic import BaseModel, ConfigDict, Field

from app.domain.ports import ExplanationInput
from app.schemas.contracts import Explanation, Fact

REASON_KINDS = {"change", "interest", "travel", "timing", "opening"}
NAMED_TOKEN = re.compile(r"[A-Z][A-Za-z0-9'-]+|[A-Za-z]+(?:-[A-Za-z]+)+|[ァ-ヶー]{2,}")
# Ordinary nouns that look like names to NAMED_TOKEN but cannot introduce an unconfirmed place.
COMMON_WORDS = {
    "プラン", "ルート", "コース", "エリア", "スポット", "ペース", "スケジュール", "ポイント", "タイミング",
    "バランス", "メリット", "デメリット", "リスク", "オプション", "スタート", "ゴール", "ショッピング",
}
# The app has no crowd data: a summary may never claim that a place is less crowded or empty.
CROWD_CLAIM = re.compile(
    r"混雑|混み|混んで|空いて|空き|すいて|人混み|人出|ガラガラ|crowd|empty|busy|queue|lines? (?:is|are) short",
    re.IGNORECASE,
)
SENTENCE_START = re.compile(r"(^|[.!?]\s+)([A-Z])")
SENTENCE = re.compile(r"[^。.!?]+[。.!?]?")


class RawExplanationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=2000)
    reason_fact_ids: list[str] = Field(min_length=1, max_length=20)
    tradeoff_fact_ids: list[str] = Field(max_length=20)
    uncertainty_fact_ids: list[str] = Field(max_length=20)


def template_explanation(request: ExplanationInput) -> Explanation:
    facts = _fact_index(request.facts)
    reason_ids = [fact.id for fact in request.facts if fact.kind in REASON_KINDS]
    tradeoff_ids = [fact.id for fact in request.facts if fact.kind == "tradeoff"]
    uncertainty_ids = [fact.id for fact in request.facts if fact.kind == "uncertainty"]
    if reason_ids:
        summary = facts[reason_ids[0]].text
    else:
        summary = (
            "確定した情報を確認し、不利益と不確実性も比較してください。"
            if request.locale == "ja"
            else "Review the confirmed facts, including tradeoffs and uncertainties."
        )
    return Explanation(
        summary=summary,
        reason_fact_ids=reason_ids,
        tradeoff_fact_ids=tradeoff_ids,
        uncertainty_fact_ids=uncertainty_ids,
        generation_mode="template",
    )


def reconcile_explanation(
    request: ExplanationInput,
    raw: RawExplanationOutput,
) -> Explanation:
    facts = _fact_index(request.facts)
    _validate_refs(raw.reason_fact_ids, facts, REASON_KINDS, "reason")
    _validate_refs(raw.tradeoff_fact_ids, facts, {"tradeoff"}, "tradeoff")
    _validate_refs(raw.uncertainty_fact_ids, facts, {"uncertainty"}, "uncertainty")

    required_tradeoffs = {fact.id for fact in request.facts if fact.kind == "tradeoff"}
    required_uncertainties = {
        fact.id for fact in request.facts if fact.kind == "uncertainty"
    }
    if set(raw.tradeoff_fact_ids) != required_tradeoffs:
        raise ValueError("all tradeoff facts must be referenced")
    if set(raw.uncertainty_fact_ids) != required_uncertainties:
        raise ValueError("all uncertainty facts must be referenced")
    if any(character.isdigit() for character in raw.summary):
        raise ValueError("summary must not enumerate numeric details")
    fact_text = "\n".join(fact.text for fact in request.facts)
    if CROWD_CLAIM.search(_without_fact_sentences(raw.summary, request.facts)):
        # Only a disclaimer copied verbatim from a Fact (e.g. "...does not mean it is empty.") may mention it.
        raise ValueError("summary must not claim crowding or emptiness")
    # A capital at the start of a sentence is grammar, not a name.
    lowered_starts = SENTENCE_START.sub(lambda m: m.group(1) + m.group(2).lower(), raw.summary)
    unseen = [
        token
        for token in NAMED_TOKEN.findall(lowered_starts)
        if token.casefold() not in fact_text.casefold() and token not in COMMON_WORDS
    ]
    if unseen:
        raise ValueError("summary contains a name absent from facts")

    return Explanation(
        summary=raw.summary,
        reason_fact_ids=raw.reason_fact_ids,
        tradeoff_fact_ids=raw.tradeoff_fact_ids,
        uncertainty_fact_ids=raw.uncertainty_fact_ids,
        generation_mode="gemini",
    )


def _without_fact_sentences(summary: str, facts: tuple[Fact, ...]) -> str:
    for fact in facts:
        for sentence in SENTENCE.findall(fact.text):
            if sentence.strip():
                summary = summary.replace(sentence.strip(), " ")
    return summary


def _fact_index(facts: tuple[Fact, ...]) -> dict[str, Fact]:
    result = {fact.id: fact for fact in facts}
    if len(result) != len(facts):
        raise ValueError("duplicate fact id")
    return result


def _validate_refs(
    refs: list[str],
    facts: dict[str, Fact],
    allowed_kinds: set[str],
    field: str,
) -> None:
    if len(set(refs)) != len(refs):
        raise ValueError(f"duplicate {field} fact reference")
    if any(ref not in facts for ref in refs):
        raise ValueError(f"unknown {field} fact reference")
    if any(facts[ref].kind not in allowed_kinds for ref in refs):
        raise ValueError(f"wrong Fact kind in {field} references")
