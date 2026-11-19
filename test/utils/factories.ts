/**
 * Test data builders for integration / E2E suites. Users are inserted
 * directly (with a real bcrypt hash and a real signed token, including the
 * `jti` logout needs), so suites that are not about sign-up stay fast and do
 * not depend on the auth endpoints.
 */
import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { PasswordService } from '../../src/auth/password.service';
import { TokenService } from '../../src/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer, isoDateTime, uniqueEmail } from './fixtures';
import { http, TestApp } from './test-app';

/** Password of every factory-made user (meets the password policy). */
export const TEST_PASSWORD = 'Secret123';

export interface Actor {
  id: number;
  name: string;
  email: string;
  role: Role;
  token: string;
  /** `{ Authorization: 'Bearer …' }` for supertest's `.set()`. */
  auth: { Authorization: string };
}

export async function createActor(
  app: TestApp,
  role: Role = Role.USER,
  name: string = role === Role.ADMIN ? 'Admin' : 'User',
): Promise<Actor> {
  const passwordHash = await app.get(PasswordService).hash(TEST_PASSWORD);
  const email = uniqueEmail(role.toLowerCase());
  const user = await app
    .get(PrismaService)
    .user.create({ data: { name, email, role, passwordHash } });
  const { accessToken } = await app.get(TokenService).issue(user);
  return {
    id: user.id,
    name,
    email,
    role,
    token: accessToken,
    auth: { Authorization: bearer(accessToken) },
  };
}

export interface RoomInput {
  name?: string;
  description?: string;
  capacity?: number;
  pricePerNight?: number;
  isActive?: boolean;
}

/** Inserts a room directly (no admin token or cache invalidation needed). */
export function createRoom(app: TestApp, input: RoomInput = {}) {
  return app.get(PrismaService).room.create({
    data: {
      name: `Room ${randomUUID().slice(0, 8)}`,
      capacity: 2,
      pricePerNight: 1000,
      ...input,
    },
  });
}

/**
 * Stay from `inDays` to `outDays` days from today, check-in/out at 14:00
 * UTC (always in the future for inDays >= 1).
 */
export const stay = (inDays: number, outDays: number) => ({
  checkIn: isoDateTime(inDays),
  checkOut: isoDateTime(outDays),
});

/** POST /bookings as `actor`; returns the raw supertest response. */
export function book(
  app: TestApp,
  actor: Actor,
  roomId: number,
  dates: { checkIn: string; checkOut: string },
  guests?: number,
) {
  return http(app)
    .post('/bookings')
    .set(actor.auth)
    .send({ roomId, ...dates, ...(guests ? { guests } : {}) });
}

/** A 1×1 PNG, the smallest valid image for upload tests. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
