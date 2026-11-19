import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../auth/auth.controller';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/guards';
import { BookingsController } from '../bookings/bookings.controller';
import { HealthController } from '../health/health.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { RoomsController } from '../rooms/rooms.controller';
import { UsersController } from '../users/users.controller';
import { BEARER_AUTH } from './swagger';

/**
 * Swagger UI only sends the token from "Authorize" to operations that declare
 * the bearer scheme. This test ties the docs to the real guards, so a route
 * protected at runtime can never be shown as public in Swagger (or vice versa).
 */
type AuthMode = 'required' | 'optional' | 'public';

/** Metadata key written by @ApiBearerAuth / @ApiSecurity (@nestjs/swagger). */
const API_SECURITY = 'swagger/apiSecurity';

const CONTROLLERS = [
  AuthController,
  UsersController,
  RoomsController,
  BookingsController,
  NotificationsController,
  HealthController,
];

function metadata(key: string, target: object): unknown[] {
  return (Reflect.getMetadata(key, target) as unknown[] | undefined) ?? [];
}

const routes = CONTROLLERS.flatMap((controller) => {
  const proto = controller.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor') // the class has @Controller's path
    .map((name) => ({ name, handler: proto[name] }))
    .filter(
      (m): m is { name: string; handler: object } =>
        typeof m.handler === 'function' &&
        Reflect.hasMetadata(PATH_METADATA, m.handler),
    )
    .map(({ name, handler }) => {
      const guards = [
        ...metadata(GUARDS_METADATA, controller),
        ...metadata(GUARDS_METADATA, handler),
      ];
      const security = [
        ...metadata(API_SECURITY, controller),
        ...metadata(API_SECURITY, handler),
      ] as Record<string, string[]>[];

      const enforced: AuthMode = guards.includes(JwtAuthGuard)
        ? 'required'
        : guards.includes(OptionalJwtAuthGuard)
          ? 'optional'
          : 'public';
      const bearer = security.some((s) => BEARER_AUTH in s);
      const optional = security.some((s) => Object.keys(s).length === 0);
      const documented: AuthMode = !bearer
        ? 'public'
        : optional
          ? 'optional'
          : 'required';

      return { route: `${controller.name}.${name}`, enforced, documented };
    });
});

describe('Swagger auth matches the guards', () => {
  it('finds every route handler', () => {
    expect(routes.length).toBe(23);
  });

  it('UT-DOC-07 every protected route shows the lock (and only those)', () => {
    const mismatches = routes
      .filter((r) => r.enforced !== r.documented)
      .map((r) => `${r.route}: guard=${r.enforced}, swagger=${r.documented}`);
    expect(mismatches).toEqual([]);
  });

  it('covers all three modes', () => {
    const modes = new Set(routes.map((r) => r.enforced));
    expect([...modes].sort()).toEqual(['optional', 'public', 'required']);
  });
});
