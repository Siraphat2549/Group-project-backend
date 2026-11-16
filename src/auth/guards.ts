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
import { AuthUser, JwtPayload } from './auth-user.interface';
import { ROLES_KEY } from './decorators';

type AuthRequest = Request & { user?: AuthUser };

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

async function verify(
  jwt: JwtService,
  token: string,
): Promise<AuthUser | undefined> {
  try {
    const payload: unknown = await jwt.verifyAsync(token);
    if (!isValidPayload(payload)) return undefined;
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return undefined;
  }
}

/** Requires a valid `Authorization: Bearer <jwt>` header (NFR-2). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearer(req);
    if (!token) {
      throw new UnauthorizedException(
        'Authentication required: send Authorization: Bearer <token>',
      );
    }
    const user = await verify(this.jwt, token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.user = user;
    return true;
  }
}

/**
 * For public routes that behave differently for admins (e.g. listing
 * inactive rooms). A missing or invalid token just means "anonymous".
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearer(req);
    if (token) req.user = await verify(this.jwt, token);
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
