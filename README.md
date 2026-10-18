# PikaAI

Minimal Express + TypeScript backend in `apps/api`.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and set your PostgreSQL connection details.
3. Run `npm run db:up`, then `npm run dev`.

`GET http://localhost:3001/health` returns `{ "status": "ok" }`.
Prisma checks PostgreSQL on startup and logs connection errors to the terminal.
The server still starts if PostgreSQL is unavailable; `/health` checks server liveness.

Prisma has no models yet. Its client generates automatically for dev, build, and check.
Run `npm run check` for type checking, or `npm run build` then `npm start`.
