import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtPayload } from './auth-user.interface';

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  /** Lifetime in seconds, derived from JWT_EXPIRES_IN. */
  expiresIn: number;
}

/** Signs access tokens. Secret and lifetime come from AuthModule's JwtModule. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(user: Pick<User, 'id' | 'email' | 'role'>): Promise<IssuedToken> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      // Unique id, so logout can revoke this token and no other.
      jti: randomUUID(),
    };
    const accessToken = await this.jwt.signAsync(payload);
    const { iat = 0, exp = 0 } = this.jwt.decode<JwtPayload>(accessToken);
    return { accessToken, tokenType: 'Bearer', expiresIn: exp - iat };
  }
}
