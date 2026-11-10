import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from firebase_admin import auth
from google.auth.exceptions import DefaultCredentialsError
from pydantic import ValidationError

from app.core.settings import Settings
from app.domain.constraints import effective_constraints, remaining_seconds, PlanningDeadlineExceeded
from app.main import create_app
from app.schemas.contracts import ConstraintOverrides, TripConstraints


@pytest.mark.parametrize("failure,status,code", [
    (auth.InvalidIdTokenError("invalid"), 401, "UNAUTHENTICATED"),
    (DefaultCredentialsError("private credential details"), 503, "DEPENDENCY_UNAVAILABLE"),
    (RuntimeError("private infrastructure details"), 503, "DEPENDENCY_UNAVAILABLE"),
])
def test_token_vs_infrastructure_failure(monkeypatch, failure, status, code):
    def fail(*args):
        raise failure
    monkeypatch.setattr("app.core.auth.verify_token", fail)
    with TestClient(create_app(Settings(_env_file=None, app_env="test"))) as client:
        response = client.get("/api/v1/trips/test", headers={"Authorization": "Bearer header.payload.signature"})
        assert response.status_code == status
        assert response.json()["error"]["code"] == code
        assert "private" not in response.text


def test_override_preserves_null_clears_list_and_does_not_mutate():
    path = Path(__file__).resolve().parents[2]/"contracts/fixtures/v3/trip-create.request.json"
    base = TripConstraints.model_validate(json.loads(path.read_text(encoding="utf-8"))["constraints"])
    snapshot = base.model_dump()
    result = effective_constraints(base, ConstraintOverrides(locale="en", max_walk_meters=None, avoid_windows=[]))
    assert result.locale == "en" and result.avoid_windows == []
    assert result.max_walk_meters == base.max_walk_meters
    assert base.model_dump() == snapshot
    with pytest.raises(ValidationError):
        effective_constraints(base, ConstraintOverrides(end_at="2026-11-05T08:00:00+09:00"))


def test_shared_deadline_never_grants_extra_time():
    assert remaining_seconds(100, 8, now=98) == 2
    assert remaining_seconds(100, 8, now=80) == 8
    with pytest.raises(PlanningDeadlineExceeded):
        remaining_seconds(100, 8, now=100)
