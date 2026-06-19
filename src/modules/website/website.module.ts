import { Module } from '@nestjs/common';
import { WebsiteController } from './website.controller';
import { WebsiteService } from './website.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [WebsiteController],
  providers: [WebsiteService, PrismaService],
  exports: [WebsiteService],
})
export class WebsiteModule {}
