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
import { serializeLead } from '../../common/serializers';
import { LeadsService } from './leads.service';
import { SaveLeadDto, UpdateLeadDto } from './dto/lead.dto';

@Controller('leads')
@UseGuards(TokenAuthGuard)
export class LeadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  @Get('stats')
  async stats(@CurrentUser('id') userId: number) {
    return this.leads.stats(userId);
  }

  @Get('export')
  async export(
    @CurrentUser('id') userId: number,
    @Query('status') status: string | undefined,
    @Query('channel') channel: string | undefined,
    @Res() res: Response,
  ) {
    const where: Prisma.LeadWhereInput = { userId };
    if (status) where.status = status;
    if (channel) where.channel = channel;

    const items = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const csv = this.leads.buildExportCsv(items);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(csv);
  }

  @Get()
  async index(
    @CurrentUser('id') userId: number,
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Query('channel') channel: string | undefined,
    @Query('page') page: string | undefined,
    @Req() req: Request,
  ) {
    const perPage = 20;
    const currentPage = resolvePage(page);

    const where: Prisma.LeadWhereInput = { userId };
    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { sourceMessage: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      this.prisma.lead.count({ where }),
    ]);

    const path = `${req.protocol}://${req.get('host')}${req.path}`;
    return paginate(items, total, currentPage, perPage, path, serializeLead);
  }

  @Post('save')
  async save(@CurrentUser('id') userId: number, @Body() dto: SaveLeadDto) {
    const lead = await this.leads.save(userId, dto);
    return { lead: serializeLead(lead) };
  }

  @Post('whatsapp')
  async createWhatsApp(@CurrentUser('id') userId: number, @Body() dto: SaveLeadDto) {
    const lead = await this.leads.save(userId, { ...dto, channel: dto.channel ?? 'whatsapp' });
    return { lead: serializeLead(lead) };
  }

  @Post()
  async store(@CurrentUser('id') userId: number, @Body() dto: SaveLeadDto) {
    const lead = await this.leads.save(userId, dto);
    return { lead: serializeLead(lead) };
  }

  @Get(':id')
  async show(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    const lead = await this.prisma.lead.findFirst({ where: { userId, id } });
    if (!lead) {
      throw new NotFoundException('No query results for model [Lead].');
    }
    return { lead: serializeLead(lead) };
  }

  @Patch(':id')
  async update(
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadDto,
  ) {
    const lead = await this.leads.update(userId, id, dto);
    return { lead: serializeLead(lead) };
  }

  @Delete(':id')
  async destroy(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    await this.leads.findOrFail(userId, id);
    await this.prisma.lead.delete({ where: { id } });
    return { message: 'Lead deleted' };
  }
}
