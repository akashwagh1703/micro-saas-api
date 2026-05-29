import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('up')
  health() {
    return { status: 'ok' };
  }
}
