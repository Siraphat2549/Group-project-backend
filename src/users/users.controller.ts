import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, getSchemaPath } from '@nestjs/swagger';
import type { AuthUser, TokenInfo } from '../auth/auth-user.interface';
import { CurrentToken, CurrentUser } from '../auth/decorators';
import { IssuedTokenDto } from '../auth/dto/login-response.dto';
import { JwtAuthGuard } from '../auth/guards';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import {
  ApiAuth,
  ApiConflict,
  ApiDataResponse,
  ApiRateLimited,
  ApiValidationError,
} from '../swagger/api-docs.decorators';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

/**
 * The logged-in user's own profile. There is no `/users/:id`: the id always
 * comes from the verified token, so one user can never read or change
 * another user's data (FR-6).
 */
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** FR-3. */
  @Get()
  @ApiOperation({
    summary: 'View my profile',
    description: 'The user is taken from the token, never from the URL.',
  })
  @ApiAuth()
  @ApiDataResponse(200, UserResponseDto, { description: 'Your own profile' })
  async getProfile(@CurrentUser() user: AuthUser) {
    return { data: await this.users.getProfile(user.id) };
  }

  /**
   * FR-4. Changing email or password needs `currentPassword` and returns a
   * fresh `token`; a password change also signs out all other sessions.
   */
  @Patch()
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Send any of `name`, `email`, `newPassword`. Changing `email` or the password requires `currentPassword` and returns a fresh `token` (use it from now on); a password change signs out every other session. The role cannot be changed.',
  })
  @ApiAuth('Missing or invalid token, or `currentPassword` is incorrect')
  @ApiDataResponse(200, UserResponseDto, {
    description: 'Profile updated',
    message: 'Profile updated successfully',
    extra: {
      token: {
        allOf: [{ $ref: getSchemaPath(IssuedTokenDto) }],
        description:
          'Only when the email or password changed: the new token to use from now on',
      },
    },
  })
  @ApiExtraModels(IssuedTokenDto)
  @ApiValidationError(
    'Invalid data, nothing to update, or `currentPassword` missing',
  )
  @ApiConflict('Email is already registered')
  @ApiRateLimited()
  @RateLimit('auth') // currentPassword is checked here: same guessing risk as login
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @CurrentToken() token: TokenInfo,
    @Body() dto: UpdateProfileDto,
  ) {
    const result = await this.users.updateProfile(user.id, dto, token);
    return {
      message: 'Profile updated successfully',
      data: result.user,
      ...(result.token ? { token: result.token } : {}),
    };
  }
}
