import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toBool } from '../../common/utils/transforms';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  /** Only unread events. */
  @ApiPropertyOptional({ example: true, description: 'Only unread events' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unread?: boolean;

  /** Admin only: events of every user. Ignored for regular users. */
  @ApiPropertyOptional({
    example: false,
    description: 'Admin only: events of every user. Ignored for regular users',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  all?: boolean;
}
