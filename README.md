# Hotel Booking REST API — ITCS258 Group 13

REST API for a hotel booking system (NestJS · MySQL · Redis · Docker).
Spec: FR-1…FR-38, NFR-1…NFR-20 (ITCS258 Hotel Booking Specification).

> **Status:** config, health check, Docker, Prisma schema + seed, auth
> (sign-up/login/logout/profile), RBAC, rooms, bookings, search, notifications,
> Redis caching, rate limiting and request logging are in. Swagger and the
> public deployment are next.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js 24 LTS · NestJS 11 · TypeScript |
| Database | MySQL 8.4 |
| ORM | Prisma 6 |
| Auth | JWT (`@nestjs/jwt`) · bcrypt password hashes |
| Cache / rate limit / logout store | Redis 7 (`ioredis`, `@nestjs/throttler`) |
| Tests | Jest + Supertest |
| Container | Docker (multi-stage) + Docker Compose |

## Project layout

```
prisma/
  schema.prisma           # User, Room, RoomImage, Booking, NotificationEvent
  migrations/
src/
  main.ts                 # bootstrap: port, CORS, logger, graceful shutdown
  app.setup.ts            # global pipes/filters/security headers (shared with e2e tests)
  app.module.ts           # root module
  config/                 # fail-fast env validation (no secret values in errors)
  prisma/                 # PrismaService (global)
  redis/                  # shared Redis connection (global)
  auth/                   # register/login/logout, JWT guards, @Roles, password hashing,
                          # token revocation
  users/                  # GET/PATCH /users/me (own profile)
  cache/                  # Redis response cache: @CachedResponse / @InvalidatesCache
  rate-limit/             # per-IP limits: @RateLimit tiers, Redis counter storage
  rooms/ bookings/ notifications/
  health/                 # GET /health, GET /health/live
  common/                 # pagination, date ranges, Prisma error filter, request logger
  database/seed.ts        # admin + demo user + sample rooms
test/                     # e2e suites (real MySQL)
docker-entrypoint.sh      # migrate -> (seed) -> start
```

Each feature folder follows the same layers: **controller** (HTTP, guards,
status codes) -> **service** (business rules) -> **Prisma** (data), with DTOs
for input validation and mappers for output.

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
| `TRUST_PROXY` | no | `0` | number of reverse proxies in front of the API (so rate limiting sees the real client IP) |
| `JWT_SECRET` | **yes** | | at least 32 characters |
| `JWT_EXPIRES_IN` | no | `1h` | access-token lifetime: `900`, `15m`, `1h`, `7d` |
| `BCRYPT_ROUNDS` | no | `12` | password hash cost (4-15) |
| `UPLOAD_DIR` | no | `uploads` | where room images are stored |
| `CACHE_TTL_SECONDS` | no | `60` | lifetime of cached room responses; `0` = off |
| `THROTTLE_TTL_MS` | no | `60000` | rate-limit window |
| `THROTTLE_LIMIT` | no | `120` | requests per window, any route |
| `THROTTLE_AUTH_LIMIT` | no | `10` | register / login / profile update |
| `THROTTLE_BOOKING_LIMIT` | no | `20` | booking creation |
| `RUN_MIGRATIONS` | no | `true` | container start: apply pending migrations |
| `RUN_SEED` | no | `false` | container start: create seed accounts + sample rooms |
| `SEED_ADMIN_EMAIL` `SEED_ADMIN_PASSWORD` `SEED_USER_EMAIL` `SEED_USER_PASSWORD` | prod seed | dev defaults | seed accounts, see [Seed data](#seed-data--test-accounts) |
| `MYSQL_*` | compose | | used by docker-compose to create the DB |

The app refuses to start if a required variable is missing or invalid.

## Running

### With Docker (everything)

```bash
cp .env.example .env         # then set JWT_SECRET and the MYSQL_* passwords
docker compose up -d --build
curl http://localhost:3000/health
docker compose logs -f api
docker compose down          # add -v to also wipe DB/Redis data
```

The API container applies pending database migrations on every start
(`RUN_MIGRATIONS=true`). To also create the seed accounts and sample rooms,
start it once with `RUN_SEED=true` in `.env`, or run:

```bash
docker compose exec api node dist/database/seed.js
```

MySQL and Redis are published on `127.0.0.1` only, so they are reachable from
the host for development but never from the network.

### Without Docker for the API (deps still in Docker)

```bash
npm ci
docker compose up -d mysql redis
npm run prisma:deploy        # create the tables
npm run seed                 # optional: admin + demo user + sample rooms
npm run start:dev
```

### Build & run the production image only

```bash
docker build -t hotel-booking-api .
docker run --rm -p 3000:3000 --env-file .env hotel-booking-api
```

The image is multi-stage (dependencies -> build -> runtime): the runtime stage
holds only production `node_modules`, the compiled `dist/`, and the Prisma
schema/migrations, and runs as the unprivileged `node` user.

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

## API - authentication & profile

| Method & path | Who | Notes |
|---|---|---|
| `POST /auth/register` | public | `{ name, email, password }` -> 201 with the user. Always creates a Regular User; sending `role` is rejected (400). Duplicate email -> 409 |
| `POST /auth/login` | public | `{ email, password }` -> 200 `{ accessToken, tokenType: "Bearer", expiresIn, user }`. Wrong email **or** password -> the same 401 |
| `POST /auth/logout` | logged in | revokes the token in the `Authorization` header -> 200; that token then gets 401 |
| `GET /users/me` | logged in | own profile (FR-3) |
| `PATCH /users/me` | logged in | `{ name?, email?, currentPassword?, newPassword? }` (FR-4). Changing email or password requires `currentPassword` and returns a fresh `token`; a password change signs out every other session |

Passwords: 8-72 characters with at least one letter and one number.
Emails are case-insensitive (stored in lower case).

```bash
# sign up, log in, call a protected route, log out
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"Secret123"}'
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Secret123"}' | jq -r .data.accessToken)
curl http://localhost:3000/users/me -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer $TOKEN"
```

## Security: authentication & RBAC

- **Passwords** (NFR-1) are hashed with bcrypt (per-password salt, cost
  `BCRYPT_ROUNDS`, default 12). The hash never leaves the database: every user
  response goes through one allow-list mapper (`users/user.mapper.ts`).
- **Tokens**: JWT signed with `JWT_SECRET` (HS256), carrying `sub`, `email`,
  `role` and a unique `jti`, valid for `JWT_EXPIRES_IN`. Send it as
  `Authorization: Bearer <token>`.
- **Logout** (FR-2): the token's `jti` is stored in Redis until the token would
  have expired anyway, and the JWT guards reject it from then on. A password
  change sets a per-user "revoked before" marker the same way. Because the
  markers live in Redis, every API instance honours them.
- **Roles** (FR-5): `USER` and `ADMIN`. Sign-up can only create `USER`; admins
  are created by the seed script. Enforcement is at the API layer with guards:

  | Guard / decorator | Effect |
  |---|---|
  | `JwtAuthGuard` | 401 unless a valid, non-revoked token is sent (NFR-2) |
  | `RolesGuard` + `@Roles(Role.ADMIN)` | 403 unless the user has the role (NFR-3) |
  | `OptionalJwtAuthGuard` | public routes that show more to admins |
  | ownership checks in services | a user reads/cancels only their own bookings and notifications (FR-6); `/users/me` takes the id from the token, so there is no way to address another user |

- **Enumeration & brute force**: login answers a wrong password and an unknown
  email identically (same message, same hashing time), and auth routes are
  rate limited (below).
- **Headers & input**: `helmet` security headers; a global `ValidationPipe`
  with `whitelist` + `forbidNonWhitelisted` rejects unknown fields.
- **Logs** never contain passwords, hashes, tokens, request bodies or query
  strings (see [Logging](#logging--monitoring)).

## Performance, caching & rate limiting

### Where and why caching is used

| Endpoint | Cached | Dropped when |
|---|---|---|
| `GET /rooms` (list + filters) | yes | any room or room image is created / updated / deleted |
| `GET /rooms/:id` | yes | same |
| `GET /rooms/search` | yes | same, **or** any booking is created / cancelled / changes status |
| bookings, notifications, profile | no | per-user data that must always be current |

Room data is read by every visitor (including anonymous ones) and changes only
when an admin edits a room, so it is the classic read-heavy / write-rare case:
caching it removes most MySQL queries from the busiest endpoints (NFR-5/6).
The availability search is the most expensive query (rooms joined against
overlapping bookings), so it is cached too.

How it works (`src/cache/`):

- Responses are stored in **Redis** as JSON for `CACHE_TTL_SECONDS` (60 s),
  keyed by path + sorted query string. Redis rather than process memory, so all
  API instances share one cache (NFR-11).
- **Freshness**: each cache key embeds a version number per data group
  (`rooms`, `bookings`). A successful write bumps the version with one atomic
  `INCR`, which makes every older entry unreachable at once - no key scanning,
  and it is awaited before the write's response is sent, so a client that
  changes a room and immediately re-reads it never sees the old value. The TTL
  is only a safety net.
- **Correctness**: only successful responses are cached. Admin requests bypass
  the cache entirely (admins can see deactivated rooms; that view must never be
  served to the public). A search result is dropped as soon as a booking changes
  availability - and even if a stale one slipped through, `POST /bookings` re-checks availability inside a transaction.
- Every cacheable response carries `X-Cache: HIT | MISS | BYPASS`.
- If Redis is down, requests are simply served from MySQL (NFR-9).

```bash
curl -si "http://localhost:3000/rooms?capacity=2" | grep -i x-cache   # MISS
curl -si "http://localhost:3000/rooms?capacity=2" | grep -i x-cache   # HIT
```

### Rate limiting

| Tier | Routes | Default limit (per client IP, per route, per minute) |
|---|---|---|
| `auth` | `POST /auth/register`, `POST /auth/login`, `PATCH /users/me` | `THROTTLE_AUTH_LIMIT` = 10 |
| `booking` | `POST /bookings` | `THROTTLE_BOOKING_LIMIT` = 20 |
| `default` | everything else | `THROTTLE_LIMIT` = 120 |
| none | `GET /health`, `GET /health/live` | monitoring is never limited |

Why: the auth routes are where passwords are guessed and fake accounts are
mass-created, and each attempt costs a deliberately slow bcrypt hash; booking
creation takes a row lock and a transaction per call. Capping them keeps one
abusive client from degrading the API for everyone (NFR-7), while the default
tier stops scraping floods.

How it works (`src/rate-limit/`): a fixed-window counter per client IP and
route, incremented atomically by a small Lua script in **Redis**, so limits
hold across several API instances. Over the limit -> `429 Too Many Requests`
with a `Retry-After` header; every response carries
`X-RateLimit-Limit / -Remaining / -Reset`. If Redis is unreachable the limiter
keeps working with in-process counters instead of switching off. Behind a
reverse proxy set `TRUST_PROXY` so the real client IP is used.

### Other performance decisions

- Lists are paginated (`page`, `limit`), with indexes on the filtered columns
  (`Room(isActive, capacity)`, `Booking(roomId, status, checkIn, checkOut)`,
  `Booking(userId, createdAt)`).
- Availability is computed in a single SQL query, not per room.
- The API is stateless (JWT + Redis), so more instances can be added behind a
  load balancer without sticky sessions (NFR-10/11).

## Logging & monitoring

- **One line per request** (`HTTP` logger): method, path, status, duration,
  client IP, user id and request id - e.g.
  `POST /bookings 201 38ms ip=203.0.113.9 user=42 req=5f0c...`.
  4xx are logged as warnings, 5xx as errors.
- **Business events**: registration, login success/failure, logout, profile
  changes, booking actions, Redis/database outages.
- **Never logged** (NFR-4): passwords, password hashes, tokens, request bodies,
  query strings, connection strings.
- Every response has an `X-Request-Id` header (a client-supplied one is
  reused); quote it to find the matching log line.
- With `NODE_ENV=production` logs are **one JSON object per line** on stdout,
  ready for `docker logs`, CloudWatch, Loki, etc. (NFR-17).
- Monitoring: point an uptime checker at `GET /health` (200 = app + MySQL +
  Redis up, 503 otherwise).

## Seed data & test accounts

```bash
npm run seed                                   # development
docker compose exec api node dist/database/seed.js   # inside the container
```

Creates one Admin, one Regular User and five sample rooms. It is idempotent:
existing accounts and rooms are left untouched (set `SEED_RESET_PASSWORDS=true`
to reset the two passwords).

| Role | Email (development default) | Password (development default) |
|---|---|---|
| Admin | `admin@hotel.test` | `Admin12345` |
| Regular User | `user@hotel.test` | `User12345` |

These defaults exist only for local development. With `NODE_ENV=production`
the seed refuses to run unless `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`,
`SEED_USER_EMAIL` and `SEED_USER_PASSWORD` are set, so a public server never
gets a publicly known login.

## Deployment

> **Not deployed yet** - the public URL and the deployed test accounts will be
> added here once the server is available. The steps below are the intended
> procedure for a Linux VM (e.g. AWS EC2 / the course VM) with Docker.

Architecture: one VM running Docker Compose.

```
Internet -> :3000 api (NestJS, node user) -> mysql:3306  (volume mysql-data)
                                          -> redis:6379  (volume redis-data)
                                          -> /app/uploads (volume uploads)
```

1. Install Docker Engine + the Compose plugin on the VM and open the API port
   (3000, or 80/443 if a reverse proxy is put in front) in the firewall /
   security group. Do **not** open 3306 or 6379.
2. Get the code and create the configuration:
   ```bash
   git clone <repo-url> hotel-booking && cd hotel-booking
   cp .env.example .env
   ```
   In `.env` set `NODE_ENV=production`, a random `JWT_SECRET`
   (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`),
   strong `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD`, `CORS_ORIGIN`, the four
   `SEED_*` credentials and `RUN_SEED=true` for the first start
   (`TRUST_PROXY=1` if nginx or a load balancer sits in front).
3. Build and start: `docker compose up -d --build`. On start the API container
   applies the database migrations, seeds the accounts, then serves requests.
4. Verify from outside: `curl http://<server>:3000/health` must return
   `"status":"ok"`.
5. Operate: `docker compose logs -f api` (JSON logs), `docker compose ps`
   (container health). Update with `git pull && docker compose up -d --build`;
   migrations are applied automatically and data lives in named volumes.

A managed database / Redis (NFR-20) works the same way: point `DATABASE_URL`
and `REDIS_URL` (`rediss://` for TLS) at them and start only the `api`
service.

## Tests

```bash
npm test          # unit
npm run test:e2e  # e2e against a real MySQL database (see below)
npm run test:cov
```

The e2e suites need a migrated **test** database; they are skipped if
`DATABASE_URL` is unset and clean up every row they create:

```bash
export DATABASE_URL=mysql://user:pass@localhost:3306/hotel_booking_test
npx prisma migrate deploy
npm run test:e2e
```

| Suite | Covers |
|---|---|
| `test/health.e2e-spec.ts` | liveness / readiness, no credentials in responses (no DB needed) |
| `test/auth.e2e-spec.ts` | sign-up, login, logout (token revocation), profile, RBAC with real logins, cache HIT/MISS + invalidation, 429 rate limit |
| `test/rooms-bookings.e2e-spec.ts` | rooms, bookings, double-booking, search, notifications |

Redis is optional for the tests: with `REDIS_URL` pointing at a running Redis
the cache, logout and Redis rate-limit paths are exercised; without it the
same suites pass on the fallbacks.

## Notes for teammates

- **Swagger (Earn)**: `helmet` is configured with CSP off so Swagger UI works.
  Auth is a Bearer JWT (`addBearerAuth()`); the DTOs are in `src/auth/dto/` and
  `src/users/dto/`. Document the `429` response and the `X-Cache` /
  `X-RateLimit-*` headers.
- **New cached GET or mutation?** Add `@CachedResponse('rooms')` to public
  room reads and `@InvalidatesCache('rooms' | 'bookings')` to anything that
  changes them (see `rooms.controller.ts`, `bookings.controller.ts`).
- **New sensitive route?** Add `@RateLimit('auth' | 'booking')`.
- **Tests that send many requests** should raise `THROTTLE_*` in
  `process.env` before importing `AppModule` (see the e2e suites).
- Health: the MySQL probe can be swapped for terminus'
  `PrismaHealthIndicator.pingCheck('database', prisma)`.

## Limitations / known issues

- Not deployed yet; the Docker image has not been built on this machine
  (no Docker available), only the compiled app was run against MySQL + Redis.
- Logout and "sign out everywhere" depend on Redis. If Redis is down, logout
  answers 503, and already-revoked tokens are accepted again until they expire
  (at most `JWT_EXPIRES_IN`) - chosen so a cache outage cannot lock everyone
  out of the API.
- Rate limits are per IP: users behind one NAT share a budget.
- Access tokens only (no refresh tokens): users log in again after
  `JWT_EXPIRES_IN`.
- Uploaded images are stored on a local volume, so running several API
  instances needs shared storage (or object storage) for `/uploads`.
