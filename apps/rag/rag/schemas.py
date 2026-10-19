from uuid import UUID

from pydantic import BaseModel, Field


class IndexResponse(BaseModel):
    document_id: UUID
    chunk_count: int


class QueryRequest(BaseModel):
    organization_id: UUID
    question: str = Field(min_length=1, max_length=4000)


class Source(BaseModel):
    document_id: UUID
    filename: str
    chunk_index: int
    text: str
    page_label: str | None = None


class QueryResponse(BaseModel):
    answer: str
    sources: list[Source]
