"""Deterministic export from the real FastAPI route definitions."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def build_openapi():
    from app.core.settings import Settings
    from app.main import create_app
    return create_app(Settings(_env_file=None, app_env="test")).openapi()


def main():
    target = ROOT / "contracts/openapi.json"
    output = json.dumps(build_openapi(), ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        if not target.exists() or target.read_text(encoding="utf-8") != output:
            raise SystemExit("OpenAPI is stale; run the export command.")
        print("OpenAPI matches the actual v3 route definitions.")
    else:
        target.write_text(output, encoding="utf-8")
        print(target)


if __name__ == "__main__":
    main()
