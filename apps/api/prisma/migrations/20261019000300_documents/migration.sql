BEGIN;

-- CreateEnum
CREATE TYPE "DocumentProcessingStatus" AS ENUM ('QUEUED', 'PROCESSING', 'AWAITING_RAG', 'FAILED');

-- CreateTable
CREATE TABLE "auth_documents" (
    "document_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "DocumentProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE INDEX "auth_documents_organization_id_idx" ON "auth_documents"("organization_id");

-- CreateIndex
CREATE INDEX "auth_documents_uploaded_by_idx" ON "auth_documents"("uploaded_by");

-- AddForeignKey
ALTER TABLE "auth_documents" ADD CONSTRAINT "auth_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth_organizations"("organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_documents" ADD CONSTRAINT "auth_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth_users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
