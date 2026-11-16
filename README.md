# Hotel Booking REST API — ITCS258 Group 13

REST API for a hotel booking system (NestJS · MySQL · Redis · Docker).
Spec: FR-1…FR-38, NFR-1…NFR-20 (ITCS258 Hotel Booking Specification).

> **Status:** config, health check, Docker, Prisma schema, rooms, bookings,
> search and notifications are in. Auth endpoints (sign-up/login/logout/profile),
> caching, rate limiting and Swagger are next.

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
  swagger/                # OpenAPI document, /docs UI, shared Swagger decorators
test/
  health.e2e-spec.ts
  setup/                  # test env (test-DB guard) + global setup (schema reset)
  utils/                  # createTestApp, DB cleanup, fixtures
  integration/            # *.int-spec.ts — per module, real test DB
  e2e/                    # *.e2e-spec.ts — full user journeys
docs/
  API-TESTING.md          # API Testing document: strategy, test cases, results
  openapi.json            # exported OpenAPI spec (npm run openapi)
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

## Database (Prisma)

Schema: [prisma/schema.prisma](prisma/schema.prisma) — `User`, `Room`, `RoomImage`,
`Booking`, `NotificationEvent`. Migrations live in `prisma/migrations/`.

```bash
npm run prisma:migrate   # dev: create + apply a migration after editing the schema
npm run prisma:deploy    # prod/CI: apply pending migrations
npm run prisma:generate  # regenerate the client (also runs in `npm run build`)
```

## API — rooms, bookings, search, notifications

All bodies are JSON. Mutations answer `{ "message", "data" }` (FR-34), detail
reads `{ "data" }`, lists `{ "data": [...], "meta": { page, limit, total, totalPages } }`.
Errors use Nest's shape `{ "statusCode", "message", "error" }` with a readable
`message` (FR-32/33). Auth = `Authorization: Bearer <JWT>`.

| Method & path | Who | Notes |
|---|---|---|
| `GET /rooms` | public | `page, limit, capacity` (min guests), `minPrice, maxPrice`; admin may add `includeInactive=true` |
| `GET /rooms/search` | public | **required** `checkIn, checkOut` + same filters; only rooms free for the whole stay (FR-27–29) |
| `GET /rooms/:id` | public | includes `images[]` (FR-16); deactivated rooms → 404 except for admin |
| `POST /rooms` | admin | `{ name, description?, capacity (1–20), pricePerNight, isActive? }` → 201 |
| `PATCH /rooms/:id` | admin | any subset; `{ "isActive": false }` deactivates (FR-10) |
| `DELETE /rooms/:id` | admin | only if the room was never booked, else 409 → deactivate instead |
| `POST /rooms/:id/images` | admin | `multipart/form-data`, field `image`, JPEG/PNG/WebP ≤ 5 MB, max 10/room; served at `/uploads/rooms/<uuid>.<ext>` |
| `DELETE /rooms/:id/images/:imageId` | admin | removes metadata + file |
| `POST /bookings` | user | `{ roomId, checkIn, checkOut, guests? }` → 201, status `PENDING`, `totalPrice = nights × pricePerNight` |
| `GET /bookings` | user / admin | user: own only · admin: all, filters `status, roomId, userId` |
| `GET /bookings/:id` | owner / admin | other users → 403 |
| `PATCH /bookings/:id/cancel` | owner / admin | owner may cancel `PENDING`/`APPROVED`; admin any non-cancelled |
| `PATCH /bookings/:id/status` | admin | `{ "status": "APPROVED" }` (or `PAID`, `CANCELLED`) |
| `GET /notifications` | user | own events, `unread=true`; admin may add `all=true`; `meta.unreadCount` |
| `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` | user | |

**Booking rules**

- Dates are ISO 8601 (`2026-12-01` or `2026-12-01T14:00:00+07:00`). `checkIn < checkOut`,
  `checkIn` not in the past, stay ≤ 30 nights → otherwise **400** (FR-19).
- Stays are half-open `[checkIn, checkOut)`: a stay may start the moment the previous
  one ends. Any overlap with a `PENDING`/`APPROVED`/`PAID` booking → **409** (FR-20).
  `CANCELLED` bookings free the slot.
- Concurrency-safe: creation locks the room row (`SELECT … FOR UPDATE`) inside the
  transaction, so parallel requests for the same slot yield exactly one 201
  (covered by an e2e test with 8 parallel requests).
- Status flow (FR-21/26): `PENDING → APPROVED → PAID`, and any of them → `CANCELLED`
  (final). Illegal transitions → **409** with the allowed targets in the message.
- Every create / cancel / status change writes a `NotificationEvent` for the booking
  owner in the **same transaction** (FR-30/31): `BOOKING_CREATED`,
  `BOOKING_CANCELLED`, `BOOKING_STATUS_CHANGED`.

```bash
# search, then book (TOKEN from login)
curl "http://localhost:3000/rooms/search?checkIn=2026-12-01&checkOut=2026-12-03&capacity=2"
curl -X POST http://localhost:3000/bookings -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roomId":1,"checkIn":"2026-12-01","checkOut":"2026-12-03","guests":2}'
# upload a room image (admin)
curl -X POST http://localhost:3000/rooms/1/images -H "Authorization: Bearer $ADMIN_TOKEN" -F image=@room.jpg
```

## API documentation (Swagger / OpenAPI) — FR-37

| | URL |
|---|---|
| Swagger UI | `http://localhost:3000/docs` · deployed: `<DEPLOYED_URL>/docs` |
| OpenAPI JSON | `http://localhost:3000/docs-json` |
| Spec file | [`docs/openapi.json`](docs/openapi.json) — regenerate with `npm run openapi` |

**Authenticating in Swagger UI**

1. `POST /auth/register`, or log in with a seeded test account (user / admin).
2. `POST /auth/login` → copy the access token from the response.
3. Click **Authorize** → paste the token (without `Bearer `) → **Authorize**.
4. Endpoints with a lock icon now send `Authorization: Bearer <token>`.

`npm run openapi` writes `docs/openapi.json` and lists every endpoint that is
missing a summary, tag, success response, `401` (auth required) or `400`
(has a body). `npm run openapi:check` does the same but fails on any error.

### Documenting an endpoint (for teammates)

Shared helpers are in `src/swagger/`:

```ts
@ApiTags(ApiTag.Bookings)
@Controller('bookings')
export class BookingsController {
  @Post()
  @ApiOperation({ summary: 'Create a booking' })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiAuth()                                   // lock icon + 401
  @ApiValidationError()                        // 400
  @ApiNotFound('Room')                         // 404
  @ApiConflict('Room already booked for this time range') // 409
  @ApiRateLimited()                            // 429
  create(@Body() dto: CreateBookingDto) { ... }
}
```

`@ApiAdminOnly()` = 401 + 403 for Admin routes, `@ApiOwnerOnly()` for
"own booking only" routes, `@ApiImageUpload()` for the room image upload.
Give every DTO field an `@ApiProperty()` (with an `example`) so request and
response schemas show in Swagger. All errors use `ErrorResponseDto`.

## Tests

Full strategy, test cases mapped to each FR, and results:
**[docs/API-TESTING.md](docs/API-TESTING.md)**.

| Level | Command | Needs |
|---|---|---|
| Unit — business logic, mocked dependencies | `npm test` · `npm run test:cov` | nothing |
| Integration — each module's endpoints, real test DB | `npm run test:integration` | test DB |
| E2E — full user/admin journeys, checks responses + DB state | `npm run test:e2e` | test DB |
| **Everything** (starts the test DB first) | `npm run test:all` | Docker |

```bash
npm run test:all       # starts test MySQL :3307 + Redis :6380, runs all 3 levels
npm run test:db:down   # stop the test containers and wipe their data
```

- Tests use a separate database, `hotel_booking_test`, in
  `docker-compose.test.yml` (RAM only). They **refuse to run** against any
  database whose name does not end in `_test`, so dev/production data is safe.
- The schema is rebuilt once per run, and every table is emptied before each
  test (`test/utils/db-cleanup.ts`), so tests never depend on each other.
- CI (`.github/workflows/test.yml`) runs all three levels against real MySQL
  and Redis on every push and pull request.

## Notes for teammates

- **Auth contract** ([src/auth/](src/auth/)): guards + decorators exist; login must sign
  JWTs with payload `{ sub: userId, email, role }` (see `JwtPayload`). Add the
  sign-up/login/logout/profile controller + service to `AuthModule`. A logout
  blacklist check belongs in `JwtAuthGuard`.
- `JWT_SECRET` (≥ 32 chars) and `UPLOAD_DIR` are validated in `env.validation.ts`;
  cache / throttling keys are still reserved in `.env.example`.
- Docker: `npm run build` already runs `prisma generate`; the runtime image still
  needs `prisma migrate deploy` on release (the `prisma` CLI is a devDependency and is
  pruned, so run it from the build stage or a one-off job). Not yet verified in Docker.
- Caching: invalidate the room list/detail cache in `RoomsService`
  create/update/remove/addImage/removeImage, and on booking create/cancel for
  `/rooms/search` results.
- Health: the MySQL probe can be swapped for terminus'
  `PrismaHealthIndicator.pingCheck('database', prisma)`.
