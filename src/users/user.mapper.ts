import { Role, User } from '@prisma/client';

/** Public shape of a user. `passwordHash` is deliberately absent (NFR-4). */
export interface UserResponse {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The only way a User row leaves the API. Fields are copied one by one (an
 * allow-list), so a column added to the table later is never exposed by
 * accident.
 */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
