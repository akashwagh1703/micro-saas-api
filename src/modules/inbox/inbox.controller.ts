import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, resolvePage } from '../../common/pagination';
import { serializeConversation, serializeMessage } from '../../common/serializers';
import { InboxService } from './inbox.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('inbox')
@UseGuards(TokenAuthGuard)
export class InboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  @Get('conversations')
  async conversations(
    @CurrentUser('id') userId: number,
    @Query('search') search: string | undefined,
    @Query('page') page: string | undefined,
    @Req() req: Request,
  ) {
    const perPage = 20;
    const currentPage = resolvePage(page);

    const where: Prisma.ConversationWhereInput = { userId };
    if (search) {
      where.contact = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        include: { contact: true },
        orderBy: { lastMessageAt: 'desc' },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return paginate(items, total, currentPage, perPage, this.path(req), serializeConversation);
  }

  @Get('conversations/:conversationId/messages')
  async messages(
    @CurrentUser('id') userId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Query('page') page: string | undefined,
    @Req() req: Request,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('No query results for model [Conversation].');
    }

    const perPage = 50;
    const currentPage = resolvePage(page);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      this.prisma.message.count({ where: { conversationId: conversation.id } }),
    ]);

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: 0 },
    });

    const withContact = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: { contact: true },
    });

    return {
      conversation: serializeConversation(withContact!),
      messages: paginate(items, total, currentPage, perPage, this.path(req), serializeMessage),
    };
  }

  @Post('conversations/:conversationId/send')
  async send(
    @CurrentUser('id') userId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const result = await this.inbox.sendOutgoingMessage(userId, conversationId, dto.content);
    res.status(result.success ? 200 : 422).json({
      success: result.success,
      message: result.message ? serializeMessage(result.message) : null,
      error: result.error,
    });
  }

  private path(req: Request): string {
    return `${req.protocol}://${req.get('host')}${req.path}`;
  }
}
