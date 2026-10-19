from io import BytesIO
from contextlib import closing
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from qdrant_client import QdrantClient

from rag.config import Settings
from rag.main import create_app


@pytest.fixture(scope="module")
def service():
    collection = "pikaai_test_" + uuid4().hex
    settings = Settings(
        _env_file=None, rag_service_token="rag-integration-test-token", api_key="test-only-key",
        gemini_base_url="http://127.0.0.1:4900/gemini/v1beta/openai/", qdrant_collection=collection,
        max_upload_bytes=1048576,
    )
    with TestClient(create_app(settings)) as client:
        yield client, settings
    with closing(QdrantClient(url=settings.qdrant_url)) as qdrant:
        assert collection.startswith("pikaai_test_")
        if qdrant.collection_exists(collection):
            qdrant.delete_collection(collection)


AUTH = {"Authorization": "Bearer rag-integration-test-token"}


def upload(client, organization, document, content, filename="notes.txt"):
    return client.post("/documents/index", headers=AUTH,
                       data={"organization_id": organization, "document_id": document},
                       files={"file": (filename, content)})


def test_auth_and_validation(service):
    client, _ = service
    assert client.get("/health").status_code == 200
    assert client.post("/query", json={"organization_id": str(uuid4()), "question": "hi"}).status_code == 401
    assert client.post("/query", headers=AUTH, json={"organization_id": str(uuid4()), "question": " "}).status_code == 422
    assert upload(client, str(uuid4()), str(uuid4()), b"", "empty.txt").status_code == 422
    assert upload(client, str(uuid4()), str(uuid4()), b"hello", "notes.exe").status_code == 415
    assert upload(client, str(uuid4()), str(uuid4()), b"not a PDF", "invalid.pdf").status_code == 422
    assert upload(client, str(uuid4()), str(uuid4()), b"x" * 1048577).status_code == 413


def test_semantic_retrieval_isolation_idempotence_and_provider_errors(service):
    client, settings = service
    org, other_org, document = str(uuid4()), str(uuid4()), str(uuid4())
    text = b"Employees may work from home on Friday. Remote work requires manager approval."
    response = upload(client, org, document, text)
    assert response.status_code == 200, response.text
    assert response.json()["chunk_count"] == 1
    assert upload(client, other_org, str(uuid4()), b"PRIVATE: The rocket launch password is Jupiter.").status_code == 200
    assert upload(client, org, document, text).status_code == 200
    with closing(QdrantClient(url=settings.qdrant_url)) as qdrant:
        assert qdrant.count(settings.qdrant_collection, exact=True).count == 2
    response = client.post("/query", headers=AUTH, json={"organization_id": org, "question": "When can staff avoid commuting?"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["answer"]
    assert {source["document_id"] for source in result["sources"]} == {document}
    assert result["sources"][0]["text"] == text.decode()
    empty = client.post("/query", headers=AUTH, json={"organization_id": str(uuid4()), "question": "Work policy?"})
    assert empty.status_code == 200
    assert empty.json()["sources"] == []
    error = client.post("/query", headers=AUTH, json={"organization_id": org, "question": "__provider_error__"})
    assert error.status_code == 503
    assert error.json() == {"detail": "Gemini request failed"}


def pdf_with_text():
    writer = PdfWriter()
    for text in ["The company builds bicycles.", "Our refund window is thirty days."]:
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_pdf_page_references(service):
    client, _ = service
    org, document = str(uuid4()), str(uuid4())
    response = upload(client, org, document, pdf_with_text(), "policy.pdf")
    assert response.status_code == 200, response.text
    assert response.json()["chunk_count"] == 2
    result = client.post("/query", headers=AUTH, json={"organization_id": org, "question": "How long do customers have to return purchases?"})
    assert result.status_code == 200, result.text
    assert result.json()["sources"][0]["page_label"] == "2"
    assert result.json()["sources"][0]["filename"] == "policy.pdf"
