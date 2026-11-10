"""Pure merge rules used by proposal services; no persistence or provider access."""
import time

from app.schemas.contracts import ConstraintOverrides, TripConstraints


def effective_constraints(base: TripConstraints, overrides: ConstraintOverrides) -> TripConstraints:
    # Null/omitted preserves values, [] explicitly clears an optional list.
    values = base.model_dump(mode="python")
    values.update(overrides.model_dump(mode="python", exclude_none=True))
    return TripConstraints.model_validate(values)


class PlanningDeadlineExceeded(TimeoutError):
    pass


def remaining_seconds(deadline_monotonic: float, cap_seconds: float, *, now: float | None = None) -> float:
    if cap_seconds <= 0:
        raise ValueError("timeout cap must be positive")
    remaining = deadline_monotonic - (time.monotonic() if now is None else now)
    if remaining <= 0:
        raise PlanningDeadlineExceeded("Planning deadline exceeded")
    return min(remaining, cap_seconds)
