import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard } from './guards';

const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret' });

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
  const guard = new JwtAuthGuard(jwt);

  it('attaches the user for a valid token', async () => {
    const token = jwt.sign({ sub: 7, email: 'a@b.c', role: Role.USER });
    const { req, context } = ctx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 7, email: 'a@b.c', role: Role.USER });
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
    const guard = new OptionalJwtAuthGuard(jwt);
    const anon = ctx({});
    const bad = ctx({ authorization: 'Bearer garbage' });
    await expect(guard.canActivate(anon.context)).resolves.toBe(true);
    await expect(guard.canActivate(bad.context)).resolves.toBe(true);
    expect(anon.req.user).toBeUndefined();
    expect(bad.req.user).toBeUndefined();
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
