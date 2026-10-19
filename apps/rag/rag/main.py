from contextlib import asynccontextmanager
from hmac import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import ResponseHandlingException, UnexpectedResponse

from .config import Settings
from .extraction import chunk_text, extract_pages
from .gemini import Gemini
from .schemas import IndexResponse, QueryRequest, QueryResponse
from .store import VectorStore


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if not settings.rag_service_token:
            raise RuntimeError("RAG_SERVICE_TOKEN is required")
        qdrant = QdrantClient(
            url=settings.qdrant_url, api_key=settings.qdrant_api_key or None, timeout=30,
        )
        app.state.gemini = Gemini(settings)
        try:
            app.state.store = VectorStore(settings, qdrant)
            # Load once before accepting concurrent indexing/search requests.
            await run_in_threadpool(lambda: app.state.store.embeddings)
            yield
        finally:
            app.state.gemini.close()
            qdrant.close()

    app = FastAPI(title="PikaAI RAG", lifespan=lifespan)
    bearer = HTTPBearer(auto_error=False)

    def authorize(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if not settings.rag_service_token or not credentials or not compare_digest(credentials.credentials.encode(), settings.rag_service_token.encode()):
            raise HTTPException(401, "Invalid service token")

    @app.exception_handler(UnexpectedResponse)
    @app.exception_handler(ResponseHandlingException)
    def qdrant_error(request, error):
        return JSONResponse(status_code=503, content={"detail": "Qdrant request failed"})

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/documents/index", response_model=IndexResponse, dependencies=[Depends(authorize)], responses={
        401: {"description": "Invalid service token"}, 413: {"description": "Upload too large"},
        415: {"description": "Unsupported format"}, 422: {"description": "Invalid input or unreadable document"},
        503: {"description": "Qdrant unavailable"},
    })
    async def index_document(
        document_id: Annotated[UUID, Form()], organization_id: Annotated[UUID, Form()],
        file: Annotated[UploadFile, File()],
    ):
        try:
            content = await file.read(settings.max_upload_bytes + 1)
            if len(content) > settings.max_upload_bytes:
                raise HTTPException(413, "Document exceeds MAX_UPLOAD_BYTES")
            if not content:
                raise HTTPException(422, "Document must not be empty")
            filename = file.filename or ""
            if not filename or len(filename) > 255:
                raise HTTPException(422, "Invalid filename")

            def ingest():
                pages = extract_pages(content, filename)
                chunks = []
                for page in pages:
                    for text in chunk_text(page.page_content):
                        chunks.append(type(page)(page_content=text, metadata=dict(page.metadata)))
                app.state.store.index(str(organization_id), str(document_id), filename, chunks)
                return IndexResponse(document_id=document_id, chunk_count=len(chunks))

            return await run_in_threadpool(ingest)
        finally:
            await file.close()

    @app.post("/query", response_model=QueryResponse, dependencies=[Depends(authorize)], responses={
        401: {"description": "Invalid service token"}, 503: {"description": "Qdrant or Gemini unavailable or unconfigured"},
    })
    def query(body: QueryRequest):
        question = body.question.strip()
        if not question:
            raise HTTPException(422, "Question must not be empty")
        sources = app.state.store.search(str(body.organization_id), question)
        if not sources:
            return QueryResponse(answer="No indexed documents were found for this organization.", sources=[])
        context = "\n\n".join(f"[{index}] File: {source.filename}; Page: {source.page_label or 'N/A'}\n{source.text}" for index, source in enumerate(sources, 1))
        return QueryResponse(answer=app.state.gemini.answer(question, context), sources=sources)

    return app


app = create_app()
