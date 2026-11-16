import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { AuthUser, TokenInfo } from '../auth/auth-user.interface';
import { CurrentToken, CurrentUser } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
  async getProfile(@CurrentUser() user: AuthUser) {
    return { data: await this.users.getProfile(user.id) };
  }

  /**
   * FR-4. Changing email or password needs `currentPassword` and returns a
   * fresh `token`; a password change also signs out all other sessions.
   */
  @Patch()
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
