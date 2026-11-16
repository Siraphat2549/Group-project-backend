import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { AuthUser, TokenInfo } from './auth-user.interface';

export const ROLES_KEY = 'roles';

/** Restrict a route to the given roles. Use together with JwtAuthGuard + RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated user (or undefined on optional-auth routes). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user,
);

/** Injects the verified token's id and lifetime (set by JwtAuthGuard). */
export const CurrentToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TokenInfo | undefined =>
    ctx.switchToHttp().getRequest<Request & { token?: TokenInfo }>().token,
);
