"""Only the Firebase Admin verifier grants identity; no mock-token bypass."""
import os
from threading import Lock

from fastapi import Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer(auto_error=False, scheme_name="FirebaseBearer", bearerFormat="Firebase ID token")
_lock = Lock()


def verify_token(token: str, settings) -> str:
    import firebase_admin
    from firebase_admin import auth
    if settings.firebase_auth_emulator_host:
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = settings.firebase_auth_emulator_host
    name = "zurashitabi-" + settings.gcp_project_id
    with _lock:
        try:
            app = firebase_admin.get_app(name)
        except ValueError:
            app = firebase_admin.initialize_app(options={"projectId": settings.gcp_project_id}, name=name)
    decoded = auth.verify_id_token(token, app=app, check_revoked=True)
    uid = decoded.get("uid") or decoded.get("sub")
    if not isinstance(uid, str) or not uid:
        raise ValueError("missing verified identity")
    return uid


async def current_uid(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    from firebase_admin import auth
    from google.auth.exceptions import GoogleAuthError

    if not credentials:
        raise HTTPException(401, "UNAUTHENTICATED", headers={"WWW-Authenticate": "Bearer"})
    if credentials.credentials.count(".") != 2:
        raise HTTPException(401, "UNAUTHENTICATED", headers={"WWW-Authenticate": "Bearer"})
    try:
        return await run_in_threadpool(verify_token, credentials.credentials, request.app.state.settings)
    except (auth.CertificateFetchError, auth.InsufficientPermissionError, GoogleAuthError):
        raise HTTPException(503, "DEPENDENCY_UNAVAILABLE") from None
    except (auth.InvalidIdTokenError, auth.RevokedIdTokenError, auth.UserDisabledError, auth.UserNotFoundError, ValueError):
        raise HTTPException(401, "UNAUTHENTICATED", headers={"WWW-Authenticate": "Bearer"}) from None
    except Exception:
        # Infrastructure failures must not trigger repeated token refresh. Do not expose secrets.
        raise HTTPException(503, "DEPENDENCY_UNAVAILABLE") from None
