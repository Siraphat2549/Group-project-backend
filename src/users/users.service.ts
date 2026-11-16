import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TokenInfo } from '../auth/auth-user.interface';
import { isUniqueViolation } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { TokenRevocationService } from '../auth/token-revocation.service';
import { IssuedToken, TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toUserResponse, UserResponse } from './user.mapper';

export interface ProfileUpdateResult {
  user: UserResponse;
  /** Present when email or password changed: the old token no longer fits. */
  token?: IssuedToken;
}

/** A user's own profile (FR-3, FR-4). Callers always pass the id from the JWT. */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly revocations: TokenRevocationService,
  ) {}

  /** FR-3. */
  async getProfile(userId: number): Promise<UserResponse> {
    return toUserResponse(await this.findOrReject(userId));
  }

  /** FR-4. */
  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
    currentToken: TokenInfo,
  ): Promise<ProfileUpdateResult> {
    const user = await this.findOrReject(userId);

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined && dto.name !== user.name) data.name = dto.name;
    const emailChanged = dto.email !== undefined && dto.email !== user.email;
    if (emailChanged) data.email = dto.email;
    const passwordChanged = dto.newPassword !== undefined;

    if (emailChanged || passwordChanged) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          'currentPassword is required to change email or password',
        );
      }
      if (
        !(await this.passwords.verify(dto.currentPassword, user.passwordHash))
      ) {
        this.logger.warn(
          `Profile update rejected: wrong password id=${userId}`,
        );
        throw new UnauthorizedException('Current password is incorrect');
      }
    }
    if (dto.newPassword !== undefined) {
      data.passwordHash = await this.passwords.hash(dto.newPassword);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Nothing to update: send name, email or newPassword with a new value',
      );
    }

    let updated;
    try {
      updated = await this.prisma.user.update({ where: { id: userId }, data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
    this.logger.log(
      `Profile updated: id=${userId} fields=${Object.keys(data)
        .map((field) => (field === 'passwordHash' ? 'password' : field))
        .join(',')}`,
    );

    const result: ProfileUpdateResult = { user: toUserResponse(updated) };
    if (passwordChanged) {
      // Sign out every other session: whoever knew the old password is out.
      try {
        await this.revocations.revokeAllForUser(
          userId,
          currentToken.exp - currentToken.iat,
        );
      } catch {
        this.logger.warn(
          `Could not revoke older tokens after password change: id=${userId}`,
        );
      }
    }
    if (emailChanged || passwordChanged) {
      result.token = await this.tokens.issue(updated);
    }
    return result;
  }

  /** A valid token for a since-deleted account is treated as not logged in. */
  private async findOrReject(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return user;
  }
}
