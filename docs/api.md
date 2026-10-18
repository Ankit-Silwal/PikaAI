# Authentication and resource contract

All application endpoints use `/api`. Responses use `{ success: true, data: ... }`;
errors use `{ success: false, error: { message, requestId, details? } }`. Resource
IDs are UUIDs. Request objects reject unknown properties. Collection requests use
`?limit=20&offset=0` (limit 1–100, offset 0–100000) and return `pagination` alongside
`data`. Lists are ordered newest first, with UUID as a stable tie-breaker.

## Authentication

| Method | Path | Body / response |
| --- | --- | --- |
| POST | `/auth/register` | `{name,email,password}` → 201 `{user,accessToken,tokenType:"Bearer",expiresIn:900}` |
| POST | `/auth/login` | `{email,password}` → 200 same token response |
| GET | `/auth/me` | Current `{id,name,email,createdAt}` |
| GET | `/auth/activity` | Current user's latest `{ip,userAgent,lastSeenAt,lastLoginAt}` from Redis |
| POST | `/auth/logout` | Revoke the presented token until its expiry; 204 |

Names are trimmed (1–100 characters), email is trimmed and lowercased (max 254),
and registration passwords are 15–128 characters. Passwords are neither trimmed
nor returned. Duplicate email returns 409. Invalid login returns a generic 401.
Registration/login have a shared Redis-backed per-IP limit (default 10/15 min),
in addition to the general API limit. Email ownership verification and password
reset are not included in this local authentication foundation.

Send `Authorization: Bearer <accessToken>` for all other application endpoints.
Tokens expire after 15 minutes by default (configurable up to one hour); log in
again after expiry. No cookie session or refresh token is issued. Verification
checks algorithm, issuer, audience, expiry, subject, and token ID. Redis stores
revocations, a global token epoch, and latest activity (24-hour TTL by default),
not a server-side login session. Resetting Redis changes the epoch and invalidates
old tokens. Preserve its AOF volume; an unclean crash can still lose recent writes.
IP/user-agent are observations, not identity proof or an IP lock. Forwarded IP
headers are ignored unless explicit trusted proxy addresses are configured.

Redis is required: authenticated operations fail with 503 if Redis cannot be
checked. Revocation does not bypass validation on a Redis outage. An in-flight
request that already passed verification can complete while logout occurs.

## Organizations, workspaces, documents

| Method | Path | Body / response |
| --- | --- | --- |
| GET | `/organizations` | List organizations the current user belongs to |
| POST | `/organizations` | `{name}` → 201 organization; creator becomes owner atomically |
| GET | `/organizations/:organizationId` | Organization details and current user's role |
| GET | `/organizations/:organizationId/workspaces` | List workspaces in a member organization |
| POST | `/organizations/:organizationId/workspaces` | `{name,description?}` → 201 workspace |
| GET | `/workspaces/:workspaceId` | Workspace details |
| GET | `/workspaces/:workspaceId/documents` | List document metadata, excluding content |
| POST | `/workspaces/:workspaceId/documents` | `{title,content}` → 201 stored text document |
| GET | `/documents/:documentId` | Document including content |

Organization members can read and create workspaces and documents in that
organization. Every lookup checks membership in PostgreSQL; tokens do not embed
tenant roles. Inaccessible and missing resources both return 404. Member-invite
and membership-management endpoints are deferred. Workspace descriptions are
at most 1000 characters. Document titles are trimmed (1–200 characters); content
is nonblank plain text (1–100000 characters), preserved as submitted. JSON bodies
have a 16 KB limit; the `/workspaces` subtree permits 512 KB for documents.
Documents support only GET and POST: no editing,
deletion, file uploads, embeddings, retrieval, or RAG pipeline yet.

Common status codes: 400 invalid input, 401 missing/invalid/expired/revoked token,
403 disallowed browser origin, 404 inaccessible/missing resource, 409 duplicate
email, 413 body too large, 429 rate limited (`Retry-After`), 503 required dependency
unavailable. Credentials and tokens must be sent over HTTPS outside local use.
