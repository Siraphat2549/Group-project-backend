import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import { PasswordService } from '../auth/password.service';
import { TokenRevocationService } from '../auth/token-revocation.service';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const passwords = new PasswordService({
  get: () => 4,
} as unknown as ConfigService);
const jwt = new JwtService({
  secret: 'unit-test-secret-unit-test-secret',
  signOptions: { expiresIn: '1h' },
});
const token = { jti: 'current', iat: 1000, exp: 4600 };

async function setup() {
  const row: User = {
    id: 5,
    name: 'Alice',
    email: 'alice@example.com',
    passwordHash: await passwords.hash('Secret123'),
    role: Role.USER,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  };
  const user = {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn(({ data }: { data: Prisma.UserUpdateInput }) =>
      Promise.resolve({ ...row, ...data }),
    ),
  };
  const revocations = {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    { user } as unknown as PrismaService,
    passwords,
    new TokenService(jwt),
    revocations as unknown as TokenRevocationService,
  );
  const updateData = () =>
    (user.update.mock.calls as [{ data: Prisma.UserUpdateInput }][])[0][0].data;
  return { service, user, revocations, updateData };
}

describe('UsersService.getProfile', () => {
  it('returns the profile without the password hash', async () => {
    const { service } = await setup();
    const profile = await service.getProfile(5);
    expect(profile).toMatchObject({ id: 5, name: 'Alice', role: Role.USER });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('401 when the account behind a valid token no longer exists', async () => {
    const { service, user } = await setup();
    user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile(5)).rejects.toThrow(UnauthorizedException);
  });
});

describe('UsersService.updateProfile', () => {
  it('changes the name without asking for the password or a new token', async () => {
    const { service, updateData, revocations } = await setup();
    const result = await service.updateProfile(5, { name: 'Alice B' }, token);

    expect(updateData()).toEqual({ name: 'Alice B' });
    expect(result.user.name).toBe('Alice B');
    expect(result.token).toBeUndefined();
    expect(revocations.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('400 when changing email or password without currentPassword', async () => {
    const { service, user } = await setup();
    await expect(
      service.updateProfile(5, { email: 'new@example.com' }, token),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateProfile(5, { newPassword: 'Another123' }, token),
    ).rejects.toThrow(BadRequestException);
    expect(user.update).not.toHaveBeenCalled();
  });

  it('401 when currentPassword is wrong', async () => {
    const { service, user } = await setup();
    await expect(
      service.updateProfile(
        5,
        { newPassword: 'Another123', currentPassword: 'Wrong1234' },
        token,
      ),
    ).rejects.toThrow(
      new UnauthorizedException('Current password is incorrect'),
    );
    expect(user.update).not.toHaveBeenCalled();
  });

  it('a password change stores a new hash, signs out other sessions and returns a new token', async () => {
    const { service, updateData, revocations } = await setup();
    const result = await service.updateProfile(
      5,
      { newPassword: 'Another123', currentPassword: 'Secret123' },
      token,
    );

    const hash = updateData().passwordHash as string;
    await expect(passwords.verify('Another123', hash)).resolves.toBe(true);
    // Marker lives as long as the longest-lived token still out there.
    expect(revocations.revokeAllForUser).toHaveBeenCalledWith(5, 3600);
    expect(result.token?.tokenType).toBe('Bearer');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('an email change returns a token carrying the new email', async () => {
    const { service } = await setup();
    const result = await service.updateProfile(
      5,
      { email: 'new@example.com', currentPassword: 'Secret123' },
      token,
    );
    expect(result.user.email).toBe('new@example.com');
    expect(
      jwt.verify<{ email: string }>(result.token?.accessToken ?? '').email,
    ).toBe('new@example.com');
  });

  it('409 when the new email belongs to someone else', async () => {
    const { service, user } = await setup();
    user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.updateProfile(
        5,
        { email: 'taken@example.com', currentPassword: 'Secret123' },
        token,
      ),
    ).rejects.toThrow(new ConflictException('Email is already registered'));
  });

  it('400 when nothing would change', async () => {
    const { service } = await setup();
    await expect(service.updateProfile(5, {}, token)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.updateProfile(5, { name: 'Alice' }, token),
    ).rejects.toThrow(BadRequestException);
  });
});
