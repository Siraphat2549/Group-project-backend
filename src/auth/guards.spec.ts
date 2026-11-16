import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard } from './guards';
import { TokenRevocationService } from './token-revocation.service';

const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret' });

const isRevoked = jest.fn().mockResolvedValue(false);
const revocations = { isRevoked } as unknown as TokenRevocationService;

beforeEach(() => isRevoked.mockClear().mockResolvedValue(false));

function ctx(headers: Record<string, string>, user?: unknown) {
  const req: Record<string, unknown> = { headers, user };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { req, context };
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(jwt, revocations);

  it('attaches the user for a valid token', async () => {
    const token = jwt.sign({ sub: 7, email: 'a@b.c', role: Role.USER });
    const { req, context } = ctx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 7, email: 'a@b.c', role: Role.USER });
  });

  it('attaches the token id and lifetime for logout', async () => {
    const token = jwt.sign(
      { sub: 7, email: 'a@b.c', role: Role.USER, jti: 'token-1' },
      { expiresIn: 60 },
    );
    const { req, context } = ctx({ authorization: `Bearer ${token}` });
    await guard.canActivate(context);
    const info = req.token as { jti: string; iat: number; exp: number };
    expect(info.jti).toBe('token-1');
    expect(info.exp - info.iat).toBe(60);
    expect(isRevoked).toHaveBeenCalledWith(7, info);
  });

  it('401 for a revoked (logged-out) token', async () => {
    isRevoked.mockResolvedValue(true);
    const token = jwt.sign({ sub: 7, email: 'a@b.c', role: Role.USER });
    const { req, context } = ctx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired token',
    );
    expect(req.user).toBeUndefined();
  });

  it('401 for an expired token', async () => {
    const token = jwt.sign(
      { sub: 7, email: 'a@b.c', role: Role.USER },
      { expiresIn: -10 },
    );
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${token}` }).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('401 without a token', async () => {
    await expect(guard.canActivate(ctx({}).context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('401 for a token signed with another secret', async () => {
    const forged = new JwtService({ secret: 'other' }).sign({
      sub: 1,
      email: 'x@y.z',
      role: Role.ADMIN,
    });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${forged}` }).context),
    ).rejects.toThrow('Invalid or expired token');
  });

  it('401 for a token with an unexpected payload shape', async () => {
    const token = jwt.sign({ sub: '1', role: 'SUPERUSER' });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${token}` }).context),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('OptionalJwtAuthGuard', () => {
  it('lets anonymous and bad-token requests through without a user', async () => {
    const guard = new OptionalJwtAuthGuard(jwt, revocations);
    const anon = ctx({});
    const bad = ctx({ authorization: 'Bearer garbage' });
    await expect(guard.canActivate(anon.context)).resolves.toBe(true);
    await expect(guard.canActivate(bad.context)).resolves.toBe(true);
    expect(anon.req.user).toBeUndefined();
    expect(bad.req.user).toBeUndefined();
  });
});

describe('OptionalJwtAuthGuard with a revoked token', () => {
  it('treats the request as anonymous', async () => {
    isRevoked.mockResolvedValue(true);
    const guard = new OptionalJwtAuthGuard(jwt, revocations);
    const token = jwt.sign({ sub: 1, email: 'x@y.z', role: Role.ADMIN });
    const { req, context } = ctx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toBeUndefined();
  });
});

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('allows when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(undefined);
    expect(guard.canActivate(ctx({}).context)).toBe(true);
  });

  it('allows an admin on an admin route', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce([Role.ADMIN]);
    expect(guard.canActivate(ctx({}, { role: Role.ADMIN }).context)).toBe(true);
  });

  it('403 for a regular user on an admin route', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce([Role.ADMIN]);
    expect(() =>
      guard.canActivate(ctx({}, { role: Role.USER }).context),
    ).toThrow(ForbiddenException);
  });
});
