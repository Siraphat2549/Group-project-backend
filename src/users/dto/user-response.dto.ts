import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { UserResponse } from '../user.mapper';

/** Swagger schema of a user. There is deliberately no password field (NFR-4). */
export class UserResponseDto implements UserResponse {
  @ApiProperty({ example: 7 })
  id!: number;

  @ApiProperty({ example: 'Alice' })
  name!: string;

  @ApiProperty({ example: 'alice@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, enumName: 'Role', example: Role.USER })
  role!: Role;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
