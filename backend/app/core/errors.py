"""Application errors rendered as the shared ErrorResponse by app.main."""


class AppError(Exception):
    def __init__(self, status: int, code: str, details: list[dict] | None = None, headers: dict | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.details = details or []
        self.headers = headers


def invalid(field: str, code: str = "invalid_reference") -> AppError:
    """422 for input that is well-formed but refers to something the server does not hold."""
    return AppError(422, "VALIDATION_ERROR", [{"code": code, "message": "Invalid value", "field": field}])


def unavailable() -> AppError:
    return AppError(503, "DEPENDENCY_UNAVAILABLE")


def not_found() -> AppError:
    # Same response whether the resource is missing or owned by someone else (no existence leak).
    return AppError(404, "NOT_FOUND")
