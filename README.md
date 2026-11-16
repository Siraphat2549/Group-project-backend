# Hotel Booking REST API — ITCS258 Group 13

REST API for a hotel booking system (NestJS · MySQL · Redis · Docker).
Spec: FR-1…FR-38, NFR-1…NFR-20 (ITCS258 Hotel Booking Specification).

> **Status:** scaffold only — config, health check, Docker. Feature modules
> (auth, rooms, bookings, search, notifications, Swagger) are added next.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js 24 LTS · NestJS 11 · TypeScript |
| Database | MySQL 8.4 |
| Cache / rate limit store | Redis 7 |
| Tests | Jest + Supertest |
| Container | Docker (multi-stage) + Docker Compose |

## Project layout

```
src/
  main.ts                 # bootstrap: port, CORS, graceful shutdown
  app.module.ts           # root module (register feature modules here)
  config/
    env.validation.ts     # fail-fast env validation (no secret values in errors)
  health/
    health.controller.ts  # GET /health, GET /health/live
    dependency.health.ts  # MySQL + Redis terminus indicators
    probes/               # dependency-free MySQL handshake / Redis PING probes
test/
  health.e2e-spec.ts
```

## Configuration

All configuration comes from environment variables (NFR-19). Copy the template
and edit it — **never commit `.env`**:

```bash
cp .env.example .env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` / `production` / `test` |
| `PORT` | no | `3000` | |
| `DATABASE_URL` | **yes** | | `mysql://user:pass@host:3306/db` |
| `REDIS_URL` | **yes** | | `redis://[:pass@]host:6379` or `rediss://` (TLS) |
| `HEALTH_CHECK_TIMEOUT_MS` | no | `3000` | per-dependency timeout |
| `CORS_ORIGIN` | no | allow all | comma-separated origins |
| `MYSQL_*` | compose | | used by docker-compose to create the DB |

The app refuses to start if a required variable is missing or invalid.

## Running

### With Docker (everything)

```bash
cp .env.example .env
docker compose up -d --build
curl http://localhost:3000/health
docker compose logs -f api
docker compose down          # add -v to also wipe DB/Redis data
```

### Without Docker for the API (deps still in Docker)

```bash
npm ci
docker compose up -d mysql redis
npm run start:dev
```

### Build & run the production image only

```bash
docker build -t hotel-booking-api .
docker run --rm -p 3000:3000 --env-file .env hotel-booking-api
```

## Health check (FR-36, NFR-17)

| Endpoint | Purpose | Checks | Status codes |
|---|---|---|---|
| `GET /health` | readiness / **monitoring** (UptimeRobot etc.) | app, MySQL, Redis | `200` all up · `503` any down |
| `GET /health/live` | liveness (Docker `HEALTHCHECK`) | process only | `200` |

Liveness deliberately ignores dependencies so a short DB outage doesn't make
Docker restart the API (NFR-9); point external monitoring at `/health`.

```json
// GET /health -> 200
{
  "status": "ok",
  "info": {
    "app": { "status": "up", "uptimeSeconds": 42 },
    "database": { "status": "up", "serverVersion": "8.4.3" },
    "redis": { "status": "up" }
  },
  "error": {},
  "details": { "...": "same as info" }
}
```

On failure the response is `503` with the failing dependency under `error`
(e.g. `{ "status": "down", "message": "ECONNREFUSED" }`). Connection strings
and credentials are never included in responses or logs.

## Tests

```bash
npm test          # unit
npm run test:e2e  # e2e (no DB required for the health suite)
npm run test:cov
```

## Notes for teammates

- Once Prisma is added, swap the MySQL probe for terminus'
  `PrismaHealthIndicator.pingCheck('database', prisma)` and add
  `npx prisma generate` to the Dockerfile build stage.
- Env keys for JWT / cache / throttling are already reserved in `.env.example`;
  add them to `src/config/env.validation.ts` when the modules use them.
