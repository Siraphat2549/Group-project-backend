import { Role } from '@prisma/client';

/** What every guarded request carries in `req.user` after JWT verification. */
export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

/**
 * JWT payload contract. Login signs `sub`, `email`, `role` and a unique
 * `jti`; the JWT library adds `iat` / `exp` (seconds since epoch).
 */
export interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
  jti?: string;
  iat?: number;
  exp?: number;
}

/** Identity and lifetime of the token behind a request (`req.token`). */
export interface TokenInfo {
  /** Unique token id; lets logout revoke exactly this token. */
  jti?: string;
  iat: number;
  exp: number;
}

export function isAdmin(user: AuthUser | undefined): boolean {
  return user?.role === Role.ADMIN;
}
