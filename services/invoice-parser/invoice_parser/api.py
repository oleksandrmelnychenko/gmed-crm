import asyncio
from contextlib import asynccontextmanager
import hmac
from typing import Annotated

from fastapi import FastAPI, HTTPException, Request, Security
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .runner import ParseFailed, run_worker
from .settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        app.state.settings = settings or Settings.from_env()
        app.state.slots = asyncio.Semaphore(app.state.settings.max_concurrency)
        yield

    app = FastAPI(title="GMED Invoice Parser", version="0.1.0", lifespan=lifespan)
    bearer = HTTPBearer(auto_error=False)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/v1/parse", openapi_extra={"requestBody": {
        "required": True, "content": {mime: {"schema": {"type": "string", "format": "binary"}}
                                     for mime in ("application/pdf", "image/png", "image/jpeg", "application/xml", "text/xml")},
    }})
    async def parse(
        request: Request,
        authorization: Annotated[HTTPAuthorizationCredentials | None, Security(bearer)],
    ):
        config = app.state.settings
        token = authorization.credentials if authorization else ""
        if not hmac.compare_digest(token.encode(), config.api_key.encode()):
            raise HTTPException(401, "Invalid service credentials")
        mime = request.headers.get("content-type", "").split(";", 1)[0].lower().strip()
        signatures = {"application/pdf": b"%PDF-", "image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}
        is_xml = mime in {"application/xml", "text/xml"}
        if mime not in signatures and not is_xml:
            raise HTTPException(415, "Use PDF, PNG, JPEG or invoice XML")
        maximum = min(config.max_file_bytes, 5 * 1024 * 1024) if is_xml else config.max_file_bytes
        length = request.headers.get("content-length")
        if length is not None:
            if not length.isdigit():
                raise HTTPException(400, "Invalid Content-Length")
            if int(length) > maximum:
                raise HTTPException(413, "Document exceeds size limit")
        slots = app.state.slots
        if slots.locked():
            raise HTTPException(429, "Parser is busy", headers={"Retry-After": "5"})
        async with slots:
            try:
                async with asyncio.timeout(config.timeout_seconds):
                    data = bytearray()
                    async for chunk in request.stream():
                        if len(data) + len(chunk) > maximum:
                            raise HTTPException(413, "Document exceeds size limit")
                        data.extend(chunk)
                    if not data:
                        raise HTTPException(400, "Empty document")
                    if not is_xml and not data.startswith(signatures[mime]):
                        raise HTTPException(415, "Document signature does not match Content-Type")
                    result = await run_worker(bytes(data), mime)
                    return JSONResponse(result, headers={"Cache-Control": "no-store"})
            except TimeoutError as exc:
                raise HTTPException(504, "Invoice extraction timed out") from exc
            except ParseFailed as exc:
                raise HTTPException(422, "Invoice extraction failed") from exc

    return app


app = create_app()
