import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE,
} from '../../auth/dto/auth.dto';
import { trim } from '../../common/utils/transforms';

const NEW_PASSWORD_RULE = PASSWORD_RULE.replace('password', 'newPassword');

/**
 * FR-4. Every field is optional. Changing `email` or setting `newPassword`
 * also requires `currentPassword`, so a stolen token alone cannot take over
 * the account. The role cannot be changed here.
 */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: NEW_PASSWORD_RULE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: NEW_PASSWORD_RULE })
  @Matches(PASSWORD_PATTERN, { message: NEW_PASSWORD_RULE })
  newPassword?: string;
}
