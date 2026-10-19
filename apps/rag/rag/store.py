from functools import cached_property
from uuid import NAMESPACE_URL, uuid5

from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import UnexpectedResponse

from .config import Settings
from .schemas import Source


class VectorStore:
    def __init__(self, settings: Settings, client: QdrantClient):
        self.client = client
        self.collection = settings.qdrant_collection

    @cached_property
    def embeddings(self):
        return HuggingFaceEmbeddings(
            model_name="BAAI/bge-small-en-v1.5",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
            query_encode_kwargs={"normalize_embeddings": True, "prompt": "Represent this sentence for searching relevant passages: "},
        )

    @cached_property
    def vector_db(self):
        if not self.client.collection_exists(self.collection):
            try:
                self.client.create_collection(
                    self.collection,
                    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE),
                )
            except UnexpectedResponse as error:
                if error.status_code != 409:
                    raise
        self.client.create_payload_index(self.collection, "metadata.organization_id", models.PayloadSchemaType.KEYWORD, wait=True)
        return QdrantVectorStore(client=self.client, collection_name=self.collection, embedding=self.embeddings)

    def index(self, organization_id: str, document_id: str, filename: str, chunks: list[Document]):
        ids = []
        for index, chunk in enumerate(chunks):
            chunk.metadata.update({"organization_id": organization_id, "document_id": document_id,
                                   "filename": filename, "chunk_index": index})
            # Files are immutable; stable IDs prevent duplicates on BullMQ retries.
            ids.append(str(uuid5(NAMESPACE_URL, f"{organization_id}:{document_id}:{index}")))
        self.vector_db.add_documents(documents=chunks, ids=ids, batch_size=64, wait=True)

    def search(self, organization_id: str, question: str) -> list[Source]:
        if not self.client.collection_exists(self.collection):
            return []
        documents = self.vector_db.similarity_search(
            query=question, k=5,
            filter=models.Filter(must=[models.FieldCondition(
                key="metadata.organization_id", match=models.MatchValue(value=organization_id),
            )]),
        )
        return [Source(**{key: value for key, value in doc.metadata.items() if key in Source.model_fields}, text=doc.page_content)
                for doc in documents]
