import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, resolvePage } from '../../common/pagination';
import { serializeContact, serializeMessage } from '../../common/serializers';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@Controller('contacts')
@UseGuards(TokenAuthGuard)
export class ContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async index(
    @CurrentUser('id') userId: number,
    @Query('search') search: string | undefined,
    @Query('tag') tag: string | undefined,
    @Query('page') page: string | undefined,
    @Req() req: Request,
  ) {
    const perPage = 15;
    const currentPage = resolvePage(page);

    const where: Prisma.ContactWhereInput = { userId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (tag) {
      where.tags = { array_contains: tag };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      this.prisma.contact.count({ where }),
    ]);

    const path = `${req.protocol}://${req.get('host')}${req.path}`;
    return paginate(items, total, currentPage, perPage, path, serializeContact);
  }

  @Post()
  async store(@CurrentUser('id') userId: number, @Body() dto: CreateContactDto) {
    const contact = await this.prisma.contact.create({
      data: {
        userId,
        name: dto.name ?? null,
        phone: dto.phone.replace(/\D/g, ''),
        email: dto.email ?? null,
        tags: dto.tags ?? undefined,
        notes: dto.notes ?? null,
      },
    });
    return { contact: serializeContact(contact) };
  }

  @Get(':id')
  async show(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    const contact = await this.findOrFail(userId, id);
    const messages = await this.prisma.message.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      contact: serializeContact(contact),
      recent_messages: messages.map(serializeMessage),
    };
  }

  @Put(':id')
  @Patch(':id')
  async update(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContactDto,
  ) {
    await this.findOrFail(userId, id);

    const data: Prisma.ContactUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone.replace(/\D/g, '');
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.tags !== undefined) data.tags = dto.tags ?? undefined;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const contact = await this.prisma.contact.update({ where: { id }, data });
    return { contact: serializeContact(contact) };
  }

  @Delete(':id')
  async destroy(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.findOrFail(userId, id);
    await this.prisma.contact.delete({ where: { id } });
    return { message: 'Contact deleted' };
  }

  private async findOrFail(userId: number, id: number) {
    const contact = await this.prisma.contact.findFirst({ where: { userId, id } });
    if (!contact) {
      throw new NotFoundException('No query results for model [Contact].');
    }
    return contact;
  }
}
