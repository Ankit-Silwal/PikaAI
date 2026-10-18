BEGIN;

-- CreateEnum
CREATE TYPE "OrganizationJoinPolicy" AS ENUM ('OPEN', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "OrganizationMembershipStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateTable
CREATE TABLE "auth_organizations" (
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "join_policy" "OrganizationJoinPolicy" NOT NULL,
    "invite_code" CHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_organizations_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "auth_organization_memberships" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "status" "OrganizationMembershipStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_organization_memberships_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_organizations_invite_code_key" ON "auth_organizations"("invite_code");

-- CreateIndex
CREATE INDEX "auth_organization_memberships_user_id_idx" ON "auth_organization_memberships"("user_id");

-- AddForeignKey
ALTER TABLE "auth_organization_memberships" ADD CONSTRAINT "auth_organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth_organizations"("organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_organization_memberships" ADD CONSTRAINT "auth_organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
