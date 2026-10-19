# PikaAI

Separate TypeScript apps for the Express API (`apps/api`) and BullMQ worker
(`apps/worker`), with their queue contract in `packages/queues`.

```text
apps/api/
  prisma/schema.prisma
  prisma.config.ts
  src/
    configs/
      bullmq.ts
      db.ts
      env.ts
    middleware/
      authenticate.ts
      error-handler.ts
    modules/
      auth/
        auth.routes.ts
        auth.controller.ts
        auth.service.ts
        auth.types.ts
      health/
        health.routes.ts
        health.controller.ts
      organizations/
        organization.routes.ts
        organization.controller.ts
        organization.service.ts
        organization.types.ts
      documents/
        document.routes.ts
        document.controller.ts
        document.service.ts
        document.types.ts
        document.upload.ts
        document.queue.ts
    utils/
      jwt.ts
      http-error.ts
    app.ts
    server.ts
apps/worker/
  src/
    configs/
      bullmq.ts
      db.ts
      env.ts
    modules/documents/document.worker.ts
    server.ts
packages/queues/
  src/index.ts
```

Each feature will live in `src/modules/<feature>/` with its own routes, controller,
and service as needed. Routes map URLs, controllers handle HTTP input/output, and
services handle business logic and database operations. The health check has no
business logic, so it only needs routes and a controller. Shared configuration
belongs in `configs`; shared helpers belong in `utils`; shared Express middleware
belongs in `middleware`.

1. Run `npm install`.
2. Copy `.env.example` to `.env`, set PostgreSQL, Redis, SMTP, and JWT settings (see below).
3. Run `npm run db:up`, `npm run db:migrate`, then `npm run dev`.

`npm run dev` starts the API and worker as separate processes. To run them
individually, use `npm run dev:api` and `npm run worker` in separate terminals.

`GET http://localhost:3001/health` returns `{ "status": "ok" }`.
Prisma checks PostgreSQL on startup and logs connection errors to the terminal.
The server still starts if PostgreSQL is unavailable; `/health` checks server liveness.
Redis must be available at startup because authentication relies on it for rate
limits and OTP verification.

Prisma's client generates automatically for dev, build, and check.
Run `npm run check` for type checking. `npm run build` builds the shared queue
package and both apps. Start the production API with `npm start` and the
production worker separately with `npm run worker:start`.

## Authentication

Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env` to different random
secrets of at least 32 characters. Generate each with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Set `CORS_ORIGIN` to your frontend origin (default `http://localhost:3000`).
Run `npm run db:migrate` before starting the backend.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /auth/send-otp` | JSON `{ "email": "you@example.com" }` | `200 { "message": "OTP sent to your email" }` |
| `POST /auth/register` | JSON `{ "email": "you@example.com", "password": "your-password", "otp": "123456" }` | `201` with user, access token, and refresh cookie |
| `POST /auth/login` | JSON `{ "email": "you@example.com", "password": "your-password" }` | `200` with user, access token, and refresh cookie |
| `POST /auth/refresh` | `refreshToken` cookie | `200` with user, a new access token, and replacement refresh cookie |
| `POST /auth/logout` | `refreshToken` cookie, when available | `204`, revokes that refresh token and clears its cookie |
| `GET /auth/me` | `Authorization: Bearer <accessToken>` header | `200 { "user": { "user_id", "email", "role" } }` from the verified JWT |

Register, login, and refresh return `{ "user": { "user_id", "email", "role" },
"accessToken": "signed-jwt" }`. Send that access token in the `Authorization`
request header on protected routes. JWT creation and verification functions live
in `src/utils/jwt.ts`. The raw refresh token is only sent in its HTTP-only cookie.

Emails are trimmed and lowercased. Passwords must be at least 8 characters and
at most 72 UTF-8 bytes. Duplicate registration returns `409`; invalid input
returns `400`; invalid credentials or tokens return `401`. Errors use
`{ "error": "message" }`.

### Registration OTP and rate limits

Call `/auth/send-otp` first, then send the emailed six-digit code as a **string**
in `/auth/register`. No account or tokens are created until the OTP is verified.
Codes expire after five minutes, work once, and are invalidated after five wrong
guesses. A resend replaces the previous code. Redis stores only a keyed hash of
the code. Codes are never returned in API responses or logged. If account
creation fails after consuming a valid OTP, request a new code before retrying.
Requesting an OTP for an existing account returns `409`.

The limits below use `express-rate-limit` with `rate-limit-redis`, shared across
API instances using the same Redis and `REDIS_KEY_PREFIX` (default `pikaai:`).
Each limit has its own 60-second window starting with the first request.

| Action | Limit per client IP |
| --- | --- |
| Send/resend OTP | 3 requests per minute |
| Register | 5 requests per minute |
| Failed login (`401`, including unknown email) | 5 failures per minute |

The next request returns `429` with an error and `Retry-After` in seconds.
Successful logins and validation errors do not count toward the failed-login
limit. After five failures, further logins are blocked until the window resets,
including attempts with the correct password. Requests in flight temporarily
count until their result is known. People sharing an IP share these limits.
Express does not trust forwarded IP headers by default. When deploying behind
a reverse proxy, configure `trust proxy` in `src/app.ts` for your trusted proxy
addresses or exact hop count; do not enable unconditional trust of client headers.

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and
`SMTP_FROM` in `.env`. `SMTP_FROM` defaults to `SMTP_USER` if omitted. Port 465
uses `SMTP_SECURE=true`; port 587 uses `SMTP_SECURE=false` and STARTTLS.
Production requires TLS. Use the SMTP credentials required by your email provider
(for example, an app password if your provider requires one). Nodemailer's
[SMTP transport documentation](https://nodemailer.com/smtp) describes these settings.
Missing SMTP configuration or a failed send returns `503`; a failed send removes
its pending code. Redis errors during authentication requests return `503` and
do not bypass the limit.

The Prisma `User` model uses the `auth_users` table: `user_id`, `role`,
`refreshToken`, `email`, `password_hash`, and `created_at`. Public registration
always assigns `USER`; `ADMIN` is reserved for trusted database administration.
Passwords use bcrypt with 12 rounds. The `refreshToken` column stores a SHA-256
hash, never the raw token. Existing tables from the old backend are untouched.

JWT access tokens expire after 24 hours; refresh tokens expire after 7 days.
The refresh cookie is HTTP-only, SameSite=Lax, and Secure in production (HTTPS required).
Browser requests must use `credentials: "include"`; state-changing requests from
origins other than `CORS_ORIGIN` return `403`.

Access-token verification is stateless. Refresh and logout use the database:
each user has one active refresh token, replaced on login or refresh. Reused
refresh tokens are rejected. Logout does not invalidate an already issued access
token before its 24-hour expiry, and role changes take effect on the next
login/refresh. Keep the frontend and API on the same site for SameSite=Lax cookies.

Run `npm test` with local PostgreSQL and Redis running for the auth integration
checks. Tests use a local SMTP test server through the real Nodemailer transport;
no provider credentials are needed and no external email is sent. They create
uniquely named users and Redis keys and clean up only their own data.

## Organizations

All organization endpoints require `Authorization: Bearer <accessToken>`.
Any signed-in user can create an organization and becomes its first active
organization admin. Organization roles (`ADMIN`, `MEMBER`) are independent of
the user's global auth role. A user can belong to multiple organizations.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /organizations` | `{ "name": "My organization", "joinPolicy": "OPEN" }` | `201 { "organization", "inviteCode" }`; creator becomes admin |
| `POST /organizations/join` | `{ "inviteCode": "<code>" }` | `201 { "organization", "membership" }` with status `ACTIVE` or `PENDING` |
| `GET /organizations/:organizationId/invite-code` | Organization admin only | `200 { "inviteCode": "<code>" }` |
| `GET /organizations/:organizationId/members` | Organization admin only | `200 { "members": [...] }`, including pending requests and member email addresses |
| `POST /organizations/:organizationId/join-requests/:userId/approve` | Organization admin only; no body | `200 { "membership" }` with status `ACTIVE` |
| `POST /organizations/:organizationId/members/:userId/admin` | Organization admin only; no body | `200 { "membership" }` with role `ADMIN`; target must already be active |

`joinPolicy` is required: `OPEN` joins immediately; `APPROVAL_REQUIRED` creates a
pending request that an active admin of that same organization must approve.
Organization names are trimmed and must contain 1–100 characters. Invite codes
are generated by the server. Only creation and the admin-only invite-code
endpoint return a code, so admins control sharing it. Joining always assigns
`MEMBER`; clients cannot choose their membership role or approval status.

Public organization objects contain `organization_id`, `name`, `join_policy`,
and `created_at`. Memberships contain `organization_id`, `user_id`, `role`,
`status`, and `created_at`. Member listing also includes `user: { "email" }`.
Pending users have no organization admin privileges and cannot be promoted until
approved. Duplicate joins or pending requests return `409`; unknown invite codes
and missing approval/promotion targets return `404`; invalid input returns `400`;
missing authentication returns `401`; non-admin access to admin endpoints returns
`403`. Global admins have no automatic authority over another organization.

Run `npm run db:migrate` to create `auth_organizations` and
`auth_organization_memberships`. Tables from the older backend remain untouched.
No organization rate limits are configured.

## Document uploads and worker

Organization documents are uploaded with `multipart/form-data`, using a single
file field named `file`. Both endpoints require a Bearer access token and an
`ACTIVE` membership in the organization; pending users and outsiders return `403`.

| Endpoint | Response |
| --- | --- |
| `POST /organizations/:organizationId/documents` | `202 { "document": {...}, "jobId": "<document_id>" }` after BullMQ accepts the job |
| `GET /organizations/:organizationId/documents/:documentId` | `200 { "document": {...} }` with the current processing status; `404` for a missing document or one from another organization |

Document metadata contains `document_id`, `organization_id`, `uploaded_by`,
`original_name`, `mime_type`, `size_bytes`, `status`, and `created_at`. File contents
are stored under server-generated IDs in `DOCUMENT_UPLOAD_DIR` (default `uploads/`
at the repository root), outside public routes and Git. The upload must be nonempty;
`MAX_UPLOAD_BYTES` defaults to 10485760 (10 MiB). Larger uploads return `413`;
missing files and invalid multipart fields return `400`. File types are preserved
as metadata; extraction and supported RAG formats will be implemented later.

Redis holds BullMQ jobs containing only a document ID. The worker loads metadata
from PostgreSQL and checks the stored file is readable, advancing
`QUEUED` → `PROCESSING` → `AWAITING_RAG`. `AWAITING_RAG` means the upload has reached
the future RAG processing hook; text extraction, chunking, embeddings, and indexing
are not implemented yet. Failed processing retries up to three times with
exponential backoff, then records `FAILED`. Retrying an already prepared document
does not repeat preparation. Queue submission failures return `503` and clean up
the new document record and file; no successful upload is reported without a job.

The standalone worker lives entirely in `apps/worker`: its entry point is
`src/server.ts`, and its processor is `src/modules/documents/document.worker.ts`.
It has its own package, build, PostgreSQL pool, Redis connections, and configuration.
It imports no API application code and needs no JWT or SMTP settings. The API only
enqueues jobs. `@pikaai/queues` shares the queue name and job payload type.

Run `npm run db:migrate`, then `npm run dev:api` for the API and `npm run worker`
in a second terminal for the worker. After `npm run build`, use `npm start` and
`npm run worker:start` as independent production processes; the worker entry point
is `node apps/worker/dist/server.js`. The worker accepts environment variables or
an optional `apps/worker/.env` (see its `.env.example`), with the repository `.env`
as a local fallback. Without a running worker, accepted jobs remain queued.
The API and worker must use the same Redis, `REDIS_KEY_PREFIX`, database,
and upload directory. Separate hosts/containers require that directory to be
mounted as shared persistent storage. Completed and failed queue history keeps
the most recent 1000 jobs of each kind; document metadata and files are retained.
There are no new rate limits or external RAG integrations.

The filesystem, PostgreSQL, and Redis are separate writes. Normal request failures
are cleaned up, but a process crash between writes can leave an orphaned upload
or a queued record without a job; this initial implementation has no outbox or
background reconciliation.
