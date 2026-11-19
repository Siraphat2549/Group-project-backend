/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies are untyped */
// FR-1–5 · NFR-1, NFR-4. Test IDs match docs/API-TESTING.md.
import { LoggerService } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resetTestState } from '../utils/db-cleanup';
import { TEST_PASSWORD } from '../utils/factories';
import { bearer, uniqueEmail } from '../utils/fixtures';
import { createTestApp, http, TestApp, waitForRedis } from '../utils/test-app';

/** Collects every log line the app writes, to prove nothing secret leaks. */
class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private readonly push = (...args: unknown[]) => {
    this.lines.push(
      args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' '),
    );
  };
  log = this.push;
  error = this.push;
  warn = this.push;
  debug = this.push;
  verbose = this.push;
  fatal = this.push;
}

describe('Auth & Users (integration)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  const logs = new CapturingLogger();

  const register = (body: Record<string, unknown>) =>
    http(app).post('/auth/register').send(body);
  const login = (email: string, password = TEST_PASSWORD) =>
    http(app).post('/auth/login').send({ email, password });

  /** Registers + logs in a fresh user; returns email and token. */
  async function signedUpUser(name = 'Alice') {
    const email = uniqueEmail(name.toLowerCase());
    await register({ name, email, password: TEST_PASSWORD }).expect(201);
    const res = await login(email).expect(200);
    return { email, token: res.body.data.accessToken as string };
  }

  beforeAll(async () => {
    app = await createTestApp({ configure: (a) => a.useLogger(logs) });
    prisma = app.get(PrismaService);
    await waitForRedis(app);
  });
  beforeEach(async () => {
    await resetTestState({
      db: prisma,
      cache: (await waitForRedis(app)).client,
    });
    logs.lines.length = 0;
  });
  afterAll(() => app.close());

  it('IT-AUTH-01 POST /auth/register -> 201; DB stores a bcrypt hash, never the plaintext password', async () => {
    const email = uniqueEmail('alice');
    const res = await register({
      name: 'Alice',
      email,
      password: TEST_PASSWORD,
    }).expect(201);

    expect(res.body).toEqual({
      message: 'Account created successfully',
      data: {
        id: expect.any(Number),
        name: 'Alice',
        email,
        role: 'USER',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('IT-AUTH-02 register with an existing email (any letter case) -> 409; still one account', async () => {
    const email = uniqueEmail('dup');
    await register({ name: 'A', email, password: TEST_PASSWORD }).expect(201);

    for (const again of [email, email.toUpperCase()]) {
      const res = await register({
        name: 'B',
        email: again,
        password: TEST_PASSWORD,
      }).expect(409);
      expect(res.body.message).toBe('Email is already registered');
    }
    await expect(prisma.user.count({ where: { email } })).resolves.toBe(1);
  });

  it.each([
    [
      'missing name',
      { email: 'x@test.local', password: TEST_PASSWORD },
      /name/,
    ],
    [
      'invalid email',
      { name: 'X', email: 'not-an-email', password: TEST_PASSWORD },
      /email must be a valid email address/,
    ],
    [
      'short password',
      { name: 'X', email: 'x@test.local', password: 'a1' },
      /password must be 8-72 characters/,
    ],
    [
      'password without a number',
      { name: 'X', email: 'x@test.local', password: 'abcdefghij' },
      /at least one letter and one number/,
    ],
    [
      'self-assigned role',
      {
        name: 'X',
        email: 'x@test.local',
        password: TEST_PASSWORD,
        role: 'ADMIN',
      },
      /property role should not exist/,
    ],
  ])(
    'IT-AUTH-03 register with %s -> 400 with a clear message; nothing stored',
    async (_case, body, message) => {
      const res = await register(body).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(message);
      await expect(prisma.user.count()).resolves.toBe(0);
    },
  );

  it('IT-AUTH-04 POST /auth/login with valid credentials -> 200 with a working JWT', async () => {
    const email = uniqueEmail('bob');
    await register({ name: 'Bob', email, password: TEST_PASSWORD }).expect(201);

    const res = await login(email).expect(200);
    expect(res.body.message).toBe('Login successful');
    expect(res.body.data).toMatchObject({
      accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      tokenType: 'Bearer',
      expiresIn: 900, // JWT_EXPIRES_IN=15m in the test env
      user: { email, role: 'USER' },
    });

    await http(app)
      .get('/users/me')
      .set('Authorization', bearer(res.body.data.accessToken as string))
      .expect(200);
  });

  it('IT-AUTH-05 wrong password and unknown email -> 401 with the same body (no account enumeration)', async () => {
    const { email } = await signedUpUser();
    const wrongPassword = await login(email, 'Wrong-pass1').expect(401);
    const unknownEmail = await login(uniqueEmail('ghost')).expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.message).toBe('Invalid email or password');
  });

  it('IT-AUTH-06 no auth or profile response contains a password or its hash', async () => {
    const email = uniqueEmail('carol');
    const bodies: unknown[] = [];
    bodies.push(
      (await register({ name: 'Carol', email, password: TEST_PASSWORD })).body,
    );
    const loginRes = await login(email);
    bodies.push(loginRes.body);
    const auth = {
      Authorization: bearer(loginRes.body.data.accessToken as string),
    };
    bodies.push((await http(app).get('/users/me').set(auth)).body);
    bodies.push(
      (await http(app).patch('/users/me').set(auth).send({ name: 'Caro' }))
        .body,
    );

    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { email },
    });
    for (const body of bodies) {
      const json = JSON.stringify(body);
      expect(json).not.toMatch(/password/i);
      expect(json).not.toContain(passwordHash);
      expect(json).not.toContain(TEST_PASSWORD);
    }
  });

  it('IT-AUTH-07 GET /users/me: no token -> 401; with a token -> only the caller’s own data', async () => {
    const res401 = await http(app).get('/users/me').expect(401);
    expect(res401.body.message).toMatch(/Authentication required/);

    const alice = await signedUpUser('Alice');
    const bob = await signedUpUser('Bob');
    const res = await http(app)
      .get('/users/me')
      .set('Authorization', bearer(alice.token))
      .expect(200);
    expect(res.body.data.email).toBe(alice.email);
    expect(JSON.stringify(res.body)).not.toContain(bob.email);
  });

  it('IT-AUTH-08 PATCH /users/me -> 200 and persisted; invalid data -> 400 and nothing changes', async () => {
    const { email, token } = await signedUpUser('Dave');
    const auth = { Authorization: bearer(token) };

    const res = await http(app)
      .patch('/users/me')
      .set(auth)
      .send({ name: 'David' })
      .expect(200);
    expect(res.body).toMatchObject({
      message: 'Profile updated successfully',
      data: { name: 'David', email },
    });
    expect(res.body).not.toHaveProperty('token'); // only on email/password change
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email } }),
    ).resolves.toMatchObject({ name: 'David' });

    for (const [body, message] of [
      [{ name: '' }, /name cannot be empty/],
      [{ email: uniqueEmail('new') }, /currentPassword is required/],
      [{ newPassword: 'short' }, /newPassword must be 8-72 characters/],
      [{ role: 'ADMIN' }, /property role should not exist/],
    ] as const) {
      const bad = await http(app)
        .patch('/users/me')
        .set(auth)
        .send(body)
        .expect(400);
      expect(JSON.stringify(bad.body.message)).toMatch(message);
    }
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email } }),
    ).resolves.toMatchObject({ name: 'David', role: 'USER' });
  });

  it('IT-AUTH-09 POST /auth/logout -> that token is rejected (401); other sessions keep working', async () => {
    const { email, token } = await signedUpUser('Erin');
    const other = (await login(email).expect(200)).body.data
      .accessToken as string;

    const res = await http(app)
      .post('/auth/logout')
      .set('Authorization', bearer(token))
      .expect(200);
    expect(res.body.message).toBe('Logged out successfully');

    await http(app)
      .get('/users/me')
      .set('Authorization', bearer(token))
      .expect(401);
    await http(app)
      .get('/users/me')
      .set('Authorization', bearer(other))
      .expect(200);
  });

  it('IT-AUTH-10 expired, tampered or foreign-signed JWT -> 401', async () => {
    const { email, token } = await signedUpUser('Frank');
    const { id } = await prisma.user.findUniqueOrThrow({ where: { email } });
    const payload = { sub: id, email, role: 'USER' };

    const expired = app.get(JwtService).sign(payload, { expiresIn: -10 });
    // Privilege escalation attempt: same signature, payload edited to ADMIN.
    const [header, body, signature] = token.split('.');
    const edited = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        role: 'ADMIN',
      }),
    ).toString('base64url');
    const tampered = [header, edited, signature].join('.');
    const foreign = new JwtService({
      secret: 'some-other-secret-some-other-secret',
    }).sign(payload);

    for (const bad of [expired, tampered, foreign]) {
      const res = await http(app)
        .get('/users/me')
        .set('Authorization', bearer(bad))
        .expect(401);
      expect(res.body.message).toBe('Invalid or expired token');
    }
  });

  it('IT-SEC-01 passwords and tokens never appear in application logs', async () => {
    const email = uniqueEmail('gina');
    await register({ name: 'Gina', email, password: TEST_PASSWORD }).expect(
      201,
    );
    await login(email, 'Wrong-pass1').expect(401);
    const token = (await login(email).expect(200)).body.data
      .accessToken as string;
    await http(app)
      .post('/auth/logout')
      .set('Authorization', bearer(token))
      .expect(200);

    const all = logs.lines.join('\n');
    // The capture works: the request log and the failed login are there...
    expect(all).toMatch(/POST \/auth\/login 200/);
    expect(all).toMatch(/Login failed/);
    // ...but no secret is.
    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(all).not.toContain(TEST_PASSWORD);
    expect(all).not.toContain('Wrong-pass1');
    expect(all).not.toContain(passwordHash);
    expect(all).not.toContain(token);
  });
});
