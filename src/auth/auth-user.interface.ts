import { Role } from '@prisma/client';

/** What every guarded request carries in `req.user` after JWT verification. */
export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

/** JWT payload contract. Auth's login must sign tokens with exactly this shape. */
export interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
}

export function isAdmin(user: AuthUser | undefined): boolean {
  return user?.role === Role.ADMIN;
}
