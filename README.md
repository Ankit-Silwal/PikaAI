# PikaAI

Minimal Express + TypeScript backend in `apps/api`.

```text
apps/api/
  prisma/schema.prisma
  prisma.config.ts
  src/
    configs/
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
      health/
        health.routes.ts
        health.controller.ts
    utils/
      jwt.ts
      http-error.ts
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
2. Copy `.env.example` to `.env`, set PostgreSQL details and JWT secrets (see below).
3. Run `npm run db:up`, `npm run db:migrate`, then `npm run dev`.

`GET http://localhost:3001/health` returns `{ "status": "ok" }`.
Prisma checks PostgreSQL on startup and logs connection errors to the terminal.
The server still starts if PostgreSQL is unavailable; `/health` checks server liveness.

Prisma's client generates automatically for dev, build, and check.
Run `npm run check` for type checking, or `npm run build` then `npm start`.

## Authentication

Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env` to different random
secrets of at least 32 characters. Generate each with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Set `CORS_ORIGIN` to your frontend origin (default `http://localhost:3000`).
Run `npm run db:migrate` before starting the backend.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /auth/register` | JSON `{ "email": "you@example.com", "password": "your-password" }` | `201` with user, access token, and refresh cookie |
| `POST /auth/login` | Same JSON | `200` with user, access token, and refresh cookie |
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

Run `npm test` against your local PostgreSQL database for the auth integration
checks. Tests create uniquely named users and delete only those test users.
