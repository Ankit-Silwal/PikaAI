from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from langchain_core.documents import Document
from pypdf import PdfReader


def extract_pages(content: bytes, filename: str) -> list[Document]:
    extension = Path(filename).suffix.lower()
    try:
        if extension in {".txt", ".md"}:
            pages = [Document(page_content=content.decode("utf-8-sig"), metadata={"source": filename})]
        elif extension == ".pdf":
            reader = PdfReader(BytesIO(content))
            if reader.is_encrypted:
                raise HTTPException(422, "Encrypted PDFs are not supported")
            labels = reader.page_labels
            pages = [Document(page_content=page.extract_text() or "", metadata={"source": filename, "page_label": str(labels[index])})
                     for index, page in enumerate(reader.pages)]
        else:
            raise HTTPException(415, "Supported formats: .txt, .md, .pdf")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(422, "Unable to extract document text") from error
    for page in pages:
        page.page_content = page.page_content.replace("\x00", "").strip()
    pages = [page for page in pages if page.page_content]
    if not pages:
        raise HTTPException(422, "Document contains no extractable text; scanned PDFs need OCR")
    return pages


def chunk_text(text: str) -> list[str]:
    # Character chunks keep the first implementation independent of a tokenizer.
    size, overlap = 1200, 200
    chunks = []
    start = 0
    while start < len(text):
        chunk = text[start:start + size].strip()
        if chunk:
            chunks.append(chunk)
        if start + size >= len(text):
            break
        start += size - overlap
    return chunks
