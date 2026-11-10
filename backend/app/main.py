"""Shared HTTP skeleton. Unimplemented services fail explicitly after authentication."""
from collections.abc import Callable
from datetime import date
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.auth import current_uid
from app.core.errors import AppError, not_found
from app.core.settings import Settings
from app.domain.planner import BaselinePlanner
from app.domain.ports import Explainer, IntentInterpreter, Planner
from app.repositories.routes import route_catalog_for
from app.repositories.spots import spot_catalog_for
from app.repositories.trips import FirestoreTripRepository, TripRepository
from app.schemas.contracts import (
    ErrorResponse,
    HealthResponse,
    Identifier,
    IntentDraftResponse,
    IntentInterpretRequest,
    Locale,
    ProposalBundle,
    ProposalRequest,
    SelectionRequest,
    SelectionResponse,
    SpotListResponse,
    TripCreateRequest,
    TripResponse,
)
from app.services import proposals as proposal_service
from app.services import trips as trip_service
from app.services.intent import IntentService, gemini_interpreter_factory


def create_app(
    settings: Settings | None = None,
    *,
    trip_repository: TripRepository | None = None,
    spot_catalog=None,
    route_catalog=None,
    planner: Planner | None = None,
    intent_interpreter_factory: Callable[[], IntentInterpreter | None] | None = None,
    explainer_factory: Callable[[], Explainer | None] | None = None,
) -> FastAPI:
    settings = settings or Settings()
    api = FastAPI(title="ずらしたび API", version="3.0.0", description="v3 contract with authenticated trip, proposal, intent and selection services.")
    api.state.settings = settings
    # Tests inject an in-memory repository; the app default is Firestore (emulator locally, real project on Cloud Run).
    repo = trip_repository or FirestoreTripRepository(settings.gcp_project_id, settings.firestore_emulator_host, settings.firestore_database)
    catalog = spot_catalog or spot_catalog_for(settings.data_mode)
    routes = route_catalog or route_catalog_for(settings.data_mode)
    planner = planner or BaselinePlanner()
    explainer_for = explainer_factory or proposal_service.gemini_explainer_factory(settings)
    intent = IntentService(catalog, intent_interpreter_factory or gemini_interpreter_factory(settings), settings.generation_timeout_seconds)
    api.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"], expose_headers=["X-Request-ID", "Retry-After"])

    @api.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        return response

    def error_response(request, status, code, details=None, headers=None):
        return JSONResponse(status_code=status, content={"error": {"code": code, "message": code, "details": details or [], "request_id": getattr(request.state, "request_id", str(uuid4()))}}, headers=headers)

    @api.exception_handler(StarletteHTTPException)
    async def http_error(request, error):
        codes = {401: "UNAUTHENTICATED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 503: "DEPENDENCY_UNAVAILABLE"}
        return error_response(request, error.status_code, codes.get(error.status_code, "HTTP_ERROR"), headers=error.headers)

    @api.exception_handler(AppError)
    async def app_error(request, error):
        return error_response(request, error.status, error.code, error.details, error.headers)

    @api.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Omit input values and validator context: these may contain raw text or secrets.
        details = [{"code": item["type"], "message": "Invalid value", "field": ".".join(map(str, item["loc"]))} for item in error.errors()]
        return error_response(request, 422, "VALIDATION_ERROR", details)

    @api.exception_handler(Exception)
    async def internal_error(request, error):
        return error_response(request, 500, "INTERNAL_ERROR")

    errors = {status: {"model": ErrorResponse} for status in [401, 404, 409, 422, 429, 500, 503, 504]}

    @api.get("/health", response_model=HealthResponse, operation_id="health")
    async def health():
        return HealthResponse()

    @api.get("/api/v1/spots", response_model=SpotListResponse, responses=errors, operation_id="listSpots")
    async def list_spots(area_id: Identifier, visit_date: date, locale: Locale, q: Annotated[str | None, Query(max_length=100)] = None, uid: str = Depends(current_uid)):
        listing = catalog.list(area_id, visit_date, locale, q)
        if listing is None:
            raise not_found()
        return listing

    @api.post("/api/v1/intent/interpret", response_model=IntentDraftResponse, responses=errors, operation_id="interpretIntent")
    async def interpret_intent(body: IntentInterpretRequest, uid: str = Depends(current_uid)):
        return await intent.interpret(body)

    @api.post("/api/v1/trips", response_model=TripResponse, status_code=201, responses=errors, operation_id="createTrip")
    async def create_trip(body: TripCreateRequest, uid: str = Depends(current_uid)):
        return await trip_service.create_trip(uid, body, catalog, repo)

    @api.get("/api/v1/trips/{trip_id}", response_model=TripResponse, responses=errors, operation_id="getTrip")
    async def get_trip(trip_id: Identifier, uid: str = Depends(current_uid)):
        return await trip_service.get_trip(uid, trip_id, repo)

    @api.post("/api/v1/trips/{trip_id}/proposals", response_model=ProposalBundle, status_code=201, responses=errors, operation_id="createProposal")
    async def create_proposal(trip_id: Identifier, body: ProposalRequest, uid: str = Depends(current_uid)):
        return await proposal_service.create_proposal(
            uid, trip_id, body,
            catalog=catalog, routes=routes, repo=repo, planner=planner, explainer=explainer_for(),
            timeout_seconds=settings.generation_timeout_seconds,
        )

    @api.get("/api/v1/trips/{trip_id}/proposals/{proposal_id}", response_model=ProposalBundle, responses=errors, operation_id="getProposal")
    async def get_proposal(trip_id: Identifier, proposal_id: Identifier, uid: str = Depends(current_uid)):
        return await trip_service.get_proposal(uid, trip_id, proposal_id, repo)

    @api.post("/api/v1/trips/{trip_id}/proposals/{proposal_id}/selection", response_model=SelectionResponse, responses=errors, operation_id="selectPlan")
    async def select_plan(trip_id: Identifier, proposal_id: Identifier, body: SelectionRequest, uid: str = Depends(current_uid)):
        return await trip_service.select_plan(uid, trip_id, proposal_id, body, repo)

    return api


app = create_app()
