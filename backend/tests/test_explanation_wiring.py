"""A-side wiring of B's explainer: setting switch, factory, and HTTP generation with お任せ reasons."""
from uuid import uuid4

from fastapi.testclient import TestClient
from test_omakase import trip_body

from app.core.auth import current_uid
from app.core.settings import Settings
from app.main import create_app
from app.repositories.trips import InMemoryTripRepository
from app.services.proposals import gemini_explainer_factory


class SeeingExplainer:
    """Records which Facts the planner sends, and answers with a valid Gemini-mode explanation."""

    def __init__(self):
        self.fact_ids: list[set[str]] = []

    async def explain(self, request, deadline_monotonic):
        from app.domain.explainer import template_explanation
        self.fact_ids.append({fact.id for fact in request.facts})
        return template_explanation(request).model_copy(update={"summary": "確認済みの情報に基づく説明です。", "generation_mode": "gemini"})


def test_template_is_the_default_and_needs_no_vertex_settings():
    assert gemini_explainer_factory(Settings(_env_file=None, app_env="test"))() is None


def test_gemini_switch_without_vertex_settings_falls_back_to_template():
    settings = Settings(_env_file=None, app_env="test", explanation_provider="gemini")  # demo- project, no model
    assert gemini_explainer_factory(settings)() is None


def test_generation_uses_the_explainer_and_it_sees_the_omakase_reason():
    explainer = SeeingExplainer()
    app = create_app(
        Settings(_env_file=None, app_env="test", data_mode="curated"),
        trip_repository=InMemoryTripRepository(),
        explainer_factory=lambda: explainer,
    )
    app.dependency_overrides[current_uid] = lambda: "user-a"
    client = TestClient(app)
    trip = client.post("/api/v1/trips", json=trip_body([], omakase=1, interests=["history"])).json()["trip"]
    body = {"client_request_id": str(uuid4()), "base_version": 1, "mode": "initial", "constraint_overrides": {}}
    proposal = client.post(f"/api/v1/trips/{trip['id']}/proposals", json=body).json()
    assert proposal["status"] == "complete"
    plans = [proposal["baseline"], *proposal["alternatives"]]
    assert all(plan["explanation"]["generation_mode"] == "gemini" for plan in plans)
    # Explanation runs after the お任せ reasons are attached, so the model is given them.
    assert any(any(fact_id.startswith("omakase-") for fact_id in ids) for ids in explainer.fact_ids)
