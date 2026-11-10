"""A-03: intent interpretation over HTTP. The interpreter (B) returns a draft only; nothing is stored.

The raw wish text and the draft's source quotes are never persisted or logged (docs/API.md), so this
endpoint keeps no idempotency record; it limits concurrent model calls per instance instead.
"""
import asyncio
import time
from collections.abc import Callable
from datetime import date

from app.core.errors import AppError, invalid, unavailable
from app.domain.ports import IntentInterpreter
from app.schemas.contracts import IntentDraftResponse, IntentInterpretRequest

MAX_CONCURRENT_INTERPRETATIONS = 4
RATE_LIMIT_RETRY_SECONDS = 5


class IntentService:
    def __init__(self, catalog, interpreter_factory: Callable[[], IntentInterpreter | None], timeout_seconds: int):
        self._catalog = catalog
        self._factory = interpreter_factory
        self._interpreter: IntentInterpreter | None = None
        self._timeout_seconds = timeout_seconds
        self._slots = asyncio.Semaphore(MAX_CONCURRENT_INTERPRETATIONS)

    def _resolve(self) -> IntentInterpreter:
        # Built on first use so the app (and CI) starts without Vertex AI settings or credentials.
        if self._interpreter is None:
            self._interpreter = self._factory()
        if self._interpreter is None:
            raise unavailable()
        return self._interpreter

    async def interpret(self, body: IntentInterpretRequest) -> IntentDraftResponse:
        interpreter = self._resolve()
        # The contract has already rejected impossible dates (IntentInterpretRequest.real_date).
        listing = self._catalog.list(body.area_id, date.fromisoformat(body.visit_date), body.locale)
        if listing is None:
            raise invalid("body.area_id", "unknown_area")
        if self._slots.locked():
            raise AppError(429, "RATE_LIMITED", headers={"Retry-After": str(RATE_LIMIT_RETRY_SECONDS)})
        async with self._slots:
            # Model timeouts and invalid output come back as a 200 template draft from the interpreter itself.
            return await interpreter.interpret(body, tuple(listing.items), time.monotonic() + self._timeout_seconds)


def gemini_interpreter_factory(settings) -> Callable[[], IntentInterpreter | None]:
    def build() -> IntentInterpreter | None:
        from google.auth.exceptions import GoogleAuthError

        from app.adapters.gemini_intent import GeminiIntentInterpreter, GoogleGenAIIntentClient
        try:
            return GeminiIntentInterpreter(GoogleGenAIIntentClient(settings))
        except (ValueError, GoogleAuthError):
            # demo-* project, no GEMINI_MODEL, or no credentials: the endpoint answers 503 and the form continues.
            return None

    return build
