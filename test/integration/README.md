# Integration tests

One file per module. HTTP-level (`supertest`) against the **real test
MySQL/Redis** (`npm run test:db:up`). Never mock the database here.

Template:

```ts
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import { bearer, isoDateTime, uniqueEmail } from '../utils/fixtures';
import { createTestApp, http, TestApp } from '../utils/test-app';

describe('Rooms (integration)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      // same global setup as main.ts
      configure: (a) => a.useGlobalPipes(new ValidationPipe({ whitelist: true })),
    });
  });
  beforeEach(() => resetTestState({ db: app.get(PrismaService) }));
  afterAll(() => app.close());

  it('IT-ROOM-01 Admin POST /rooms -> 201', async () => {
    const res = await http(app)
      .post('/rooms')
      .set('Authorization', bearer(adminToken))
      .send({ name: 'Deluxe', capacity: 2, pricePerNight: 1500 })
      .expect(201);
    // assert the DB too
    const row = await app.get(PrismaService).room.findUnique({ where: { id: res.body.id } });
    expect(row).toMatchObject({ name: 'Deluxe' });
  });
});
```

Turn each `it.todo('IT-…')` into a real `it` when the feature lands and keep
the ID in the name so it lines up with `docs/API-TESTING.md`.
