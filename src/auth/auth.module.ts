import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard } from './guards';

/**
 * Auth contract used by rooms/bookings/notifications: JWT verification,
 * role checks, @CurrentUser. Sign-up / login / logout / profile (FR-1..4)
 * plug into this module (add controller + service here).
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1h') as never,
        },
      }),
    }),
  ],
  providers: [JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard],
})
export class AuthModule {}
