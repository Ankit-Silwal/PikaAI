# PikaAI

Simple Node.js 24 + Express 5 backend in an npm-workspace Turborepo, with PostgreSQL 18 in Docker. The source and tests use TypeScript with strict checks and ES modules.

## Local development

Install Node.js 24 and Docker Desktop with Linux containers, then run from the repository root:

```powershell
Copy-Item .env.example .env
npm install
npm run setup
npm run db:up
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3001`. `tsx` watch mode restarts it when backend source files change. Restart the dev command after changing `.env`.

PostgreSQL is available at `localhost:55432` with the local credentials in `.env`. The backend checks its database connection before opening its HTTP port. If that fails, check Docker and the `PG*` settings.

## Run everything in Docker

```powershell
Copy-Item .env.example .env  # only if .env does not exist yet
npm run docker:up
```

This compiles TypeScript, builds the backend image, waits for PostgreSQL, and starts both services. The backend runs compiled JavaScript as a non-root user; the runtime image excludes development dependencies. Inside Docker it connects to `postgres:5432`; local Node connects to `localhost:55432`.

Use `npm run docker:logs` for logs and `npm run docker:down` to stop the stack. Database data survives container removal in the `pikaai_postgres_data` volume. `npm run db:down` stops only PostgreSQL. Avoid running the local backend and Docker backend on the same port; use `docker compose stop backend` before `npm run dev`.

Changing PostgreSQL credentials in `.env` does not update an already initialized database volume. Apply credential changes in PostgreSQL as well. The bundled credentials are for local development.

## Folder structure

```text
apps/backend/
  src/
    app.ts                     # Express app and middleware composition
    server.ts                  # Startup, listener, graceful shutdown
    config/
      env.ts                   # Loads and validates root .env
      database.ts              # PostgreSQL connection pool
    controllers/
      test.controller.ts       # Test endpoint handlers
    middleware/
      error-handler.ts         # JSON errors and 404 handling
      request-logger.ts        # Request IDs and structured request logs
    routes/
      index.ts                 # /api router
      health.routes.ts         # /health/live and /health/ready
      test.routes.ts           # /api/test routes
    types/                     # Database interface and Express request types
  test/app.test.ts
  tsconfig.json
  tsconfig.build.json
  Dockerfile
packages/                      # Future shared workspace packages
docs/openapi.json              # API contract
compose.yaml
turbo.json
```

Add each feature's router under `routes/`, handlers under `controllers/`, and mount the router in `routes/index.ts`. Add a service layer when there is business logic to share. Use parameterized PostgreSQL queries (`pool.query('SELECT ... WHERE id = $1', [id])`) for user input. No application tables or migration tooling are introduced yet.

Relative imports use `.js` extensions so the compiled ES modules run directly in Node; TypeScript resolves those imports to the `.ts` source files during development.

## Test endpoints

The authentication/resource contract is in [docs/api.md](docs/api.md). Prisma
owns the schema and migration history under `apps/backend/prisma`. Run
`npm run setup` after installing dependencies to initialize new local secrets;
populated secrets and existing settings are preserved. `npm run db:up` starts
PostgreSQL and Redis. Docker applies Prisma migrations in a one-shot service
before starting the backend.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/test` | Backend test message |
| POST | `/api/test/echo` | Validates and echoes `{ "message": "hello" }` |
| GET | `/api/test/db` | Queries PostgreSQL and returns its current timestamp |
| GET | `/health/live` | Process liveness; independent of PostgreSQL |
| GET | `/health/ready` | Returns 200 when PostgreSQL is reachable, otherwise 503 |

```powershell
Invoke-RestMethod http://localhost:3001/api/test
Invoke-RestMethod http://localhost:3001/api/test/db
Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/test/echo -ContentType 'application/json' -Body '{"message":"hello"}'
```

`docs/openapi.json` is the API contract and can be imported into Postman. Errors use `{ "success": false, "error": { "message": "...", "requestId": "..." } }`; readiness has its own probe response.

## Middleware and configuration

- CORS allows the exact origins in `CORS_ORIGINS`; defaults cover ports 3000 and 5173. Cookie credentials are disabled. CORS is browser access control, not authentication.
- Helmet sets security headers. JSON bodies are limited to 16 KB, and API requests are limited to `RATE_LIMIT_MAX` per minute per IP. Health probes are exempt.
- Rate limits are held in memory per process. Add a shared store if you later run multiple backend instances. Proxy trust is disabled; configure specific trusted proxies before deploying behind a reverse proxy.
- Request logs include a generated request ID, method, path, status, and duration. Responses expose `X-Request-Id`; internal database errors are not returned to clients.
- `SIGINT` and `SIGTERM` stop accepting requests, drain existing requests, and close the database pool.
- Docker publishes both ports to localhost. Configure secrets, database roles, HTTPS, and deployment networking for a hosted environment. These test routes are public and do not provide authentication.

## Checks

```powershell
npm run check
npm test
npm run build
npm start
```

Turborepo runs the workspace type checks, tests, and build. `npm start` runs the compiled backend in `apps/backend/dist`, so run `npm run build` first. The tests exercise route responses, JSON validation, security headers, CORS, rate limiting, and database-failure behavior using a fake database. For a live database check, start the stack and request `/health/ready` and `/api/test/db`.

Workspace and task conventions follow the [Turborepo documentation](https://turborepo.dev/docs/getting-started/add-to-existing-repository). Async error handling follows [Express 5](https://expressjs.com/en/5x/guide/error-handling/). PostgreSQL uses a [connection pool](https://node-postgres.com/features/pooling), and the Docker volume mounts at the [PostgreSQL 18 data root](https://hub.docker.com/_/postgres).
