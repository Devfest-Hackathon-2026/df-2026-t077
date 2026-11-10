"""Pure validation and reconciliation for untrusted intent model output."""

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.contracts import (
    AvoidWindow,
    FieldNote,
    IntentDraft,
    IntentDraftResponse,
    IntentInterpretRequest,
    RequestedStop,
    Spot,
    UnresolvedField,
    WaitAssumption,
)

NUMBER_PATTERN = re.compile(r"\d")
INTERESTS = {"history", "photography", "nature", "food", "art", "quiet"}
JST = ZoneInfo("Asia/Tokyo")


class RawModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RawInterest(RawModel):
    value: str
    source_quote: str


class RawRequestedStop(RawModel):
    spot_id: str
    requirement: str
    locked_start_at: str | None = None
    source_quote: str


class RawIntegerValue(RawModel):
    value: int
    source_quote: str


class RawTextValue(RawModel):
    value: str
    source_quote: str


class RawAvoidWindow(RawModel):
    spot_id: str
    starts_at: str
    ends_at: str
    source_quote: str


class RawWaitAssumption(RawModel):
    spot_id: str
    wait_seconds: int
    source_quote: str


class RawUnresolved(RawModel):
    field: str
    question: str
    source_quote: str


class RawIntentOutput(RawModel):
    interests: list[RawInterest] = Field(default_factory=list, max_length=6)
    requested_stops: list[RawRequestedStop] = Field(default_factory=list, max_length=6)
    max_walk_meters: RawIntegerValue | None = None
    end_at: RawTextValue | None = None
    avoid_windows: list[RawAvoidWindow] = Field(default_factory=list, max_length=6)
    wait_assumptions: list[RawWaitAssumption] = Field(default_factory=list, max_length=2)
    unresolved: list[RawUnresolved] = Field(default_factory=list, max_length=12)


def empty_draft() -> IntentDraft:
    return IntentDraft(
        interests=None,
        requested_stops=[],
        max_walk_meters=None,
        end_at=None,
        avoid_windows=[],
        wait_assumptions=[],
        field_notes=[],
    )


def intent_fallback(locale: str) -> IntentDraftResponse:
    if locale == "ja":
        question = "希望をフォームで確認・入力してください。"
        warning = "INTENT_UNAVAILABLE: AIによる希望の整理を利用できません。フォームで続行できます。"
    else:
        question = "Please review and enter your preferences in the form."
        warning = "INTENT_UNAVAILABLE: AI interpretation is unavailable. You can continue with the form."
    return IntentDraftResponse(
        draft=empty_draft(),
        unresolved=[UnresolvedField(field="text", question=question, source_quote="")],
        warnings=[warning],
        generation_mode="template",
        requires_confirmation=True,
    )


def _quote_is_from_text(quote: str, text: str, *, numeric: bool = False) -> bool:
    quote = quote.strip()
    if not quote or quote.casefold() not in text.casefold():
        return False
    return not numeric or bool(NUMBER_PATTERN.search(quote))


def _question(locale: str, ja: str, en: str) -> str:
    return ja if locale == "ja" else en


def _unresolved(
    items: list[UnresolvedField],
    *,
    field: str,
    quote: str,
    locale: str,
    ja: str,
    en: str,
) -> None:
    items.append(
        UnresolvedField(
            field=field,
            question=_question(locale, ja, en),
            source_quote=quote if quote else "",
        )
    )


def _aware_datetime(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None


def _current_constraint(request: IntentInterpretRequest, field: str) -> Any:
    constraints = request.current_input.constraints
    return getattr(constraints, field) if constraints is not None else None


def reconcile_intent(
    request: IntentInterpretRequest,
    allowed_spots: tuple[Spot, ...],
    raw: RawIntentOutput,
) -> IntentDraftResponse:
    """Convert untrusted model output without overwriting confirmed form values."""
    locale = request.locale
    allowed_ids = {spot.id for spot in allowed_spots}
    unresolved: list[UnresolvedField] = []
    notes: list[FieldNote] = []

    proposed_interests: list[str] = []
    proposed_interest_notes: list[FieldNote] = []
    for item in raw.interests:
        if item.value not in INTERESTS or not _quote_is_from_text(
            item.source_quote, request.text
        ):
            _unresolved(
                unresolved,
                field="interests",
                quote=item.source_quote,
                locale=locale,
                ja="この好みを希望として追加するか確認してください。",
                en="Please confirm whether to add this interest.",
            )
            continue
        if item.value not in proposed_interests:
            proposed_interests.append(item.value)
            proposed_interest_notes.append(
                FieldNote(field="interests", source_quote=item.source_quote)
            )
    current_interests = _current_constraint(request, "interests")
    if current_interests is not None:
        if proposed_interests and set(proposed_interests) != set(current_interests):
            _unresolved(
                unresolved,
                field="interests",
                quote=raw.interests[0].source_quote,
                locale=locale,
                ja="現在の好みを維持するか、希望文の好みに変更するか確認してください。",
                en="Please confirm whether to keep the current interests or use the text suggestion.",
            )
        interests = list(current_interests)
    else:
        interests = proposed_interests or None
        notes.extend(proposed_interest_notes)

    current_stops = list(request.current_input.requested_stops or [])
    stop_by_id = {stop.spot_id: stop for stop in current_stops}
    requested_stops = list(current_stops)
    for item in raw.requested_stops:
        if not _quote_is_from_text(item.source_quote, request.text):
            _unresolved(
                unresolved,
                field="requested_stops",
                quote=item.source_quote,
                locale=locale,
                ja="この訪問希望に対応する原文を確認してください。",
                en="Please confirm the source text for this requested visit.",
            )
            continue
        if item.spot_id not in allowed_ids:
            _unresolved(
                unresolved,
                field="requested_stops",
                quote=item.source_quote,
                locale=locale,
                ja="候補にない場所です。候補から選び直してください。",
                en="This place is not an allowed candidate. Please choose from the list.",
            )
            continue
        if item.requirement not in {"must", "optional"}:
            _unresolved(
                unresolved,
                field="requested_stops",
                quote=item.source_quote,
                locale=locale,
                ja="この場所をmustまたはoptionalのどちらにするか確認してください。",
                en="Please confirm whether this visit is must or optional.",
            )
            continue
        locked = _aware_datetime(item.locked_start_at) if item.locked_start_at else None
        if item.locked_start_at and (
            locked is None
            or locked.astimezone(JST).date().isoformat() != request.visit_date
            or item.requirement != "must"
            or not _quote_is_from_text(item.source_quote, request.text, numeric=True)
        ):
            _unresolved(
                unresolved,
                field="requested_stops.locked_start_at",
                quote=item.source_quote,
                locale=locale,
                ja="固定時刻を具体的な時刻として確認してください。",
                en="Please confirm the exact locked start time.",
            )
            locked = None
        existing = stop_by_id.get(item.spot_id)
        if existing is not None:
            if (
                existing.requirement != item.requirement
                or (locked is not None and existing.locked_start_at != locked)
            ):
                _unresolved(
                    unresolved,
                    field="requested_stops",
                    quote=item.source_quote,
                    locale=locale,
                    ja="現在のmust・固定時刻・予約確認を維持するか確認してください。",
                    en="Please confirm the conflict with the current must, locked time, or reservation.",
                )
            continue
        if len(requested_stops) >= 6:
            _unresolved(
                unresolved,
                field="requested_stops",
                quote=item.source_quote,
                locale=locale,
                ja="訪問候補は最大6件です。残す場所を選んでください。",
                en="At most six visits are allowed. Please choose which ones to keep.",
            )
            continue
        if item.requirement == "must" and sum(
            stop.requirement == "must" for stop in requested_stops
        ) >= 3:
            _unresolved(
                unresolved,
                field="requested_stops",
                quote=item.source_quote,
                locale=locale,
                ja="mustは最大3件です。必須にする場所を確認してください。",
                en="At most three visits can be must. Please confirm which places are required.",
            )
            continue
        requested_stop = RequestedStop(
            spot_id=item.spot_id,
            requirement=item.requirement,
            locked_start_at=locked,
            reservation_confirmed=False,
        )
        requested_stops.append(requested_stop)
        stop_by_id[item.spot_id] = requested_stop
        notes.append(FieldNote(field="requested_stops", source_quote=item.source_quote))

    max_walk = _reconcile_scalar(
        request,
        raw.max_walk_meters,
        "max_walk_meters",
        unresolved,
        notes,
    )
    end_at = _reconcile_end_at(request, raw.end_at, unresolved, notes)
    avoid_windows = _reconcile_avoid_windows(
        request, raw.avoid_windows, set(stop_by_id), unresolved, notes
    )
    wait_assumptions = _reconcile_waits(
        request, raw.wait_assumptions, set(stop_by_id), unresolved, notes
    )

    for item in raw.unresolved:
        if _quote_is_from_text(item.source_quote, request.text):
            unresolved.append(
                UnresolvedField(
                    field=item.field,
                    question=item.question,
                    source_quote=item.source_quote,
                )
            )

    return IntentDraftResponse(
        draft=IntentDraft(
            interests=interests,
            requested_stops=requested_stops,
            max_walk_meters=max_walk,
            end_at=end_at,
            avoid_windows=avoid_windows,
            wait_assumptions=wait_assumptions,
            field_notes=notes,
        ),
        unresolved=unresolved,
        warnings=[],
        generation_mode="gemini",
        requires_confirmation=True,
    )


def _reconcile_scalar(
    request: IntentInterpretRequest,
    raw: RawIntegerValue | None,
    field: str,
    unresolved: list[UnresolvedField],
    notes: list[FieldNote],
) -> int | None:
    current = _current_constraint(request, field)
    if raw is None:
        return current
    if not _quote_is_from_text(raw.source_quote, request.text, numeric=True):
        _unresolved(
            unresolved,
            field=field,
            quote=raw.source_quote,
            locale=request.locale,
            ja="具体的な数値を確認してください。",
            en="Please confirm a specific numeric value.",
        )
        return current
    if not 100 <= raw.value <= 30000:
        _unresolved(
            unresolved,
            field=field,
            quote=raw.source_quote,
            locale=request.locale,
            ja="歩行上限は100〜30000mで確認してください。",
            en="Please confirm a walking limit between 100 and 30000 meters.",
        )
        return current
    if current is not None and current != raw.value:
        _unresolved(
            unresolved,
            field=field,
            quote=raw.source_quote,
            locale=request.locale,
            ja="現在の数値を維持するか、希望文の数値へ変更するか確認してください。",
            en="Please confirm whether to keep the current value or use the text value.",
        )
        return current
    notes.append(FieldNote(field=field, source_quote=raw.source_quote))
    return raw.value


def _reconcile_end_at(
    request: IntentInterpretRequest,
    raw: RawTextValue | None,
    unresolved: list[UnresolvedField],
    notes: list[FieldNote],
) -> datetime | None:
    current = _current_constraint(request, "end_at")
    if raw is None:
        return current
    parsed = _aware_datetime(raw.value)
    if (
        parsed is None
        or parsed.astimezone(JST).date().isoformat() != request.visit_date
        or not _quote_is_from_text(raw.source_quote, request.text, numeric=True)
    ):
        _unresolved(
            unresolved,
            field="end_at",
            quote=raw.source_quote,
            locale=request.locale,
            ja="終了時刻を旅行日の具体的な時刻として確認してください。",
            en="Please confirm an exact end time on the visit date.",
        )
        return current
    if current is not None and current != parsed:
        _unresolved(
            unresolved,
            field="end_at",
            quote=raw.source_quote,
            locale=request.locale,
            ja="現在の終了時刻を維持するか、希望文の時刻へ変更するか確認してください。",
            en="Please confirm whether to keep the current end time or use the text value.",
        )
        return current
    notes.append(FieldNote(field="end_at", source_quote=raw.source_quote))
    return parsed


def _reconcile_avoid_windows(
    request: IntentInterpretRequest,
    raw_items: list[RawAvoidWindow],
    allowed_ids: set[str],
    unresolved: list[UnresolvedField],
    notes: list[FieldNote],
) -> list[AvoidWindow]:
    current = _current_constraint(request, "avoid_windows")
    if current is not None:
        if raw_items:
            _unresolved(
                unresolved,
                field="avoid_windows",
                quote=raw_items[0].source_quote,
                locale=request.locale,
                ja="現在の回避時間帯を維持するか確認してください。",
                en="Please confirm whether to keep the current avoid windows.",
            )
        return list(current)
    result = []
    for index, item in enumerate(raw_items):
        starts_at = _aware_datetime(item.starts_at)
        ends_at = _aware_datetime(item.ends_at)
        if (
            item.spot_id not in allowed_ids
            or starts_at is None
            or ends_at is None
            or starts_at >= ends_at
            or starts_at.astimezone(JST).date().isoformat() != request.visit_date
            or ends_at.astimezone(JST).date().isoformat() != request.visit_date
            or any(
                window.spot_id == item.spot_id
                and starts_at < window.ends_at
                and window.starts_at < ends_at
                for window in result
            )
            or not _quote_is_from_text(item.source_quote, request.text, numeric=True)
        ):
            _unresolved(
                unresolved,
                field="avoid_windows",
                quote=item.source_quote,
                locale=request.locale,
                ja="場所と避けたい時間帯を具体的に確認してください。",
                en="Please confirm the place and exact time range to avoid.",
            )
            continue
        result.append(
            AvoidWindow(
                id=f"intent-avoid-{index}",
                spot_id=item.spot_id,
                starts_at=starts_at,
                ends_at=ends_at,
                basis="user_preference",
                evidence_ids=[],
                note="",
            )
        )
        notes.append(FieldNote(field="avoid_windows", source_quote=item.source_quote))
    return result


def _reconcile_waits(
    request: IntentInterpretRequest,
    raw_items: list[RawWaitAssumption],
    allowed_ids: set[str],
    unresolved: list[UnresolvedField],
    notes: list[FieldNote],
) -> list[WaitAssumption]:
    current = _current_constraint(request, "wait_assumptions")
    if current is not None:
        if raw_items:
            _unresolved(
                unresolved,
                field="wait_assumptions",
                quote=raw_items[0].source_quote,
                locale=request.locale,
                ja="現在の待ち時間の仮定を維持するか確認してください。",
                en="Please confirm whether to keep the current wait assumptions.",
            )
        return list(current)
    result = []
    seen_spot_ids: set[str] = set()
    for item in raw_items:
        if (
            item.spot_id not in allowed_ids
            or item.spot_id in seen_spot_ids
            or not 0 <= item.wait_seconds <= 10800
            or not _quote_is_from_text(item.source_quote, request.text, numeric=True)
        ):
            _unresolved(
                unresolved,
                field="wait_assumptions",
                quote=item.source_quote,
                locale=request.locale,
                ja="場所と待ち時間の仮定を具体的に確認してください。",
                en="Please confirm the place and numeric wait assumption.",
            )
            continue
        result.append(
            WaitAssumption(
                spot_id=item.spot_id,
                wait_seconds=item.wait_seconds,
                basis="user_assumption",
                observed_at=None,
                note="",
            )
        )
        seen_spot_ids.add(item.spot_id)
        notes.append(FieldNote(field="wait_assumptions", source_quote=item.source_quote))
    return result
