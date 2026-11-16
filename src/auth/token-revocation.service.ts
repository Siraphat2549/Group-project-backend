import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { TokenInfo } from './auth-user.interface';

const revokedTokenKey = (jti: string) => `auth:revoked:${jti}`;
const revokedBeforeKey = (userId: number) => `auth:revoked-before:${userId}`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Makes stateless JWTs revocable (FR-2 logout) without a database lookup on
 * every request. Two kinds of marker live in Redis, both expiring on their
 * own once the tokens they cover would have expired anyway:
 *
 * - `auth:revoked:<jti>`           one token, written by logout
 * - `auth:revoked-before:<userId>` every token of a user issued before a
 *                                  moment, written when the password changes
 *
 * Shared through Redis, so a logout is honoured by every API instance.
 */
@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Revokes one token until its natural expiry. Throws when Redis is
   * unreachable, so logout never reports a success it cannot guarantee.
   */
  async revoke(token: TokenInfo): Promise<void> {
    const ttl = token.exp - nowSeconds();
    if (ttl <= 0) return; // already expired, nothing left to revoke
    if (!token.jti) return; // cannot happen for tokens issued by login
    await this.redis.client.set(revokedTokenKey(token.jti), '1', 'EX', ttl);
  }

  /**
   * Revokes every token `userId` holds that was issued before now.
   * `maxTokenLifetime` (seconds) bounds how long the marker must live.
   */
  async revokeAllForUser(
    userId: number,
    maxTokenLifetime: number,
  ): Promise<void> {
    await this.redis.client.set(
      revokedBeforeKey(userId),
      String(nowSeconds()),
      'EX',
      Math.max(maxTokenLifetime, 1),
    );
  }

  /**
   * Checked by the JWT guards on every authenticated request (one MGET).
   *
   * If Redis is down the check is skipped ("fail open"): a logged-out token
   * then stays usable until it expires (JWT_EXPIRES_IN), which we accept so
   * a cache outage cannot lock every user out of bookings (NFR-9).
   */
  async isRevoked(userId: number, token: TokenInfo): Promise<boolean> {
    // RedisService already logged the outage once; stay quiet per request.
    if (!this.redis.isReady) return false;
    try {
      const [revokedBefore, revoked] = await this.redis.client.mget(
        revokedBeforeKey(userId),
        ...(token.jti ? [revokedTokenKey(token.jti)] : []),
      );
      if (revoked != null) return true;
      // Same-second tokens pass, so the token issued right after a password
      // change is usable immediately.
      return revokedBefore !== null && token.iat < Number(revokedBefore);
    } catch (error) {
      this.logger.warn(
        `Token revocation check skipped: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
