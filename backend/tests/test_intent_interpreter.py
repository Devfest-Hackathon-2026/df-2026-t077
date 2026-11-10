import copy
import json
import time
from pathlib import Path

import pytest

from app.adapters.gemini_intent import GeminiIntentInterpreter
from app.domain.intent import (
    RawAvoidWindow,
    RawIntegerValue,
    RawIntentOutput,
    RawInterest,
    RawRequestedStop,
    RawTextValue,
    RawWaitAssumption,
    reconcile_intent,
)
from app.schemas.contracts import IntentInterpretRequest, SpotListResponse

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "v3"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def allowed_spots():
    return tuple(SpotListResponse.model_validate(fixture("spots.ja.json")).items)


def make_request(
    text: str,
    *,
    locale: str = "ja",
    current_input: dict | None = None,
) -> IntentInterpretRequest:
    return IntentInterpretRequest.model_validate(
        {
            "client_request_id": "00000000-0000-4000-8000-000000000099",
            "area_id": "demo-area",
            "visit_date": "2026-11-05",
            "locale": locale,
            "text": text,
            "current_input": current_input or {},
        }
    )


class FakeClient:
    def __init__(self, result=None, error: Exception | None = None):
        self.result = result or RawIntentOutput()
        self.error = error
        self.calls = 0

    async def generate(self, request, spots, timeout_seconds):
        self.calls += 1
        assert request.text
        assert spots
        assert 0 < timeout_seconds <= 20
        if self.error:
            raise self.error
        return self.result


def test_ja_must_and_interest_are_drafted_from_exact_quotes():
    request = make_request("架空資料館には絶対行きたい。静かな場所にも寄りたい。")
    raw = RawIntentOutput(
        interests=[RawInterest(value="quiet", source_quote="静かな場所")],
        requested_stops=[
            RawRequestedStop(
                spot_id="demo-museum",
                requirement="must",
                source_quote="架空資料館には絶対行きたい",
            )
        ],
    )
    response = reconcile_intent(request, allowed_spots(), raw)
    assert response.generation_mode == "gemini"
    assert response.requires_confirmation
    assert response.draft.interests == ["quiet"]
    assert response.draft.requested_stops[0].spot_id == "demo-museum"
    assert response.draft.requested_stops[0].requirement == "must"
    assert response.draft.requested_stops[0].reservation_confirmed is False


def test_en_interpretation_keeps_same_ids_and_values():
    request = make_request(
        "I must visit Demo Museum and can walk 2 km.",
        locale="en",
    )
    raw = RawIntentOutput(
        requested_stops=[
            RawRequestedStop(
                spot_id="demo-museum",
                requirement="must",
                source_quote="must visit Demo Museum",
            )
        ],
        max_walk_meters=RawIntegerValue(value=2000, source_quote="2 km"),
    )
    response = reconcile_intent(request, allowed_spots(), raw)
    assert response.draft.requested_stops[0].spot_id == "demo-museum"
    assert response.draft.max_walk_meters == 2000


def test_unknown_spot_is_excluded_and_left_unresolved():
    request = make_request("未知の寺に行きたい")
    raw = RawIntentOutput(
        requested_stops=[
            RawRequestedStop(
                spot_id="invented-temple",
                requirement="must",
                source_quote="未知の寺",
            )
        ]
    )
    response = reconcile_intent(request, allowed_spots(), raw)
    assert response.draft.requested_stops == []
    assert response.unresolved[0].field == "requested_stops"


def test_ambiguous_walking_text_does_not_invent_distance():
    request = make_request(
        "あまり歩きたくない",
        current_input={"constraints": {"max_walk_meters": 3000}},
    )
    raw = RawIntentOutput(
        max_walk_meters=RawIntegerValue(
            value=2000,
            source_quote="あまり歩きたくない",
        )
    )
    response = reconcile_intent(request, allowed_spots(), raw)
    assert response.draft.max_walk_meters == 3000
    assert response.unresolved[0].field == "max_walk_meters"


def test_explicit_numeric_conflict_preserves_current_value():
    request = make_request(
        "歩行は2kmまで",
        current_input={"constraints": {"max_walk_meters": 3000}},
    )
    response = reconcile_intent(
        request,
        allowed_spots(),
        RawIntentOutput(
            max_walk_meters=RawIntegerValue(value=2000, source_quote="2km")
        ),
    )
    assert response.draft.max_walk_meters == 3000
    assert response.unresolved[0].field == "max_walk_meters"


def test_existing_must_locked_time_and_reservation_are_not_overwritten():
    locked = "2026-11-05T10:00:00+09:00"
    request = make_request(
        "架空資料館は変更してよい",
        current_input={
            "requested_stops": [
                {
                    "spot_id": "demo-museum",
                    "requirement": "must",
                    "locked_start_at": locked,
                    "reservation_confirmed": True,
                }
            ]
        },
    )
    raw = RawIntentOutput(
        requested_stops=[
            RawRequestedStop(
                spot_id="demo-museum",
                requirement="optional",
                source_quote="架空資料館は変更してよい",
            )
        ]
    )
    response = reconcile_intent(request, allowed_spots(), raw)
    stop = response.draft.requested_stops[0]
    assert stop.requirement == "must"
    assert stop.locked_start_at.isoformat() == locked
    assert stop.reservation_confirmed is True
    assert response.unresolved[0].field == "requested_stops"


def test_end_time_requires_explicit_number_and_visit_date():
    request = make_request("17時までに帰りたい")
    valid = reconcile_intent(
        request,
        allowed_spots(),
        RawIntentOutput(
            end_at=RawTextValue(
                value="2026-11-05T17:00:00+09:00",
                source_quote="17時まで",
            )
        ),
    )
    assert valid.draft.end_at.hour == 17
    invalid = reconcile_intent(
        make_request("夕方までに帰りたい"),
        allowed_spots(),
        RawIntentOutput(
            end_at=RawTextValue(
                value="2026-11-05T17:00:00+09:00",
                source_quote="夕方まで",
            )
        ),
    )
    assert invalid.draft.end_at is None
    assert invalid.unresolved[0].field == "end_at"


def test_wait_and_avoid_values_require_a_requested_allowed_spot():
    request = make_request("架空資料館に行き、10時から11時を避け、待ちは20分と仮定")
    raw = RawIntentOutput(
        requested_stops=[
            RawRequestedStop(
                spot_id="demo-museum",
                requirement="optional",
                source_quote="架空資料館に行き",
            )
        ],
        avoid_windows=[
            RawAvoidWindow(
                spot_id="demo-museum",
                starts_at="2026-11-05T10:00:00+09:00",
                ends_at="2026-11-05T11:00:00+09:00",
                source_quote="10時から11時を避け",
            )
        ],
        wait_assumptions=[
            RawWaitAssumption(
                spot_id="demo-museum",
                wait_seconds=1200,
                source_quote="待ちは20分",
            )
        ],
    )
    response = reconcile_intent(request, allowed_spots(), raw)
    assert response.draft.avoid_windows[0].basis == "user_preference"
    assert response.draft.wait_assumptions[0].basis == "user_assumption"
    assert response.draft.wait_assumptions[0].wait_seconds == 1200


def test_unlinked_wait_is_not_added_to_draft():
    request = make_request("架空資料館の待ちは20分と仮定")
    response = reconcile_intent(
        request,
        allowed_spots(),
        RawIntentOutput(
            wait_assumptions=[
                RawWaitAssumption(
                    spot_id="demo-museum",
                    wait_seconds=1200,
                    source_quote="待ちは20分",
                )
            ]
        ),
    )
    assert response.draft.wait_assumptions == []
    assert response.unresolved[0].field == "wait_assumptions"


def test_duplicate_wait_and_overlapping_or_off_date_avoid_windows_are_unresolved():
    request = make_request(
        "架空資料館に行き、10時から12時を避け、11時から13時も避け、待ちは20分"
    )
    response = reconcile_intent(
        request,
        allowed_spots(),
        RawIntentOutput(
            requested_stops=[
                RawRequestedStop(
                    spot_id="demo-museum",
                    requirement="optional",
                    source_quote="架空資料館に行き",
                )
            ],
            avoid_windows=[
                RawAvoidWindow(
                    spot_id="demo-museum",
                    starts_at="2026-11-05T10:00:00+09:00",
                    ends_at="2026-11-05T12:00:00+09:00",
                    source_quote="10時から12時を避け",
                ),
                RawAvoidWindow(
                    spot_id="demo-museum",
                    starts_at="2026-11-05T11:00:00+09:00",
                    ends_at="2026-11-05T13:00:00+09:00",
                    source_quote="11時から13時も避け",
                ),
                RawAvoidWindow(
                    spot_id="demo-museum",
                    starts_at="2026-11-06T10:00:00+09:00",
                    ends_at="2026-11-06T12:00:00+09:00",
                    source_quote="10時から12時を避け",
                ),
            ],
            wait_assumptions=[
                RawWaitAssumption(
                    spot_id="demo-museum",
                    wait_seconds=1200,
                    source_quote="待ちは20分",
                ),
                RawWaitAssumption(
                    spot_id="demo-museum",
                    wait_seconds=1200,
                    source_quote="待ちは20分",
                ),
            ],
        ),
    )
    assert len(response.draft.avoid_windows) == 1
    assert len(response.draft.wait_assumptions) == 1
    assert [item.field for item in response.unresolved].count("avoid_windows") == 2
    assert [item.field for item in response.unresolved].count("wait_assumptions") == 1


@pytest.mark.asyncio
async def test_timeout_returns_empty_template_fallback():
    request = make_request("静かな場所に行きたい")
    client = FakeClient(error=TimeoutError())
    response = await GeminiIntentInterpreter(client).interpret(
        request,
        allowed_spots(),
        time.monotonic() + 10,
    )
    assert response.generation_mode == "template"
    assert response.requires_confirmation
    assert response.draft.requested_stops == []
    assert response.warnings[0].startswith("INTENT_UNAVAILABLE")


@pytest.mark.asyncio
async def test_expired_deadline_falls_back_without_model_call():
    request = make_request("静かな場所に行きたい")
    client = FakeClient()
    response = await GeminiIntentInterpreter(client).interpret(
        request,
        allowed_spots(),
        time.monotonic() - 1,
    )
    assert response.generation_mode == "template"
    assert client.calls == 0


@pytest.mark.asyncio
async def test_invalid_model_output_falls_back_without_inventing_draft():
    request = make_request("静かな場所に行きたい")
    response = await GeminiIntentInterpreter(FakeClient(error=ValueError())).interpret(
        request,
        allowed_spots(),
        time.monotonic() + 10,
    )
    assert response.generation_mode == "template"
    assert response.draft == response.draft.model_copy(
        update={
            "interests": None,
            "requested_stops": [],
            "max_walk_meters": None,
            "end_at": None,
            "avoid_windows": [],
            "wait_assumptions": [],
            "field_notes": [],
        }
    )


@pytest.mark.asyncio
async def test_interpreter_does_not_mutate_request_or_spots():
    request = make_request("静かな場所に行きたい")
    spots = allowed_spots()
    before_request = copy.deepcopy(request)
    before_spots = copy.deepcopy(spots)
    raw = RawIntentOutput(
        interests=[RawInterest(value="quiet", source_quote="静かな場所")]
    )
    response = await GeminiIntentInterpreter(FakeClient(result=raw)).interpret(
        request,
        spots,
        time.monotonic() + 10,
    )
    assert response.draft.interests == ["quiet"]
    assert request == before_request
    assert spots == before_spots
