# API Testing Document — Hotel Booking API (Group 13)

How the API is tested, the test cases for each requirement in the Hotel
Booking Specification, and the latest results.

- **Tools:** Jest 30 · ts-jest · Supertest · `@nestjs/testing`
- **Status legend:** ✅ passing · ⏳ planned (`it.todo`, feature not merged yet) · ❌ failing

## 1. Test levels

| Level | Scope | Location | Database | Command |
|---|---|---|---|---|
| **Unit** | Business logic in isolation: date validation, double-booking (overlap) check, status transitions, role checks; dependencies mocked | `src/**/*.spec.ts`, `test/utils/*.spec.ts` | none | `npm test` |
| **Integration** | Each module's endpoints (controllers) over HTTP with the real `AppModule` and a **real test database** | `test/integration/*.int-spec.ts` | MySQL `hotel_booking_test` | `npm run test:integration` |
| **E2E** | Realistic user/admin journeys across modules; asserts **responses and resulting database state** | `test/e2e/*.e2e-spec.ts`, `test/*.e2e-spec.ts` | MySQL `hotel_booking_test` | `npm run test:e2e` |

`npm run test:all` starts the test database and runs all three levels.
CI (`.github/workflows/test.yml`) runs them on every push and pull request
against real MySQL 8.4 and Redis 7.

## 2. Test environment

### Test database

`docker-compose.test.yml` starts a **separate, disposable** MySQL 8.4 + Redis 7
on ports **3307 / 6380** (the dev stack uses 3306 / 6379). Data lives in RAM
and disappears when the containers stop.

| Variable | Test value | Override |
|---|---|---|
| `DATABASE_URL` | `mysql://hotel_test:hotel_test@127.0.0.1:3307/hotel_booking_test` | `TEST_DATABASE_URL` |
| `REDIS_URL` | `redis://127.0.0.1:6380` | `TEST_REDIS_URL` |
| `THROTTLE_LIMIT` | `1000`, so ordinary suites never hit 429 (the rate-limit suite lowers it) | env |
| `JWT_SECRET` | test-only value | env |

**Safety guards**

1. During tests, `DATABASE_URL` and `REDIS_URL` are always replaced with the
   test values. They are never taken from `.env` or the shell
   (`test/setup/test-env.ts`).
2. Tests refuse to start unless the database name ends in `_test`.
3. The cleanup helper checks `SELECT DATABASE()` again before deleting rows.

### Lifecycle and cleanup

| When | What happens | Where |
|---|---|---|
| Once per run | Wait for the test MySQL, then rebuild the schema from scratch (`prisma migrate reset --force`, or `prisma db push --force-reset` without migrations; override with `TEST_DB_PREPARE_CMD`) | `test/setup/global-setup.ts` |
| Before each test | `resetTestState()` deletes all rows from every table (except `_prisma_migrations`) in one transaction with FK checks off; optionally flushes Redis (cache + rate-limit counters) | `test/utils/db-cleanup.ts` |
| After each suite | `app.close()` releases DB/Redis connections | each spec |
| After the run | `npm run test:db:down` removes the containers and data | — |

Every test creates its own data and does not depend on order. Suites run
one at a time (`maxWorkers: 1`) because they share one database.

### Helpers

| Helper | Purpose |
|---|---|
| `createTestApp({ configure })` | Boots the real `AppModule` (+ Swagger). `configure` applies the same global pipes/filters as `main.ts` |
| `http(app)` | Supertest agent |
| `bearer(token)` | `Authorization` header value |
| `uniqueEmail()` | Collision-free emails for sign-up |
| `isoDateTime(days, hour)` | ISO date-time *n* days from now, for check-in/out (FR-18) |

## 3. How to run

```bash
npm ci

npm test                   # unit — no Docker needed
npm run test:cov           # unit + coverage report (./coverage)

npm run test:db:up         # start test MySQL + Redis (waits until healthy)
npm run test:integration
npm run test:e2e
npm run test:db:down       # stop + wipe

npm run test:all           # all of the above in one command (needs Docker)
```

## 4. Test cases

Expected status codes follow the team's endpoint contract. Rows marked †
depend on a decision that is still open (§6).

### 4.1 Unit — core business logic

| ID | Req. | Case | Expected | Status |
|---|---|---|---|---|
| UT-DATE-01 | FR-19 | check-out equal to or before check-in | rejected | ⏳ |
| UT-DATE-02 | FR-19 | check-in in the past | rejected | ⏳ |
| UT-DATE-03 | FR-19 | missing / malformed date-time | rejected | ⏳ |
| UT-CONF-01 | FR-20 | partially overlapping ranges, same room | conflict | ⏳ |
| UT-CONF-02 | FR-20 | range inside / enclosing / identical | conflict | ⏳ |
| UT-CONF-03 | FR-20 | back-to-back (check-out A = check-in B) † | no conflict | ⏳ |
| UT-CONF-04 | FR-20 | existing booking is Cancelled | no conflict | ⏳ |
| UT-STAT-01 | FR-21, 22 | new booking | status Pending | ⏳ |
| UT-STAT-02 | FR-26 | allowed transitions (Pending→Approved/Cancelled, Approved→Paid/Cancelled) † | allowed | ⏳ |
| UT-STAT-03 | FR-26 | illegal transitions (Cancelled→\*, Paid→Pending) † | rejected | ⏳ |
| UT-ROLE-01 | FR-5, NFR-3 | Admin-only handler + Admin | allowed | ⏳ |
| UT-ROLE-02 | FR-5, NFR-3 | Admin-only handler + Regular User | 403 | ⏳ |
| UT-ROLE-03 | FR-6 | ownership check: another user's booking | 403 | ⏳ |
| UT-AUTH-01 | NFR-1 | password hashing + verification | hash ≠ plaintext; verify true/false | ⏳ |
| UT-AUTH-02 | NFR-4 | user → response mapping | no password field | ⏳ |
| UT-DOC-01…05 | FR-37 | OpenAPI completeness checker | as specified | ✅ |
| UT-HARN-01…09 | — | test-DB guard, cleanup, fixtures (11 tests) | as specified | ✅ |
| (existing) | NFR-19, FR-36 | env validation (5) + MySQL/Redis probes (5) | as specified | ✅ |

### 4.2 Integration — endpoints + real test DB

**Users & auth — `auth.int-spec.ts` (FR-1–5, NFR-1, NFR-4)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-AUTH-01 | register with name, email, password | 201; DB stores a hash, not the password | ⏳ |
| IT-AUTH-02 | register with an existing email | 409 | ⏳ |
| IT-AUTH-03 | missing name / invalid email / short password | 400, clear message | ⏳ |
| IT-AUTH-04 | log in with valid credentials | 200 + JWT | ⏳ |
| IT-AUTH-05 | wrong password **or** unknown email | 401, same message for both | ⏳ |
| IT-AUTH-06 | any auth/profile response | no password or hash | ⏳ |
| IT-AUTH-07 | view own profile without / with token | 401 / 200 own data | ⏳ |
| IT-AUTH-08 | update own profile; invalid data | 200 + persisted; 400 | ⏳ |
| IT-AUTH-09 | log out, then reuse token | 401 | ⏳ |
| IT-AUTH-10 | expired or tampered JWT | 401 | ⏳ |
| IT-SEC-01 | register/login while capturing logs | no password or token in logs | ⏳ |

**Rooms — `rooms.int-spec.ts` (FR-8–16, NFR-3)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-ROOM-01 | Admin creates room (name, capacity, price/night) | 201 + success message; row in DB | ⏳ |
| IT-ROOM-02 | Regular User creates/edits/deletes; no token | 403; 401 | ⏳ |
| IT-ROOM-03 | capacity < 1, negative price, missing name | 400 | ⏳ |
| IT-ROOM-04 | list rooms / room details as guest | 200 | ⏳ |
| IT-ROOM-05 | unknown room id | 404, clear message | ⏳ |
| IT-ROOM-06 | Admin edits room, then GET | 200; new values shown (cache invalidated) | ⏳ |
| IT-ROOM-07 | Admin deletes/deactivates room | hidden from list and search; not bookable | ⏳ |
| IT-ROOM-08 | Admin uploads image | 201; metadata stored; room details include the image | ⏳ |
| IT-ROOM-09 | upload non-image / oversized file | 400 | ⏳ |

**Bookings — `bookings.int-spec.ts` (FR-17–26, NFR-2)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-BK-01 | create booking | 201, Pending; stores user, room, check-in/out | ⏳ |
| IT-BK-02 | check-out ≤ check-in | 400 | ⏳ |
| IT-BK-03 | check-in in the past | 400 | ⏳ |
| IT-BK-04 | missing / malformed date-times | 400 | ⏳ |
| IT-BK-05 | unknown room; deactivated room † | 404; 400/404 | ⏳ |
| IT-BK-06 | no token | 401 | ⏳ |
| IT-BK-10 | overlapping range, same room | **409** | ⏳ |
| IT-BK-11 | range inside / enclosing / identical | **409** | ⏳ |
| IT-BK-12 | back-to-back † | 201 | ⏳ |
| IT-BK-13 | same range, different room | 201 | ⏳ |
| IT-BK-14 | range of a Cancelled booking | 201 | ⏳ |
| IT-BK-15 | **two concurrent requests**, same room/range | exactly one 201 + one 409; one row in DB | ⏳ |
| IT-BK-20 | list own bookings | only the caller's | ⏳ |
| IT-BK-21 | own booking details | 200 | ⏳ |
| IT-BK-22 | another user's booking details † | 403 | ⏳ |
| IT-BK-23 | unknown booking id | 404 | ⏳ |
| IT-BK-24 | user cancels own booking | 200, Cancelled | ⏳ |
| IT-BK-25 | user cancels another user's booking | 403 | ⏳ |
| IT-BK-26 | Admin lists all bookings | 200, all users | ⏳ |
| IT-BK-27 | Admin sets Approved, then Paid | 200; DB updated | ⏳ |
| IT-BK-28 | Admin cancels a booking | 200, Cancelled | ⏳ |
| IT-BK-29 | invalid status value / transition † | 400 / 409 | ⏳ |
| IT-BK-30 | Regular User sets Approved/Paid | 403 | ⏳ |

**Search — `search.int-spec.ts` (FR-27–29)**

| ID | Case | Expected | Status |
|---|---|---|---|
| IT-SRCH-01 | date range | only rooms with no overlapping active booking | ⏳ |
| IT-SRCH-02 | capacity filter | only capacity ≥ requested | ⏳ |
| IT-SRCH-03 | date range + capacity | both applied | ⏳ |
| IT-SRCH-04 | deactivated rooms | never returned | ⏳ |
| IT-SRCH-05 | room with only Cancelled bookings | returned | ⏳ |
| IT-SRCH-06 | back-to-back with existing booking † | returned | ⏳ |
| IT-SRCH-07 | missing / reversed / invalid range | 400 | ⏳ |

**Notifications, rate limit, health — `platform.int-spec.ts`**

| ID | Req. | Case | Expected | Status |
|---|---|---|---|---|
| IT-NOTIF-01 | FR-30 | create booking | "booking created" event for the user | ⏳ |
| IT-NOTIF-02 | FR-31 | cancel booking (user or Admin) | "booking cancelled" event | ⏳ |
| IT-NOTIF-03 | FR-30–31 | list notifications | only own events; no token → 401 | ⏳ |
| IT-RL-01 | Task 4 | `/auth/login` beyond the limit | 429 | ⏳ |
| IT-RL-02 | Task 4 | create booking beyond the limit | 429 | ⏳ |
| IT-HLTH-01 | FR-36 | health with test MySQL + Redis up | 200, every check up | ⏳ |

### 4.3 End-to-end — journeys, responses + DB state

| ID | Journey | Expected | Status |
|---|---|---|---|
| E2E-01 | sign up → log in → search → book → see own list → cancel | all steps succeed; DB: booking Cancelled, 2 notification events; room available again | ⏳ |
| E2E-02 | Admin creates room + uploads image → user books → Admin approves → marks Paid | DB status matches each step; user sees Paid | ⏳ |
| E2E-03 | user tries room CRUD / status change; user B reads or cancels user A's booking | 403; DB unchanged | ⏳ |
| E2E-04 | second user books an overlapping range on the same room | 409; exactly one active booking in DB; search hides the room | ⏳ |
| E2E-05 | user updates profile, logs out, reuses token | 200, then 401 | ⏳ |
| E2E-HLTH-01 | `GET /health/live` (existing `test/health.e2e-spec.ts`) | 200 without touching dependencies | ✅ |
| E2E-HLTH-02 | `GET /health` with MySQL/Redis down (existing) | 503, per-dependency `down`, no credentials | ✅ |
| E2E-DOC-01 | `GET /docs` | Swagger UI served | ✅ |
| E2E-DOC-02 | `GET /docs-json` | OpenAPI 3, JWT bearer scheme, all paths | ✅ |

## 5. Results

_Latest local run: 2026-11-16 · Node 24.14 · Windows 11. Prisma and the
feature modules are not merged yet, so planned cases show as `todo`._

| Level | Suites | Passed | Failed | Planned (todo) |
|---|---|---|---|---|
| Unit | 4 | 26 | 0 | — |
| Integration | 5 | 0 | 0 | 56 |
| E2E | 3 | 4 | 0 | 5 |

```text
$ npm test
Test Suites: 4 passed, 4 total
Tests:       26 passed, 26 total

$ npm run test:integration
Test Suites: 5 passed, 5 total
Tests:       56 todo, 56 total

$ npm run test:e2e
Test Suites: 3 passed, 3 total
Tests:       5 todo, 4 passed, 9 total
```

**OpenAPI report** (`npm run openapi`): 2 operations, 2 errors.
`GET /health` and `GET /health/live` have no `@ApiOperation` summary.

> Before submission: rerun everything (ideally take the CI log), update the
> status columns and this section, and add `npm run test:cov` coverage.

### Manual smoke test on the deployed URL

Run once in Swagger UI at `<DEPLOYED_URL>/docs` with the test accounts:

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

## 6. Open decisions (confirm with module owners)

| # | Question | Assumed in the test cases | Owner |
|---|---|---|---|
| 1 | Is a back-to-back booking allowed (new check-in = existing check-out)? | yes: ranges are `[checkIn, checkOut)` | Ice |
| 2 | Status for viewing another user's booking | 403 | Ice |
| 3 | Allowed status transitions and who performs each | user: cancel own; Admin: approve, mark Paid, cancel | Ice |
| 4 | Status for an illegal transition | 409 | Ice |
| 5 | Booking a deactivated room | 400 | Ice |
| 6 | Does log-out revoke the JWT (e.g. Redis denylist)? | yes | Sor |
| 7 | Field name of the token in the login response | `accessToken` | Sor |
