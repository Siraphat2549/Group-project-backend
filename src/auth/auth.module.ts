import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard } from './guards';
import { PasswordService } from './password.service';
import { TokenRevocationService } from './token-revocation.service';
import { TokenService } from './token.service';

/**
 * Authentication and authorization for the whole API:
 *
 * - `/auth/register`, `/auth/login`, `/auth/logout` (FR-1, FR-2)
 * - `JwtAuthGuard` / `OptionalJwtAuthGuard` / `RolesGuard` + `@Roles`,
 *   `@CurrentUser` used by rooms, bookings, notifications and users
 *
 * Global, so feature modules can use the guards without importing it.
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
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    TokenRevocationService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    JwtModule,
    PasswordService,
    TokenService,
    TokenRevocationService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
