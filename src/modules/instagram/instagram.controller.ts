import { Body, Controller, Get, Post, Put, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InstagramService } from './instagram.service';
import { UpdateInstagramDto } from './dto/update-instagram.dto';

@Controller('instagram')
@UseGuards(TokenAuthGuard)
export class InstagramController {
  constructor(private readonly service: InstagramService) {}

  @Get('setup-guide')
  setupGuide(@CurrentUser('id') userId: number) {
    return this.service.setupGuide(userId);
  }

  @Get()
  show(@CurrentUser('id') userId: number) {
    return this.service.show(userId);
  }

  @Put()
  update(@CurrentUser('id') userId: number, @Body() dto: UpdateInstagramDto) {
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
