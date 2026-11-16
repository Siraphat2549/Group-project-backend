import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Profile endpoints. Auth services and guards come from the global AuthModule. */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
