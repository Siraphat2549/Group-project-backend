import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';

/**
 * Password hashing (NFR-1). bcrypt embeds a random per-password salt and the
 * cost factor in the hash, so equal passwords produce different hashes and
 * the cost can be raised later without a migration.
 */
@Injectable()
export class PasswordService {
  private readonly rounds: number;
  /** Compared against when the email is unknown, see `verify`. */
  private dummyHash?: Promise<string>;

  constructor(config: ConfigService) {
    this.rounds = config.get<number>('BCRYPT_ROUNDS', 12);
  }

  hash(password: string): Promise<string> {
    return hash(password, this.rounds);
  }

  /**
   * Checks a password against a stored hash. With no hash (unknown email) it
   * still spends the same time hashing, so response time does not reveal
   * whether an account exists.
   */
  async verify(password: string, passwordHash?: string): Promise<boolean> {
    if (passwordHash === undefined) {
      this.dummyHash ??= this.hash('no-such-user');
      await compare(password, await this.dummyHash);
      return false;
    }
    return compare(password, passwordHash);
  }
}
