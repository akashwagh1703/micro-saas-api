import { Module } from '@nestjs/common';
import { InteractiveMessagesService } from './interactive-messages.service';
import { InteractiveMessagesController } from './interactive-messages.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InteractiveMessagesController],
  providers: [InteractiveMessagesService],
  exports: [InteractiveMessagesService],
})
export class InteractiveMessagesModule {}
