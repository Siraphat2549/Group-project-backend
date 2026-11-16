import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenRevocationService } from './token-revocation.service';
import { TokenService } from './token.service';

// Cost 4 keeps bcrypt fast in tests; production uses BCRYPT_ROUNDS (12).
const passwords = new PasswordService({
  get: () => 4,
} as unknown as ConfigService);
const jwt = new JwtService({
  secret: 'unit-test-secret-unit-test-secret',
  signOptions: { expiresIn: '15m' },
});

function setup() {
  const user = { create: jest.fn(), findUnique: jest.fn() };
  const revocations = { revoke: jest.fn() };
  const service = new AuthService(
    { user } as unknown as PrismaService,
    passwords,
    new TokenService(jwt),
    revocations as unknown as TokenRevocationService,
  );
  return { service, user, revocations };
}

async function storedUser(password: string): Promise<User> {
  return {
    id: 5,
    name: 'Alice',
    email: 'alice@example.com',
    passwordHash: await passwords.hash(password),
    role: Role.USER,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  };
}

describe('AuthService.register', () => {
  it('stores a bcrypt hash, never the password, and returns no hash', async () => {
    const { service, user } = setup();
    user.create.mockImplementation(
      ({ data }: { data: Prisma.UserCreateInput }) =>
        Promise.resolve({
          id: 1,
          role: Role.USER,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }),
    );

    const result = await service.register({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'Secret123',
    });

    const { data } = (
      user.create.mock.calls as [{ data: Prisma.UserCreateInput }][]
    )[0][0];
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(data.passwordHash).not.toContain('Secret123');
    await expect(
      passwords.verify('Secret123', data.passwordHash),
    ).resolves.toBe(true);
    // Sign-up can never choose a role: it falls back to the DB default (USER).
    expect(data).not.toHaveProperty('role');

    expect(result).toMatchObject({ id: 1, email: 'alice@example.com' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('Secret123');
  });

  it('409 when the email is already registered', async () => {
    const { service, user } = setup();
    user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.register({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'Secret123',
      }),
    ).rejects.toThrow(new ConflictException('Email is already registered'));
  });
});

describe('AuthService.login', () => {
  it('returns a Bearer token carrying id, email, role and a unique jti', async () => {
    const { service, user } = setup();
    user.findUnique.mockResolvedValue(await storedUser('Secret123'));

    const first = await service.login({
      email: 'alice@example.com',
      password: 'Secret123',
    });
    const second = await service.login({
      email: 'alice@example.com',
      password: 'Secret123',
    });

    expect(first.tokenType).toBe('Bearer');
    expect(first.expiresIn).toBe(15 * 60);
    expect(first.user).not.toHaveProperty('passwordHash');

    const payload = jwt.verify<Record<string, unknown>>(first.accessToken);
    expect(payload).toMatchObject({
      sub: 5,
      email: 'alice@example.com',
      role: Role.USER,
    });
    expect(typeof payload.jti).toBe('string');
    expect(payload).not.toHaveProperty('passwordHash');
    expect(jwt.verify<{ jti: string }>(second.accessToken).jti).not.toBe(
      payload.jti,
    );
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const { service, user } = setup();
    const expected = new UnauthorizedException('Invalid email or password');

    user.findUnique.mockResolvedValue(await storedUser('Secret123'));
    await expect(
      service.login({ email: 'alice@example.com', password: 'Wrong1234' }),
    ).rejects.toThrow(expected);

    user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'nobody@example.com', password: 'Secret123' }),
    ).rejects.toThrow(expected);
  });
});

describe('AuthService.logout', () => {
  const authUser = { id: 5, email: 'alice@example.com', role: Role.USER };
  const token = { jti: 'token-1', iat: 100, exp: 200 };

  it('revokes exactly the presented token', async () => {
    const { service, revocations } = setup();
    await service.logout(authUser, token);
    expect(revocations.revoke).toHaveBeenCalledWith(token);
  });

  it('503 instead of a false success when the token cannot be revoked', async () => {
    const { service, revocations } = setup();
    revocations.revoke.mockRejectedValue(new Error('Redis down'));
    await expect(service.logout(authUser, token)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
