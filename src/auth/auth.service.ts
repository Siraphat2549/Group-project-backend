import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUserResponse, UserResponse } from '../users/user.mapper';
import { AuthUser, TokenInfo } from './auth-user.interface';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { TokenRevocationService } from './token-revocation.service';
import { IssuedToken, TokenService } from './token.service';

export interface LoginResult extends IssuedToken {
  user: UserResponse;
}

/** Prisma's "unique constraint failed" error. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Sign-up, login and logout (FR-1, FR-2). Logs record who did what by user
 * id only - never passwords, hashes or tokens (NFR-4, NFR-15).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly revocations: TokenRevocationService,
  ) {}

  /** FR-1. Always creates a Regular User; admins come from the seed script. */
  async register(dto: RegisterDto): Promise<UserResponse> {
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: { name: dto.name, email: dto.email, passwordHash },
      });
      this.logger.log(`User registered: id=${user.id}`);
      return toUserResponse(user);
    } catch (error) {
      // The unique index decides, so two simultaneous sign-ups with the same
      // email cannot both succeed (no check-then-insert race).
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  /**
   * FR-2. Unknown email and wrong password give the same 401 and take the
   * same time, so the endpoint cannot be used to find registered emails.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const valid = await this.passwords.verify(dto.password, user?.passwordHash);
    if (!user || !valid) {
      this.logger.warn(
        `Login failed: ${user ? `id=${user.id}` : 'unknown email'}`,
      );
      throw new UnauthorizedException('Invalid email or password');
    }
    this.logger.log(`Login succeeded: id=${user.id}`);
    return { ...(await this.tokens.issue(user)), user: toUserResponse(user) };
  }

  /** FR-2. Revokes the presented token until it would have expired anyway. */
  async logout(user: AuthUser, token: TokenInfo): Promise<void> {
    if (!token.jti) {
      throw new BadRequestException('This token cannot be revoked');
    }
    try {
      await this.revocations.revoke(token);
    } catch {
      // Better an honest error than a "logged out" the server cannot enforce.
      throw new ServiceUnavailableException(
        'Logout is temporarily unavailable, please try again',
      );
    }
    this.logger.log(`Logout: id=${user.id}`);
  }
}
