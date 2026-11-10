"""One-shot Vertex AI connectivity probe with no user data or response logging."""

import json
import sys
import time
from pathlib import Path

import httpx
from google import genai
from google.auth.exceptions import GoogleAuthError
from google.genai import errors, types
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.core.settings import Settings

PROBE_TIMEOUT_SECONDS = 20


class ProbeResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    required_stop_id: str
    interests: list[str]
    requires_confirmation: bool

    @model_validator(mode="after")
    def allowed_values(self):
        if self.required_stop_id != "probe-castle":
            raise ValueError("unknown required stop")
        if not self.interests or not set(self.interests) <= {"history", "quiet"}:
            raise ValueError("unknown or empty interests")
        if not self.requires_confirmation:
            raise ValueError("probe output must require confirmation")
        return self


def safe_summary(
    *,
    settings: Settings,
    started: float,
    status: str,
    structured_output_valid: bool,
    error_category: str | None = None,
    api_status_code: int | None = None,
) -> dict[str, str | int | bool | None]:
    return {
        "status": status,
        "provider": "vertex_ai",
        "location": settings.gcp_location,
        "model": settings.gemini_model,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "structured_output_valid": structured_output_valid,
        "error_category": error_category,
        "api_status_code": api_status_code,
        "project_configured": True,
        "response_logged": False,
        "credentials_logged": False,
    }


def validate_settings(settings: Settings) -> None:
    if settings.gcp_project_id.startswith("demo-"):
        raise ValueError("A real GCP_PROJECT_ID is required")
    if not settings.gemini_model:
        raise ValueError("GEMINI_MODEL is required")


def run_probe() -> int:
    started = time.monotonic()
    settings = Settings()
    try:
        validate_settings(settings)
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gcp_location,
            http_options=types.HttpOptions(
                timeout=PROBE_TIMEOUT_SECONDS * 1000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=(
                "Allowed spots: probe-castle, probe-garden. "
                "Request: I must visit the castle and I also like quiet historical places. "
                "Interpret castle as probe-castle. Return required_stop_id exactly as "
                "probe-castle, interests exactly as history and quiet, and "
                "requires_confirmation as true. Do not return any other ID or interest."
            ),
            config=types.GenerateContentConfig(
                temperature=0,
                thinking_config=types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                ),
                response_mime_type="application/json",
                response_schema=ProbeResult,
            ),
        )
        ProbeResult.model_validate_json(response.text)
    except (ValueError, ValidationError):
        summary = safe_summary(
            settings=settings,
            started=started,
            status="failed",
            structured_output_valid=False,
            error_category="configuration_or_schema",
        )
        print(json.dumps(summary, ensure_ascii=True, sort_keys=True))
        return 1
    except (TimeoutError, httpx.TimeoutException):
        summary = safe_summary(
            settings=settings,
            started=started,
            status="failed",
            structured_output_valid=False,
            error_category="timeout",
        )
        print(json.dumps(summary, ensure_ascii=True, sort_keys=True))
        return 1
    except GoogleAuthError:
        summary = safe_summary(
            settings=settings,
            started=started,
            status="failed",
            structured_output_valid=False,
            error_category="authentication",
        )
        print(json.dumps(summary, ensure_ascii=True, sort_keys=True))
        return 1
    except errors.APIError as exc:
        category = "api_client" if 400 <= exc.code < 500 else "api_server"
        summary = safe_summary(
            settings=settings,
            started=started,
            status="failed",
            structured_output_valid=False,
            error_category=category,
            api_status_code=exc.code,
        )
        print(json.dumps(summary, ensure_ascii=True, sort_keys=True))
        return 1
    else:
        summary = safe_summary(
            settings=settings,
            started=started,
            status="ok",
            structured_output_valid=True,
        )
        print(json.dumps(summary, ensure_ascii=True, sort_keys=True))
        return 0


if __name__ == "__main__":
    raise SystemExit(run_probe())
