import { ApiProperty } from '@nestjs/swagger';
import { NotificationEvent, NotificationType } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

/** A booking event recorded for the frontend (FR-30, FR-31). */
export class NotificationResponseDto implements NotificationEvent {
  @ApiProperty({ example: 31 })
  id!: number;

  @ApiProperty({ example: 7, description: 'Owner of the booking' })
  userId!: number;

  @ApiProperty({ example: 12 })
  bookingId!: number;

  @ApiProperty({
    enum: NotificationType,
    enumName: 'NotificationType',
    example: NotificationType.BOOKING_CREATED,
  })
  type!: NotificationType;

  @ApiProperty({
    example:
      'Booking #12 for "Deluxe 501" (2026-12-01 to 2026-12-03) was created and is pending approval',
  })
  message!: string;

  @ApiProperty({ example: false })
  isRead!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class NotificationsMetaDto extends PaginationMetaDto {
  @ApiProperty({
    example: 2,
    description: 'Your unread notifications (all pages)',
  })
  unreadCount!: number;
}

export class MarkAllReadResultDto {
  @ApiProperty({ example: 3, description: 'Notifications marked as read' })
  updated!: number;
}
