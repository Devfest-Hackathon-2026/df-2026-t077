# Backend API for Cloud Run. Build context is the repository root because the app reads
# contracts/fixtures/v3 (demo spots) and data/curated (real spots/routes) relative to it.
FROM python:3.13.5-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv==0.13.7 \
    && useradd --create-home --uid 10001 app

WORKDIR /srv

# Dependencies first (cached unless the lockfile changes). Same pinned versions as CI.
COPY backend/pyproject.toml backend/uv.lock backend/
RUN uv sync --frozen --no-dev --project backend

COPY backend/app backend/app
COPY contracts/fixtures/v3 contracts/fixtures/v3
COPY data/curated data/curated

# No .env is copied: configuration comes from Cloud Run environment variables, and credentials
# from the service account (no key files).
USER app
EXPOSE 8080
CMD ["sh", "-c", "exec backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8080}"]
