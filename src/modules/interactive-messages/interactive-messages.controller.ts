import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { InteractiveMessagesService } from './interactive-messages.service';
import {
  CreateInteractiveTemplateDto,
  UpdateInteractiveTemplateDto,
  InteractiveMessageResponseDto,
  InteractiveTemplateListDto,
  SendInteractiveMessageDto,
} from './dto/interactive-message.dto';

@Controller('interactive-messages')
@UseGuards(TokenAuthGuard)
export class InteractiveMessagesController {
  constructor(private readonly interactiveMessagesService: InteractiveMessagesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(
    @Body() dto: CreateInteractiveTemplateDto,
    @Request() req,
  ): Promise<InteractiveMessageResponseDto> {
    return this.interactiveMessagesService.createTemplate(req.user.id, dto);
  }

  @Get()
  async getUserTemplates(@Request() req): Promise<InteractiveTemplateListDto[]> {
    return this.interactiveMessagesService.getUserTemplates(req.user.id);
  }

  @Get(':id')
  async getTemplate(
    @Param('id') id: string,
    @Request() req,
  ): Promise<InteractiveMessageResponseDto> {
    return this.interactiveMessagesService.getTemplateById(parseInt(id), req.user.id);
  }

  @Put(':id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateInteractiveTemplateDto,
    @Request() req,
  ): Promise<InteractiveMessageResponseDto> {
    return this.interactiveMessagesService.updateTemplate(parseInt(id), req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTemplate(@Param('id') id: string, @Request() req): Promise<void> {
    return this.interactiveMessagesService.deleteTemplate(parseInt(id), req.user.id);
  }

  @Get(':id/validate')
  async validateTemplate(@Param('id') id: string): Promise<{ valid: boolean; errors: string[] }> {
    return this.interactiveMessagesService.validateTemplate(parseInt(id));
  }

  @Post(':id/send')
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: SendInteractiveMessageDto,
    @Request() req,
  ): Promise<{ success: boolean; message: string }> {
    return this.interactiveMessagesService.sendMessage(req.user.id, {
      ...dto,
      templateId: parseInt(id),
    });
  }
}
