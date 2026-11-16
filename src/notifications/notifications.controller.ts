import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.interface';
import { CurrentUser } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** FR-30, FR-31: booking created / cancelled / status-changed events. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(user, query);
  }

  // Declared before ':id/read' so "read-all" is never parsed as an id.
  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    const count = await this.notifications.markAllRead(user);
    return {
      message: `${count} notification(s) marked as read`,
      data: { updated: count },
    };
  }

  @Patch(':id/read')
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
