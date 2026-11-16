import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import type { AuthUser, TokenInfo } from './auth-user.interface';
import { AuthService } from './auth.service';
import { CurrentToken, CurrentUser } from './decorators';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** FR-1. 201 with the new user (never the password); 409 if the email is taken. */
  @Post('register')
  @RateLimit('auth')
  async register(@Body() dto: RegisterDto) {
    return {
      message: 'Account created successfully',
      data: await this.auth.register(dto),
    };
  }

  /** FR-2. 200 with a Bearer token; 401 for a wrong email or password. */
  @Post('login')
  @RateLimit('auth')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return {
      message: 'Login successful',
      data: await this.auth.login(dto),
    };
  }

  /** FR-2. Revokes the token sent in the Authorization header. */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthUser,
    @CurrentToken() token: TokenInfo,
  ) {
    await this.auth.logout(user, token);
    return { message: 'Logged out successfully' };
  }
}
