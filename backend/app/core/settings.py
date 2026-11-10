from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / ".env", env_file_encoding="utf-8", extra="ignore")
    app_env: Literal["local", "test", "staging", "production"] = "local"
    data_mode: Literal["demo", "curated"] = "demo"
    # Real values come from backend/.env (local) or Cloud Run env vars; defaults stay demo/emulator-only.
    gcp_project_id: str = "demo-zurashitabi"
    gcp_location: str = Field(default="global", pattern=r"^[a-z0-9-]+$")
    gemini_model: str | None = None
    # Plan summaries: "template" (planner text) or "gemini" (Fact-grounded, validated, falls back to template).
    explanation_provider: Literal["template", "gemini"] = "template"
    cors_origins: str = "http://127.0.0.1:5173"
    firebase_auth_emulator_host: str | None = None
    firestore_emulator_host: str | None = None
    # The real project's data lives in the named Tokyo database "zurashitabi" (docs/DATA.md), not "(default)".
    firestore_database: str = Field(default="(default)", pattern=r"^(\(default\)|[a-z][a-z0-9-]{2,62})$")
    generation_timeout_seconds: int = Field(default=25, ge=1, le=60)
    port: int = Field(default=8000, ge=1, le=65535)

    @model_validator(mode="after")
    def deployment_guards(self):
        from urllib.parse import urlsplit
        if self.app_env in {"staging", "production"}:
            if self.firebase_auth_emulator_host or self.firestore_emulator_host:
                raise ValueError("emulator hosts are forbidden outside local/test")
            if self.gcp_project_id.startswith("demo-"):
                raise ValueError("a real Firebase/GCP project is required")
            if self.firestore_database == "(default)":
                # Without an explicit name the client silently uses "(default)", a different database.
                raise ValueError("FIRESTORE_DATABASE must name the deployed Firestore database")
        for host in [self.firebase_auth_emulator_host, self.firestore_emulator_host]:
            if host and ("/" in host or host.rsplit(":", 1)[0] not in {"127.0.0.1", "localhost", "[::1]"}):
                raise ValueError("local emulator host must be loopback host:port")
        for origin in self.origins:
            url = urlsplit(origin)
            if url.scheme not in {"http", "https"} or not url.netloc or url.path or url.query or url.fragment or url.username:
                raise ValueError("CORS must list explicit HTTP origins")
        return self

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
