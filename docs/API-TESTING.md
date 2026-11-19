# API Testing Document — Hotel Booking API (Group 13)

How the API is tested, the test cases for each requirement in the Hotel
Booking Specification, and the latest results.

- **Tools:** Jest 30 · ts-jest · Supertest · `@nestjs/testing`
- **Status legend:** ✅ passing · ❌ failing
- **Latest run:** 2026-11-19 — **309 tests, all passing** (164 unit · 82
  integration · 63 E2E), see [§5 Results](#5-results).

## 1. Test levels

| Level | Scope | Location | Database | Command |
|---|---|---|---|---|
| **Unit** | Business logic in isolation: date validation, double-booking (overlap + row lock), status transitions, role and ownership checks, password hashing, image rules, cache and rate-limit logic. Prisma, Redis and JWT are mocked | `src/**/*.spec.ts`, `test/utils/*.spec.ts` | none | `npm test` |
| **Integration** | Each module's endpoints (controllers) over HTTP with the real `AppModule`, the real global pipes/filters and a **real test database + Redis** | `test/integration/*.int-spec.ts` | MySQL `hotel_booking_test` | `npm run test:integration` |
| **E2E** | Realistic user/admin journeys across modules, the way a frontend would call the API (sign-up and login included); every journey asserts **the responses and the resulting database state** | `test/e2e/*.e2e-spec.ts`, `test/*.e2e-spec.ts` | MySQL `hotel_booking_test` | `npm run test:e2e` |

`npm run test:all` starts the test database and runs all three levels.
CI (`.github/workflows/test.yml`) runs lint, all three levels and the strict
OpenAPI check on every push and pull request, against real MySQL 8.4 and
Redis 7.

## 2. Test environment

### Test database

`docker-compose.test.yml` starts a **separate, disposable** MySQL 8.4 + Redis 7
on ports **3307 / 6380** (the dev stack uses 3306 / 6379). Data lives in RAM
and disappears when the containers stop.

| Variable | Test value | Override |
|---|---|---|
| `DATABASE_URL` | `mysql://hotel_test:hotel_test@127.0.0.1:3307/hotel_booking_test` | `TEST_DATABASE_URL` |
| `REDIS_URL` | `redis://127.0.0.1:6380` | `TEST_REDIS_URL` |
| `THROTTLE_*_LIMIT` | `1000`, so ordinary suites never hit 429 (`rate-limit.int-spec.ts` lowers them) | env |
| `BCRYPT_ROUNDS` | `4` — fast hashes; hashing itself is unit-tested | env |
| `UPLOAD_DIR` | `<os tmp>/hotel-booking-test-uploads` — test images never land in `uploads/` | env |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | test-only secret, `15m` | env |

**Safety guards**

1. During tests, `DATABASE_URL` and `REDIS_URL` are always replaced with the
   test values. They are never taken from `.env` or the shell
   (`test/setup/test-env.ts`).
2. Tests refuse to start unless the database name ends in `_test`.
3. The cleanup helper checks `SELECT DATABASE()` again before deleting rows.

### Lifecycle and cleanup

| When | What happens | Where |
|---|---|---|
| Once per run | Wait for the test MySQL, then rebuild the schema from scratch (`prisma migrate reset --force`). `TEST_DB_PREPARE_CMD` overrides it, e.g. `npx prisma migrate deploy` on a freshly started (empty) container | `test/setup/global-setup.ts` |
| Before each test | `resetTestState()` deletes all rows from every table (except `_prisma_migrations`) in one transaction with FK checks off, and flushes the test Redis (cache entries, rate-limit counters, revoked tokens) | `test/utils/db-cleanup.ts` |
| After each suite | `app.close()` releases DB/Redis connections | each spec |
| After the run | `npm run test:db:down` removes the containers and data | — |

Every test creates its own data and does not depend on order. Suites run
one at a time (`maxWorkers: 1`) because they share one database.

### Helpers

| Helper | Purpose |
|---|---|
| `createTestApp({ configure })` | Boots the real `AppModule` with the same global setup as `main.ts` (`configureApp`) + Swagger |
| `waitForRedis(app)` | Waits until the Redis client is connected, so cache / rate-limit assertions never hit the fallback |
| `http(app)` | Supertest agent |
| `createActor(app, role)` | Inserts a user with a real bcrypt hash and returns a real signed token (with `jti`, so logout works) and its `Authorization` header |
| `createRoom(app, …)` | Inserts a room directly (no admin call needed) |
| `book(app, actor, roomId, stay(in, out))` | `POST /bookings` for a stay *in*…*out* days from today |
| `PNG_1PX` | Smallest valid PNG for upload tests |
| `bearer(token)`, `uniqueEmail()`, `isoDateTime(days, hour)` | Header value, collision-free emails, ISO date-times *n* days from now |

## 3. How to run

```bash
npm ci
npx prisma generate        # the Prisma client is generated code

npm test                   # unit — no Docker needed
npm run test:cov           # unit + coverage report (./coverage)

npm run test:db:up         # start test MySQL + Redis (waits until healthy)
npm run test:integration
npm run test:e2e
npm run test:db:down       # stop + wipe

npm run test:all           # test DB + all three levels in one command (needs Docker)
```

Run a single file: `npx jest --config ./test/jest-integration.json test/integration/bookings.int-spec.ts`.

## 4. Test cases

Integration and E2E IDs appear in the test names, so every row can be found
with a search (e.g. `IT-BK-15`). Unit rows name the spec file; the newer unit
tests (`UT-BK`, `UT-CONF-00…02`, `UT-STAT-03…08`, `UT-ROLE-03…06`, `UT-ROOM`,
`UT-IMG`, `UT-NOTIF`, `UT-DOC`, `UT-HARN`) carry the ID in their name too.

### 4.1 Unit — core business logic (`npm test`)

**Date validation (FR-19)** — `src/common/utils/date-range.spec.ts`, `src/bookings/bookings.service.spec.ts`

| ID | Case | Expected | Status |
|---|---|---|---|
| UT-DATE-01 | check-out equal to or before check-in | 400, before any DB access | ✅ |
| UT-DATE-02 | check-in in the past | 400 | ✅ |
| UT-DATE-03 | invalid date strings; stay longer than 30 nights | 400 | ✅ |
| UT-DATE-04 | nights counted in whole days, partial days rounded up | correct count | ✅ |

**No double booking (FR-20)** — `src/common/utils/date-range.spec.ts`, `src/bookings/bookings.service.spec.ts`

| ID | Case | Expected | Status |
|---|---|---|---|
| UT-CONF-00 | the room row is locked (`SELECT … FOR UPDATE`) **before** the overlap check | lock runs first → concurrent requests are serialised | ✅ |
| UT-CONF-01 | overlap query is half-open `[checkIn, checkOut)` and only counts PENDING / APPROVED / PAID | exact Prisma `where` | ✅ |
| UT-CONF-02 | overlapping booking exists | 409; nothing created, no event | ✅ |
| UT-CONF-03 | partial, inside, enclosing, identical ranges (`rangesOverlap`) | conflict | ✅ |
| UT-CONF-04 | back-to-back stays; CANCELLED bookings | no conflict | ✅ |

**Bookings & status flow (FR-21–26)** — `src/bookings/bookings.service.spec.ts`, `src/bookings/booking-status.spec.ts`

| ID | Case | Expected | Status |
|---|---|---|---|
| UT-BK-01 | create: total = nights × price, default 1 guest, BOOKING_CREATED written with the **same transaction** | correct row + event | ✅ |
| UT-BK-02 / 03 | unknown room / deactivated room | 404 | ✅ |
| UT-BK-04 | more guests than the room fits | 400 | ✅ |
| UT-STAT-01 | allowed transitions PENDING→APPROVED/CANCELLED, APPROVED→PAID/CANCELLED, PAID→CANCELLED | allowed | ✅ |
| UT-STAT-02 | every other transition, the same status, anything from CANCELLED | 409 with the allowed targets | ✅ |
| UT-STAT-03 | admin PENDING → PAID (skipping APPROVED) | 409, nothing written | ✅ |
| UT-STAT-04 | owner cancels PENDING: compare-and-set update + BOOKING_CANCELLED | correct update + event | ✅ |
| UT-STAT-05 | admin cancels someone else's booking | event says "by an admin" | ✅ |
| UT-STAT-06 | regular user cancels a PAID or CANCELLED booking | 409 | ✅ |
| UT-STAT-07 | admin approves | BOOKING_STATUS_CHANGED for the owner | ✅ |
| UT-STAT-08 | status changed concurrently (update matches 0 rows) | 409, no event | ✅ |

**Roles & ownership (FR-5–7, NFR-2, NFR-3)** — `src/auth/guards.spec.ts`, `src/bookings/bookings.service.spec.ts`, `src/swagger/swagger-auth.spec.ts`

| ID | Case | Expected | Status |
|---|---|---|---|
| UT-ROLE-01 | Admin on an Admin-only route | allowed | ✅ |
| UT-ROLE-02 | Regular User on an Admin-only route | 403 | ✅ |
| UT-ROLE-03 | another user's booking; owner and admin | 403; owner + admin allowed | ✅ |
| UT-ROLE-04 | regular user lists bookings with `userId` of someone else | filter ignored, only own | ✅ |
| UT-ROLE-05 | admin lists all bookings, optional `userId` filter + pagination | all / filtered | ✅ |
| UT-ROLE-06 | user cancels another user's booking | 403, nothing written | ✅ |
| UT-JWT-01 | missing, expired, revoked, foreign-signed, malformed-payload tokens | 401 | ✅ |
| UT-DOC-07 | every route behind `JwtAuthGuard` shows the Swagger lock (and only those) | guards and docs agree | ✅ |

**Authentication & profile (FR-1–4, NFR-1, NFR-4)** — `src/auth/*.spec.ts`, `src/users/users.service.spec.ts`

| ID | Case | Expected | Status |
|---|---|---|---|
| UT-AUTH-01 | register stores a bcrypt hash, never the password; response has no hash | hash ≠ plaintext | ✅ |
| UT-AUTH-02 | user → response mapping | no password field | ✅ |
| UT-AUTH-03 | wrong password and unknown email | the same 401 | ✅ |
| UT-AUTH-04 | logout revokes exactly that token (Redis), others stay valid; Redis down → 503 | as specified | ✅ |
| UT-AUTH-05 | profile: email/password change needs `currentPassword`, returns a new token, password change signs out other sessions; taken email 409 | as specified | ✅ |

**Rooms, images, search, notifications** — `src/rooms/*.spec.ts`, `src/notifications/notifications.service.spec.ts`

| ID | Case | Expected | Status |
|---|---|---|---|
| UT-ROOM-01 / 02 | guests see active rooms only; `includeInactive` works for admins only | correct `where` | ✅ |
| UT-ROOM-03 | deactivated room: 404 for guests, visible to admins | as specified | ✅ |
| UT-ROOM-04 / 05 / 06 | delete a booked room → 409; unknown → 404; duplicate name → 409 | as specified | ✅ |
| UT-SRCH-01 | search excludes rooms with an overlapping active booking | correct `where` | ✅ |
| UT-IMG-01 | image stored; type taken from the file bytes, not the client | metadata row + file | ✅ |
| UT-IMG-02 / 03 | no file, non-image, > 5 MB → 400; 11th image → 409 | nothing stored | ✅ |
| UT-IMG-04 / 05 | DB insert fails → file removed again; image of another room → 404 | as specified | ✅ |
| UT-NOTIF-01…05 | events written with the booking's transaction; users see only their own; admin `all`; mark read 404 for others | as specified | ✅ |

**Platform** — cache (`http-cache.interceptor.spec.ts`, 9), rate limiter storage (6), env validation (10), MySQL/Redis probes (5), OpenAPI checker UT-DOC-01…06 (6), test harness UT-HARN-01…09 (11) | all ✅

### 4.2 Integration — endpoints + real test DB (`npm run test:integration`)

**Users & auth — `auth.int-spec.ts` (FR-1–5, NFR-1, NFR-4)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-AUTH-01 | register with name, email, password | 201 `{ message, data }`; DB stores a bcrypt hash, not the password | ✅ |
| IT-AUTH-02 | register with an existing email (also in upper case) | 409 "Email is already registered"; still one row | ✅ |
| IT-AUTH-03 | missing name / invalid email / short password / no digit / `role: ADMIN` | 400 with a clear message; nothing stored | ✅ |
| IT-AUTH-04 | log in with valid credentials | 200, Bearer JWT that opens `/users/me` | ✅ |
| IT-AUTH-05 | wrong password **or** unknown email | 401, identical body for both | ✅ |
| IT-AUTH-06 | register, login, profile read and update responses | no password or hash anywhere | ✅ |
| IT-AUTH-07 | own profile without / with token | 401 / 200 only the caller's data | ✅ |
| IT-AUTH-08 | update name; empty name, email without `currentPassword`, weak `newPassword`, `role` | 200 + persisted; 400 and DB unchanged | ✅ |
| IT-AUTH-09 | log out, then reuse the token; a second session | 401; the other session still works | ✅ |
| IT-AUTH-10 | expired JWT, payload edited to ADMIN (same signature), foreign secret | 401 "Invalid or expired token" | ✅ |
| IT-SEC-01 | register, failed + successful login, logout while capturing all logs | request lines logged; no password, hash or token in any log line | ✅ |

**Rooms — `rooms.int-spec.ts` (FR-8–16, NFR-3)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-ROOM-01 | Admin creates a room | 201 + "Room created successfully"; row in DB | ✅ |
| IT-ROOM-02 | Regular User / no token: create, edit, delete, upload | 403 "This action requires role: ADMIN" / 401; DB unchanged | ✅ |
| IT-ROOM-03 | capacity 0 or 21, negative price, missing name, unknown field | 400 with a clear message; nothing stored | ✅ |
| IT-ROOM-04 | guest lists rooms (cheapest first, capacity filter) and views details | 200, paginated `meta` | ✅ |
| IT-ROOM-05 | unknown id; non-numeric id | 404 "Room with id … not found"; 400 | ✅ |
| IT-ROOM-06 | GET twice (MISS, HIT), Admin edits, GET again | new values, `X-Cache: MISS` — never stale | ✅ |
| IT-ROOM-07 | Admin deactivates a room | hidden from list, details and search; booking → 404; Admin still sees it | ✅ |
| IT-ROOM-07b | delete a never-booked room; delete a booked room | 200 + row gone; 409 "deactivate it instead" | ✅ |
| IT-ROOM-08 | Admin uploads an image, views details, fetches the file, deletes it | 201 + metadata row; details list it; file served as `image/png`; 404 after delete | ✅ |
| IT-ROOM-09 | fake image (text named `.png`), no file, file > 5 MB | 400, 400, **413**; nothing stored | ✅ |

**Bookings — `bookings.int-spec.ts` (FR-17–26, NFR-2)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-BK-01 | create a booking | 201, PENDING, total = nights × price; DB row with user, room, exact date-times | ✅ |
| IT-BK-02 | check-out equal to / before check-in | 400 "checkIn must be before checkOut" | ✅ |
| IT-BK-03 | check-in in the past | 400 "checkIn cannot be in the past" | ✅ |
| IT-BK-04 | missing / malformed dates, missing `roomId`, too many guests | 400 with a clear message | ✅ |
| IT-BK-05 | unknown room; deactivated room | 404 | ✅ |
| IT-BK-06 | no token | 401 | ✅ |
| IT-BK-10 | overlapping range, same room | **409** "Room … is already booked from …" | ✅ |
| IT-BK-11 | range inside / enclosing / identical | **409** | ✅ |
| IT-BK-12 | back-to-back on either side | 201 | ✅ |
| IT-BK-13 | same range, different room | 201 | ✅ |
| IT-BK-14 | range of a booking that was cancelled | 201 | ✅ |
| IT-BK-15 | **6 users book the same room/range at the same moment** | exactly one 201 + five 409; one row and one event in DB | ✅ |
| IT-BK-20 | list own bookings (even with someone else's `userId`) | only the caller's | ✅ |
| IT-BK-21 / 22 / 23 | own booking; another user's; unknown id | 200; 403; 404 | ✅ |
| IT-BK-24 | user cancels own booking, then again | 200 CANCELLED in DB; 409 already cancelled | ✅ |
| IT-BK-25 | user cancels another user's booking | 403; DB unchanged | ✅ |
| IT-BK-26 | Admin lists all bookings; filter by `userId` | all users; filtered | ✅ |
| IT-BK-27 | Admin sets APPROVED, then PAID | 200; DB status after each step | ✅ |
| IT-BK-28 | user cancels a PAID booking; Admin cancels it | 409; 200 | ✅ |
| IT-BK-29 | invalid status value; PENDING→PAID; anything after CANCELLED | 400; 409; 409 — DB unchanged | ✅ |
| IT-BK-30 | Regular User sets APPROVED / PAID | 403; DB unchanged | ✅ |

**Search — `search.int-spec.ts` (FR-27–29)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-SRCH-01 | identical, inside, start-overlap, end-overlap, enclosing ranges | booked room excluded; other dates include it | ✅ |
| IT-SRCH-01b | PENDING, APPROVED and PAID bookings | each blocks the room | ✅ |
| IT-SRCH-02 | capacity 2 / 3 / 5 | only rooms with capacity ≥ requested | ✅ |
| IT-SRCH-03 | date range + capacity | both applied | ✅ |
| IT-SRCH-04 | deactivated room (even with `includeInactive`) | never returned | ✅ |
| IT-SRCH-05 | room with only a CANCELLED booking | returned | ✅ |
| IT-SRCH-06 | back-to-back with an existing booking (both sides) | returned | ✅ |
| IT-SRCH-07 | missing / reversed / equal / non-date / past / > 30 nights | 400 with a clear message | ✅ |

**Notifications & health — `platform.int-spec.ts`**

| ID | Req. | Case | Expected | Status |
|---|---|---|---|---|
| IT-NOTIF-01 | FR-30 | create a booking | BOOKING_CREATED for the owner (API + DB), `unreadCount` 1 | ✅ |
| IT-NOTIF-02 | FR-31 | user cancels; Admin approves and cancels | CANCELLED / STATUS_CHANGED events for the owner, newest first, "by an admin" | ✅ |
| IT-NOTIF-03 | FR-30–31 | list as another user; no token; mark someone else's as read | own events only; 401; 404 | ✅ |
| IT-NOTIF-04 | — | mark all as read | only the caller's unread events | ✅ |
| IT-HLTH-01 | FR-36 | `GET /health` with MySQL + Redis up; `/health/live` | 200, every check `up`, no credentials | ✅ |

**Rate limiting — `rate-limit.int-spec.ts` (Task 4; limits lowered to 3 / 2)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-RL-01 | `POST /auth/login` beyond the limit | 401 ×3 with `X-RateLimit-*`, then 429 with `Retry-After`; other routes still 200 | ✅ |
| IT-RL-02 | `POST /bookings` beyond the limit | 201 ×2, then 429; only 2 bookings in DB | ✅ |

### 4.3 End-to-end — journeys, responses + DB state (`npm run test:e2e`)

**Journeys — `test/e2e/booking-flow.e2e-spec.ts`**

| ID | Journey | Expected | Status |
|---|---|---|---|
| E2E-01 | sign up → log in → search → book → own list → cancel | all steps succeed; DB: booking CANCELLED, events CREATED + CANCELLED; room hidden from search while booked, available again after cancel | ✅ |
| E2E-02 | Admin creates room + uploads image → user books → Admin approves → marks PAID | DB status after every step; user sees PAID and the 3 events; image row stored | ✅ |
| E2E-03 | user tries room CRUD and a status change; user B reads / cancels user A's booking | 403 everywhere; room row, booking and events unchanged in DB | ✅ |
| E2E-04 | second user books an overlapping range | 409; one active booking in DB; search hides the room; free right after check-out | ✅ |
| E2E-05 | update profile → log out → reuse token → log in again | 200, then 401 (also for writes); new login works, name kept | ✅ |

**Module E2E suites** (written with the features, real DB)

| File | Tests | Covers | Status |
|---|---|---|---|
| `test/auth.e2e-spec.ts` | 17 | sign-up, login, logout, profile, RBAC with real logins, cache HIT/MISS + invalidation, 429 | ✅ |
| `test/rooms-bookings.e2e-spec.ts` | 30+ | rooms, images, bookings, double booking (also concurrent), search, notifications | ✅ |
| `test/health.e2e-spec.ts` | 2 | E2E-HLTH-01 liveness without dependencies; E2E-HLTH-02 503 per dependency, no credentials | ✅ |
| `test/e2e/swagger.e2e-spec.ts` | 2 | E2E-DOC-01 `/docs` serves Swagger UI; E2E-DOC-02 `/docs-json` is OpenAPI 3 with JWT bearer auth | ✅ |

### 4.4 Requirement coverage

| Requirement | Unit | Integration | E2E |
|---|---|---|---|
| FR-1–4 accounts, profile | UT-AUTH-* | IT-AUTH-01…09 | E2E-01, E2E-05 |
| FR-5–7 roles, own data only | UT-ROLE-* | IT-ROOM-02, IT-BK-20…30 | E2E-03 |
| FR-8–16 rooms + images | UT-ROOM-*, UT-IMG-* | IT-ROOM-01…09 | E2E-02 |
| FR-17–18, 21–26 bookings + status | UT-BK-*, UT-STAT-* | IT-BK-01…06, 20…30 | E2E-01, E2E-02 |
| FR-19 date validation | UT-DATE-* | IT-BK-02…04, IT-SRCH-07 | — |
| FR-20 no double booking | UT-CONF-* | IT-BK-10…15 | E2E-04 |
| FR-27–29 search | UT-SRCH-01 | IT-SRCH-01…07 | E2E-01, E2E-04 |
| FR-30–31 notifications | UT-NOTIF-* | IT-NOTIF-01…04 | E2E-01, E2E-02 |
| FR-32–34 messages, status codes | (every 4xx test asserts the message) | all | all |
| FR-36 health | probes | IT-HLTH-01 | E2E-HLTH-01/02 |
| FR-37 API docs | UT-DOC-01…07 | — | E2E-DOC-01/02 |
| NFR-1, 2, 4 hashing, auth, no leaks | UT-AUTH-*, UT-JWT-01 | IT-AUTH-01/06/10, IT-SEC-01 | — |
| Task 4 caching, rate limiting | cache + throttler storage | IT-ROOM-06, IT-RL-01/02 | `auth.e2e-spec.ts` |

## 5. Results

_Latest local run: 2026-11-19 · Node 24.14 · Windows 11 · test MySQL 8.4 +
Redis 7 in Docker (`npm run test:db:up`). Run twice in a row on a fresh
database: identical results, no flaky tests._

| Level | Suites | Tests | Passed | Failed |
|---|---|---|---|---|
| Unit | 18 | 164 | 164 | 0 |
| Integration | 6 | 82 | 82 | 0 |
| E2E | 5 | 63 | 63 | 0 |
| **Total** | **29** | **309** | **309** | **0** |

```text
$ npm run test:cov
Test Suites: 18 passed, 18 total
Tests:       164 passed, 164 total

$ npm run test:integration
Test Suites: 6 passed, 6 total
Tests:       82 passed, 82 total

$ npm run test:e2e
Test Suites: 5 passed, 5 total
Tests:       63 passed, 63 total
```

**Unit coverage** (`npm run test:cov`): statements 72.9 % · branches 74.3 % ·
functions 60.8 % · lines 73.5 %. The business-logic files the rubric names
are covered almost completely; the rest of the gap is wiring (modules,
controllers, `main.ts`), which the integration and E2E levels exercise.

| File | Statements | Branches |
|---|---|---|
| `bookings/bookings.service.ts` (double booking, status flow) | 100 % | 95 % |
| `bookings/booking-status.ts` (transitions) | 100 % | 100 % |
| `common/utils/date-range.ts` (date validation, overlap) | 100 % | 100 % |
| `auth/guards.ts` (JWT + role checks) | 100 % | 87 % |
| `auth/auth.service.ts` · `users/users.service.ts` | 95 % · 96 % | 79 % · 90 % |
| `notifications/notifications.service.ts` | 96 % | 83 % |
| `rooms/rooms.service.ts` | 83 % | 88 % |

**OpenAPI report** (`npm run openapi:check`): 23 operations —
"Every endpoint is documented." (0 errors, 0 warnings).

### Manual smoke test on the deployed URL

Run once in Swagger UI at
`https://group-project-backend-production-7db1d7b7.up.railway.app/docs`
with the deployed test accounts (see README → Deployment), after the latest
`main` has been deployed:

- [ ] `GET /health` → 200, all up
- [ ] register → log in → **Authorize** → view and update profile
- [ ] Admin: create room, upload image, edit, deactivate
- [ ] guest: list rooms, room details show the image
- [ ] user: search by dates + capacity → book → own list → details → cancel
- [ ] same room + overlapping time twice → 409
- [ ] user calls an Admin endpoint → 403
- [ ] Admin: list all bookings → approve → Paid
- [ ] notifications show created + cancelled events
- [ ] repeated log-ins → 429
- [ ] log out → old token → 401

## 6. Decisions the tests encode

These were open questions while the tests were being planned; the answers
below are what the API does and what the tests assert.

| # | Question | Decision | Tests |
|---|---|---|---|
| 1 | Is a back-to-back booking allowed (new check-in = existing check-out)? | **Yes** — stays are half-open `[checkIn, checkOut)` | IT-BK-12, IT-SRCH-06, UT-CONF-04 |
| 2 | Status for viewing another user's booking | **403** | IT-BK-22, UT-ROLE-03 |
| 3 | Allowed status changes and who makes them | PENDING→APPROVED/CANCELLED, APPROVED→PAID/CANCELLED, PAID→CANCELLED; CANCELLED is final. User: cancel own PENDING/APPROVED. Admin: everything | IT-BK-24…30, UT-STAT-* |
| 4 | Status for an illegal transition | **409**, message lists the allowed targets | IT-BK-29, UT-STAT-02/03 |
| 5 | Booking a deactivated room | **404** (the room is hidden, so it looks like it does not exist) | IT-BK-05, IT-ROOM-07 |
| 6 | Does logout revoke the JWT? | **Yes** — the token id is stored in Redis until the token expires | IT-AUTH-09, E2E-05 |
| 7 | Field name of the token in the login response | `data.accessToken` | IT-AUTH-04 |
| 8 | Status for an image over 5 MB | **413** (the upload limit rejects it before the API code runs); wrong type or no file → 400 | IT-ROOM-09 |
