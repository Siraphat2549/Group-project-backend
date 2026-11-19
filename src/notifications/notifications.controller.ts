import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.interface';
import { CurrentUser } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards';
import {
  ApiAuth,
  ApiDataResponse,
  ApiNotFound,
  ApiPaginatedResponse,
  ApiValidationError,
} from '../swagger/api-docs.decorators';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import {
  MarkAllReadResultDto,
  NotificationResponseDto,
  NotificationsMetaDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** FR-30, FR-31: booking created / cancelled / status-changed events. */
  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description:
      'Booking events (`BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_STATUS_CHANGED`), newest first. Admins may add `all=true` to see every user.',
  })
  @ApiAuth()
  @ApiPaginatedResponse(
    NotificationResponseDto,
    'Notifications, paginated, with `meta.unreadCount`',
    NotificationsMetaDto,
  )
  @ApiValidationError('Invalid query parameter')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(user, query);
  }

  // Declared before ':id/read' so "read-all" is never parsed as an id.
  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiAuth()
  @ApiDataResponse(200, MarkAllReadResultDto, {
    description: 'All your unread notifications are now read',
    message: '3 notification(s) marked as read',
  })
  async markAllRead(@CurrentUser() user: AuthUser) {
    const count = await this.notifications.markAllRead(user);
    return {
      message: `${count} notification(s) marked as read`,
      data: { updated: count },
    };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiAuth()
  @ApiDataResponse(200, NotificationResponseDto, {
    description: 'Notification marked as read',
    message: 'Notification marked as read',
  })
  @ApiValidationError('id must be a number')
  @ApiNotFound('Notification (or it belongs to another user)')
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return {
      message: 'Notification marked as read',
      data: await this.notifications.markRead(user, id),
    };
  }
}
