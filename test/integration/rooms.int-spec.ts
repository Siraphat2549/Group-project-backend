/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies are untyped */
// FR-8–16 · NFR-3 · caching. Test IDs match docs/API-TESTING.md.
import { Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import {
  Actor,
  book,
  createActor,
  createRoom,
  PNG_1PX,
  stay,
} from '../utils/factories';
import { createTestApp, http, TestApp, waitForRedis } from '../utils/test-app';

describe('Rooms (integration)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Actor;
  let user: Actor;

  const ids = (res: { body: { data: { id: number }[] } }) =>
    res.body.data.map((r) => r.id);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetTestState({
      db: prisma,
      cache: (await waitForRedis(app)).client,
    });
    admin = await createActor(app, Role.ADMIN);
    user = await createActor(app, Role.USER);
  });
  afterAll(() => app.close());

  it('IT-ROOM-01 Admin POST /rooms -> 201 + success message; row in DB', async () => {
    const res = await http(app)
      .post('/rooms')
      .set(admin.auth)
      .send({
        name: 'Deluxe 501',
        description: 'Sea view',
        capacity: 2,
        pricePerNight: 1500.5,
      })
      .expect(201);

    expect(res.body.message).toBe('Room created successfully');
    expect(res.body.data).toMatchObject({
      id: expect.any(Number),
      name: 'Deluxe 501',
      capacity: 2,
      pricePerNight: 1500.5,
      isActive: true,
      images: [],
    });
    const row = await prisma.room.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row).toMatchObject({
      name: 'Deluxe 501',
      capacity: 2,
      isActive: true,
    });
    expect(row.pricePerNight.toNumber()).toBe(1500.5);
  });

  it('IT-ROOM-02 Regular user create/edit/delete -> 403; no token -> 401; DB unchanged', async () => {
    const room = await createRoom(app, { name: 'Standard 101' });
    const attempts = [
      () =>
        http(app)
          .post('/rooms')
          .send({ name: 'X', capacity: 1, pricePerNight: 1 }),
      () => http(app).patch(`/rooms/${room.id}`).send({ capacity: 9 }),
      () => http(app).delete(`/rooms/${room.id}`),
      () =>
        http(app)
          .post(`/rooms/${room.id}/images`)
          .attach('image', PNG_1PX, 'a.png'),
    ];

    for (const attempt of attempts) {
      await attempt().expect(401);
      const res = await attempt().set(user.auth).expect(403);
      expect(res.body.message).toBe('This action requires role: ADMIN');
    }
    await expect(prisma.room.count()).resolves.toBe(1);
    await expect(
      prisma.room.findUniqueOrThrow({ where: { id: room.id } }),
    ).resolves.toMatchObject({ name: 'Standard 101', capacity: 2 });
    await expect(prisma.roomImage.count()).resolves.toBe(0);
  });

  it.each([
    [
      'capacity < 1',
      { name: 'A', capacity: 0, pricePerNight: 100 },
      /capacity must not be less than 1/,
    ],
    [
      'capacity > 20',
      { name: 'A', capacity: 21, pricePerNight: 100 },
      /capacity must not be greater than 20/,
    ],
    [
      'negative price',
      { name: 'A', capacity: 2, pricePerNight: -1 },
      /pricePerNight must not be less than 0.01/,
    ],
    [
      'missing name',
      { capacity: 2, pricePerNight: 100 },
      /name should not be empty/,
    ],
    [
      'unknown field',
      { name: 'A', capacity: 2, pricePerNight: 100, hacker: 1 },
      /property hacker should not exist/,
    ],
  ])(
    'IT-ROOM-03 %s -> 400 with a clear message; nothing stored',
    async (_c, body, message) => {
      const res = await http(app)
        .post('/rooms')
        .set(admin.auth)
        .send(body)
        .expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(message);
      await expect(prisma.room.count()).resolves.toBe(0);
    },
  );

  it('IT-ROOM-04 guests can list rooms and view details (200, paginated)', async () => {
    const cheap = await createRoom(app, { name: 'Cheap', pricePerNight: 500 });
    const dear = await createRoom(app, {
      name: 'Dear',
      pricePerNight: 5000,
      capacity: 4,
    });

    const list = await http(app).get('/rooms').expect(200);
    expect(ids(list)).toEqual([cheap.id, dear.id]); // cheapest first
    expect(list.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });

    const filtered = await http(app).get('/rooms?capacity=3').expect(200);
    expect(ids(filtered)).toEqual([dear.id]);

    const detail = await http(app).get(`/rooms/${dear.id}`).expect(200);
    expect(detail.body.data).toMatchObject({
      id: dear.id,
      name: 'Dear',
      pricePerNight: 5000,
    });
  });

  it('IT-ROOM-05 unknown room id -> 404 with a clear message; non-numeric id -> 400', async () => {
    const res = await http(app).get('/rooms/999999').expect(404);
    expect(res.body.message).toBe('Room with id 999999 not found');
    await http(app).get('/rooms/abc').expect(400);
    await http(app)
      .patch('/rooms/999999')
      .set(admin.auth)
      .send({ capacity: 3 })
      .expect(404);
  });

  it('IT-ROOM-06 Admin edits a room -> 200; the next GET shows the new values (cache invalidated)', async () => {
    const room = await createRoom(app, { pricePerNight: 1000 });

    const first = await http(app).get(`/rooms/${room.id}`).expect(200);
    expect(first.headers['x-cache']).toBe('MISS');
    const second = await http(app).get(`/rooms/${room.id}`).expect(200);
    expect(second.headers['x-cache']).toBe('HIT');

    await http(app)
      .patch(`/rooms/${room.id}`)
      .set(admin.auth)
      .send({ pricePerNight: 1999, description: 'Renovated' })
      .expect(200);

    const after = await http(app).get(`/rooms/${room.id}`).expect(200);
    expect(after.headers['x-cache']).toBe('MISS');
    expect(after.body.data).toMatchObject({
      pricePerNight: 1999,
      description: 'Renovated',
    });
  });

  it('IT-ROOM-07 deactivated room: hidden from list, details and search; cannot be booked; admin still sees it', async () => {
    const room = await createRoom(app);
    const dates = stay(5, 7);
    const search = `/rooms/search?checkIn=${encodeURIComponent(dates.checkIn)}&checkOut=${encodeURIComponent(dates.checkOut)}`;
    expect(ids(await http(app).get(search).expect(200))).toEqual([room.id]);

    await http(app)
      .patch(`/rooms/${room.id}`)
      .set(admin.auth)
      .send({ isActive: false })
      .expect(200);

    expect(ids(await http(app).get('/rooms').expect(200))).toEqual([]);
    expect(ids(await http(app).get(search).expect(200))).toEqual([]);
    await http(app).get(`/rooms/${room.id}`).expect(404);
    await book(app, user, room.id, dates).expect(404);

    await http(app).get(`/rooms/${room.id}`).set(admin.auth).expect(200);
    const adminList = await http(app)
      .get('/rooms?includeInactive=true')
      .set(admin.auth)
      .expect(200);
    expect(ids(adminList)).toEqual([room.id]);
    await expect(prisma.booking.count()).resolves.toBe(0);
  });

  it('IT-ROOM-07b delete: never-booked room is removed; a booked room -> 409 (deactivate instead)', async () => {
    const unused = await createRoom(app);
    const booked = await createRoom(app);
    await book(app, user, booked.id, stay(3, 4)).expect(201);

    const ok = await http(app)
      .delete(`/rooms/${unused.id}`)
      .set(admin.auth)
      .expect(200);
    expect(ok.body.message).toBe('Room deleted successfully');
    await expect(
      prisma.room.findUnique({ where: { id: unused.id } }),
    ).resolves.toBeNull();

    const conflict = await http(app)
      .delete(`/rooms/${booked.id}`)
      .set(admin.auth)
      .expect(409);
    expect(conflict.body.message).toMatch(
      /has bookings and cannot be deleted; deactivate it instead/,
    );
    await expect(
      prisma.room.findUnique({ where: { id: booked.id } }),
    ).resolves.not.toBeNull();
  });

  it('IT-ROOM-08 Admin uploads an image -> 201; metadata stored; details include it; file is served; delete removes it', async () => {
    const room = await createRoom(app);

    const res = await http(app)
      .post(`/rooms/${room.id}/images`)
      .set(admin.auth)
      .attach('image', PNG_1PX, {
        filename: 'front.png',
        contentType: 'image/png',
      })
      .expect(201);
    const image = res.body.data as { id: number; url: string };
    expect(res.body.message).toBe('Image uploaded successfully');
    expect(image).toMatchObject({
      url: expect.stringMatching(/^\/uploads\/rooms\/[0-9a-f-]+\.png$/),
      originalName: 'front.png',
      mimeType: 'image/png',
      sizeBytes: PNG_1PX.length,
    });
    await expect(
      prisma.roomImage.findUniqueOrThrow({ where: { id: image.id } }),
    ).resolves.toMatchObject({ roomId: room.id, mimeType: 'image/png' });

    const detail = await http(app).get(`/rooms/${room.id}`).expect(200);
    expect(detail.body.data.images).toEqual([
      expect.objectContaining({ id: image.id, url: image.url }),
    ]);

    const file = await http(app).get(image.url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');

    await http(app)
      .delete(`/rooms/${room.id}/images/${image.id}`)
      .set(admin.auth)
      .expect(200);
    await expect(prisma.roomImage.count()).resolves.toBe(0);
    await http(app).get(image.url).expect(404);
  });

  it('IT-ROOM-09 non-image or missing file -> 400; file over 5 MB -> 413; nothing stored', async () => {
    const room = await createRoom(app);
    const upload = () =>
      http(app).post(`/rooms/${room.id}/images`).set(admin.auth);

    const fake = await upload()
      // Claims to be a PNG; the server checks the bytes, not the name.
      .attach('image', Buffer.from('definitely not an image'), {
        filename: 'evil.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(fake.body.message).toBe('Only JPEG, PNG or WebP images are allowed');

    const missing = await upload().field('note', 'no file').expect(400);
    expect(missing.body.message).toMatch(/image file is required/);

    await upload()
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'huge.png')
      .expect(413);

    await expect(prisma.roomImage.count()).resolves.toBe(0);
  });
});
