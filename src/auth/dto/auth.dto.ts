import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { trim } from '../../common/utils/transforms';

/** Emails are compared case-insensitively: stored and looked up in lower case. */
export const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt only reads the first 72 bytes, so longer input would be misleading. */
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_RULE =
  'password must be 8-72 characters and contain at least one letter and one number';

/** FR-1. The role is never accepted from the client: sign-up always creates a Regular User. */
export class RegisterDto {
  @ApiProperty({ example: 'Alice', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'alice@example.com',
    format: 'email',
    maxLength: 255,
    description: 'Case-insensitive; must not be registered yet',
  })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'Secret123',
    format: 'password',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'At least one letter and one number',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_RULE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE })
  password!: string;
}

/** FR-2. No password rules here: an old or wrong password is simply a 401. */
export class LoginDto {
  @ApiProperty({ example: 'user@hotel.test', format: 'email' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'User12345', format: 'password' })
  @IsString()
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
