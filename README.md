# PikaAI

Minimal Express + TypeScript backend in `apps/api`.

```text
apps/api/
  prisma/schema.prisma
  prisma.config.ts
  src/
    configs/db.ts
    middleware/
    modules/
      health/
        health.routes.ts
        health.controller.ts
    utils/
    app.ts
    server.ts
```

Each feature will live in `src/modules/<feature>/` with its own routes, controller,
and service as needed. Routes map URLs, controllers handle HTTP input/output, and
services handle business logic and database operations. The health check has no
business logic, so it only needs routes and a controller. Shared configuration
belongs in `configs`; shared helpers belong in `utils`; shared Express middleware
belongs in `middleware`.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and set your PostgreSQL connection details.
3. Run `npm run db:up`, then `npm run dev`.

`GET http://localhost:3001/health` returns `{ "status": "ok" }`.
Prisma checks PostgreSQL on startup and logs connection errors to the terminal.
The server still starts if PostgreSQL is unavailable; `/health` checks server liveness.

Prisma has no models yet. Its client generates automatically for dev, build, and check.
Run `npm run check` for type checking, or `npm run build` then `npm start`.
