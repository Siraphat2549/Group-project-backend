import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import {
  ApiAuth,
  ApiConflict,
  ApiDataResponse,
  ApiMessageResponse,
  ApiRateLimited,
  ApiUnauthorized,
  ApiUnavailable,
  ApiValidationError,
} from '../swagger/api-docs.decorators';
import { UserResponseDto } from '../users/dto/user-response.dto';
import type { AuthUser, TokenInfo } from './auth-user.interface';
import { AuthService } from './auth.service';
import { CurrentToken, CurrentUser } from './decorators';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtAuthGuard } from './guards';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** FR-1. 201 with the new user (never the password); 409 if the email is taken. */
  @Post('register')
  @RateLimit('auth')
  @ApiOperation({
    summary: 'Sign up',
    description:
      'Creates a **Regular User** account. Sending a `role` is rejected; Admins come from the seed script.',
  })
  @ApiDataResponse(201, UserResponseDto, {
    description: 'Account created (the password is never returned)',
    message: 'Account created successfully',
  })
  @ApiValidationError()
  @ApiConflict('Email is already registered')
  @ApiRateLimited()
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
  @ApiOperation({
    summary: 'Log in',
    description:
      'Returns a JWT. In Swagger UI: copy `data.accessToken`, click **Authorize**, paste it, then call the endpoints with a lock.',
  })
  @ApiDataResponse(200, LoginResponseDto, {
    description: 'Logged in',
    message: 'Login successful',
  })
  @ApiValidationError()
  @ApiUnauthorized('Invalid email or password (same answer for both)')
  @ApiRateLimited()
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
  @ApiOperation({
    summary: 'Log out',
    description:
      'Revokes the token in the `Authorization` header; it returns 401 from then on. Other sessions stay logged in.',
  })
  @ApiAuth()
  @ApiMessageResponse(200, 'Logged out', 'Logged out successfully')
  @ApiUnavailable('Token store (Redis) is down; try again')
  async logout(
    @CurrentUser() user: AuthUser,
    @CurrentToken() token: TokenInfo,
  ) {
    await this.auth.logout(user, token);
    return { message: 'Logged out successfully' };
  }
}
