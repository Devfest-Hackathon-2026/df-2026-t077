import importlib.util
from pathlib import Path

import pytest

from app.core.settings import Settings

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "vertex_ai_probe", ROOT / "scripts" / "vertex-ai-probe.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_probe_rejects_demo_project_without_network():
    settings = Settings(
        _env_file=None,
        gcp_project_id="demo-zurashitabi",
        gcp_location="asia-northeast1",
        gemini_model="test-model",
    )
    with pytest.raises(ValueError, match="real GCP_PROJECT_ID"):
        module.validate_settings(settings)


def test_probe_safe_summary_contains_no_project_or_response():
    settings = Settings(
        _env_file=None,
        gcp_project_id="private-project-id",
        gcp_location="asia-northeast1",
        gemini_model="test-model",
    )
    summary = module.safe_summary(
        settings=settings,
        started=0,
        status="ok",
        structured_output_valid=True,
    )
    assert "private-project-id" not in str(summary)
    assert summary["response_logged"] is False
    assert summary["credentials_logged"] is False


def test_probe_result_rejects_unknown_generated_values():
    with pytest.raises(ValueError, match="unknown required stop"):
        module.ProbeResult.model_validate(
            {
                "required_stop_id": "invented",
                "interests": ["history"],
                "requires_confirmation": True,
            }
        )
