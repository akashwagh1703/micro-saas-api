import { Body, Controller, Get, Post, Put, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WhatsappService } from './whatsapp.service';
import { UpdateWhatsAppDto } from './dto/update-whatsapp.dto';

@Controller('whatsapp')
@UseGuards(TokenAuthGuard)
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Get()
  show(@CurrentUser('id') userId: number) {
    return this.service.show(userId);
  }

  @Put()
  update(@CurrentUser('id') userId: number, @Body() dto: UpdateWhatsAppDto) {
    return this.service.update(userId, dto);
  }

  @Post('test')
  async test(@CurrentUser('id') userId: number, @Res() res: Response) {
    const { body, status } = await this.service.test(userId);
    res.status(status).json(body);
  }

  @Post('disconnect')
  disconnect(@CurrentUser('id') userId: number) {
    return this.service.disconnect(userId);
  }
}
