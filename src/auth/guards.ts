import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { AuthUser, JwtPayload, TokenInfo } from './auth-user.interface';
import { ROLES_KEY } from './decorators';
import { TokenRevocationService } from './token-revocation.service';

type AuthRequest = Request & { user?: AuthUser; token?: TokenInfo };

interface VerifiedToken {
  user: AuthUser;
  token: TokenInfo;
}

function extractBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

function isValidPayload(p: unknown): p is JwtPayload {
  const v = p as Partial<JwtPayload> | null;
  return (
    !!v &&
    typeof v.sub === 'number' &&
    typeof v.email === 'string' &&
    (v.role === Role.USER || v.role === Role.ADMIN)
  );
}

/**
 * Signature + expiry (JwtService), payload shape, then revocation (logout /
 * password change). Any failure means "not authenticated".
 */
async function verify(
  jwt: JwtService,
  revocations: TokenRevocationService,
  rawToken: string,
): Promise<VerifiedToken | undefined> {
  let payload: unknown;
  try {
    payload = await jwt.verifyAsync(rawToken);
  } catch {
    return undefined;
  }
  if (!isValidPayload(payload)) return undefined;

  const token: TokenInfo = {
    jti: typeof payload.jti === 'string' ? payload.jti : undefined,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
  if (await revocations.isRevoked(payload.sub, token)) return undefined;

  return {
    user: { id: payload.sub, email: payload.email, role: payload.role },
    token,
  };
}

/** Requires a valid `Authorization: Bearer <jwt>` header (NFR-2). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly revocations: TokenRevocationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearer(req);
    if (!token) {
      throw new UnauthorizedException(
        'Authentication required: send Authorization: Bearer <token>',
      );
    }
    const verified = await verify(this.jwt, this.revocations, token);
    if (!verified) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.user = verified.user;
    req.token = verified.token;
    return true;
  }
}

/**
 * For public routes that behave differently for admins (e.g. listing
 * inactive rooms). A missing or invalid token just means "anonymous".
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly revocations: TokenRevocationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearer(req);
    if (token) {
      const verified = await verify(this.jwt, this.revocations, token);
      req.user = verified?.user;
      req.token = verified?.token;
    }
    return true;
  }
}

/** Enforces @Roles(...). Must run after JwtAuthGuard (NFR-3). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires role: ${required.join(' or ')}`,
      );
    }
    return true;
  }
}
