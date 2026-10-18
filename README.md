# PikaAI

TypeScript + Express 5 backend in a Turborepo, with Prisma, local PostgreSQL, and Redis.

## Start locally

Install Node.js 24 and Docker Desktop with Linux containers, then run:

```powershell
npm install
npm run setup
npm run infra:up
npm run db:migrate
npm run dev
```

`npm run setup` creates or updates the root `.env`, generates the JWT signing secret and Redis password, and preserves existing settings and populated secrets. Do not commit `.env`. Restart the dev command after changing it.

The backend is at `http://localhost:3001`, PostgreSQL at `localhost:55432`, and Redis at `localhost:56379`. All Docker ports bind to localhost. The backend verifies both dependencies before listening. For a compiled local run, use `npm run build` followed by `npm start`.

## Run everything in Docker

```powershell
npm install
npm run setup
npm run docker:up
```

Compose starts PostgreSQL and Redis, applies Prisma migrations in a one-shot `migrate` container, then starts the compiled backend as a non-root user. The backend runtime image excludes development dependencies. Use `npm run docker:logs` for logs and `npm run docker:down` to stop the stack. PostgreSQL and Redis data survive in named volumes.

To switch from Docker to local hot reload:

```powershell
docker compose stop backend
npm run dev
```

Do not run both backends on port 3001. `npm run db:up` starts PostgreSQL and Redis; `npm run db:down` stops only PostgreSQL. Changing PostgreSQL credentials in `.env` does not change credentials in an existing database volume. These PostgreSQL credentials and the exposed ports are for local development.

## API

The full contract, limits, and examples are in [docs/api.md](docs/api.md) and [docs/openapi.json](docs/openapi.json). Import the OpenAPI file into Postman.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Register with `{name,email,password}` |
| POST | `/api/auth/login` | Log in with `{email,password}` |
| GET | `/api/auth/me` | Current user |
| GET | `/api/auth/activity` | Latest observed IP, user agent, and activity timestamps |
| POST | `/api/auth/logout` | Revoke the presented access token |
| GET / POST | `/api/organizations` | List / create organizations |
| GET | `/api/organizations/:organizationId` | Organization details |
| GET / POST | `/api/organizations/:organizationId/workspaces` | List / create workspaces |
| GET | `/api/workspaces/:workspaceId` | Workspace details |
| GET / POST | `/api/workspaces/:workspaceId/documents` | List metadata / store a text document |
| GET | `/api/documents/:documentId` | Document including content |

Register/login return `data.accessToken`; send it as `Authorization: Bearer <token>` for protected routes. Access tokens expire after 15 minutes by default; log in again after expiry. Organization creation also creates its owner membership atomically. Members can create workspaces and documents. Every resource query checks current membership; inaccessible resources return 404. Membership management is deferred.

Documents accept `{title,content}` as JSON and persist plain text. GET and POST are the only document methods. Upload parsing, updates, deletes, embeddings, retrieval, and RAG processing are deferred.

Collection endpoints accept `?limit=20&offset=0` and return `pagination`. Document lists omit content; the individual document endpoint includes it.

Public setup routes remain available: `GET /api/test`, `POST /api/test/echo` with `{message}`, and `GET /api/test/db`. `/health/live` checks the process; `/health/ready` returns 200 only when PostgreSQL and Redis are reachable, otherwise 503.

## Authentication and Redis

Passwords use salted, asynchronous scrypt with constant-time verification. JWT verification requires the expected algorithm, issuer, audience, expiry, user ID, and token ID. The database is the source of truth for users and memberships.

Any backend instance can verify a token. Redis holds a revocation denylist, a global token epoch, shared rate limits, and each user's latest activity. There is no per-login session object. Authentication depends on Redis and returns 503 if it cannot check state; it never skips revocation checks. Removing the epoch invalidates existing tokens. The epoch and denylist have to be preserved together: use the AOF volume and do not selectively flush revocation keys. An unclean Redis crash can still lose recent writes; token lifetime bounds this risk.

Activity records contain the latest observed IP, user agent, last-seen time, and last-login time; they expire after 24 hours of inactivity by default. They are not a full audit history or proof of device identity. IP changes do not invalidate tokens. Forwarded headers are ignored unless `TRUST_PROXY_CIDRS` names explicit trusted proxy IPs or CIDRs. Do not trust arbitrary client IP headers.

Registration checks email syntax but does not verify email ownership. Password reset, MFA, refresh tokens, invitations, and membership management are not included. Use HTTPS and suitable database roles/networking for hosted use.

## Structure

```text
apps/backend/
  prisma/
    schema.prisma              # Users, organizations, memberships, workspaces, documents
    migrations/                # Versioned Prisma migrations
  prisma.config.ts
  scripts/setup-env.ts
  src/
    app.ts                     # App factory and middleware
    server.ts                  # Startup and graceful shutdown
    config/                    # Environment, Prisma, Redis
    controllers/               # Auth, resources, and test handlers
    services/                  # Auth, JWT, passwords, Redis state, resource queries
    middleware/                # Authentication, errors, request logging
    validators/                # Strict request schemas
    routes/                    # API routing and health probes
    types/                     # Auth and Express types
    generated/prisma/          # Generated locally; ignored in Git
  test/
    app.test.ts
    security.test.ts
    integration/               # Real PostgreSQL + Redis tests
  Dockerfile
packages/                      # Future shared workspace packages
compose.yaml
turbo.json
```

Use Prisma for application queries. After editing the schema, create and review a migration with `npm exec --workspace=@pikaai/backend -- prisma migrate dev --name your_change`. Apply committed migrations with `npm run db:migrate`. `npm run db:generate` regenerates Prisma Client, and `npm run db:studio` opens Prisma Studio. Turborepo generates the client before dev, check, build, and unit tests. Relative `.js` imports in TypeScript target the compiled ES modules.

## Middleware and limits

- CORS allows exact origins from `CORS_ORIGINS` (defaults: localhost ports 3000 and 5173). Cookie credentials are disabled; authentication uses a Bearer header.
- Helmet provides security headers. Requests get a generated `X-Request-Id`; JSON request logs omit bodies and authorization headers. Authenticated responses use `Cache-Control: no-store`.
- General API limits default to 100 requests/minute/IP. Registration and login share an additional limit of 10 attempts/15 minutes/IP. Both use Redis in the running backend; health probes are exempt. Rate limit failures include `Retry-After`.
- JSON bodies normally have a 16 KB limit. The `/api/workspaces` subtree permits 512 KB for document creation; document content is capped at 100000 characters. All request schemas reject unexpected properties.
- `SIGINT` and `SIGTERM` drain HTTP requests, then close Prisma and Redis. Readiness includes both dependencies.

## Verification

```powershell
npm run check
npm test
npm run build
npm run infra:up
npm run db:migrate
npm run test:integration
```

Unit tests cover middleware, validation, hashing, and JWT failures. Integration tests exercise the actual Express app with Prisma/PostgreSQL and Redis: registration/login/logout, activity and IP handling, shared rate limits, revocation across instances, dependency failure, tenant isolation, membership changes, and document persistence. Each run uses unique users and Redis key prefixes and removes only its own fixtures.

Implementation references: [Prisma 7 client generation](https://docs.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client), [OWASP scrypt settings](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt), [Express error handling](https://expressjs.com/en/5x/guide/error-handling/), and [Redis-backed rate limiting](https://github.com/express-rate-limit/rate-limit-redis).
