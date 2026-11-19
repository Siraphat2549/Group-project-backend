import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import type { LoginResult } from '../auth.service';
import type { IssuedToken } from '../token.service';

/** A freshly signed access token (login, or PATCH /users/me after a change). */
export class IssuedTokenDto implements IssuedToken {
  @ApiProperty({
    description:
      'JWT to send as `Authorization: Bearer <accessToken>` (in Swagger UI: paste it into Authorize)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjd9.signature',
  })
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: 3600,
    description: 'Seconds until the token expires',
  })
  expiresIn!: number;
}

/** Swagger schema of `data` in the POST /auth/login response. */
export class LoginResponseDto extends IssuedTokenDto implements LoginResult {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
