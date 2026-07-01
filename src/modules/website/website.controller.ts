import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, Logger, Patch, Query, UseGuards, Headers, Res } from '@nestjs/common';
import { Response } from 'express';
import { WebsiteService } from './website.service';
import { CaptureDemoDto, CaptureDemoResponseDto } from './dto/capture-demo.dto';
import { UpdateWebsiteLeadDto } from './dto/update-website-lead.dto';
import { buildWebsitePublicConfig } from './website.config';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';

/**
 * Website Controller
 * Public endpoints for marketing website lead capture
 */
@Controller('website')
export class WebsiteController {
  private readonly logger = new Logger(WebsiteController.name);

  constructor(private readonly websiteService: WebsiteService) {}

  /**
   * POST /api/website/leads/capture-demo
   * Capture demo request from marketing website
   */
  @Post('leads/capture-demo')
  @HttpCode(HttpStatus.CREATED)
  async captureDemoRequest(
    @Body() dto: CaptureDemoDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<CaptureDemoResponseDto> {
    this.logger.log(`Demo request received: ${dto.email}`);
    return this.websiteService.captureDemoRequest(dto, userAgent);
  }

  /**
   * GET /api/website/leads/confirm/:token
   * Confirm demo attendance via email link
   */
  @Get('leads/confirm/:token')
  @HttpCode(HttpStatus.OK)
  async confirmDemo(
    @Param('token') token: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Demo confirmation requested with token: ${token.substring(0, 8)}...`);
    return this.websiteService.confirmDemo(token);
  }

  /**
   * GET /api/website/config
   * Get public website configuration
   */
  @Get('config')
  @HttpCode(HttpStatus.OK)
  async getWebsiteConfig(): Promise<any> {
    return buildWebsitePublicConfig();
  }

  /**
   * GET /api/website/leads
   * Get all website leads (super-admin only)
   */
  @Get('leads')
  @UseGuards(TokenAuthGuard, SuperAdminGuard)
  async getWebsiteLeads(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.websiteService.getWebsiteLeads(status, page, search);
  }

  /**
   * GET /api/website/leads/stats
   * Get website leads statistics (super-admin only)
   */
  @Get('leads/stats')
  @UseGuards(TokenAuthGuard, SuperAdminGuard)
  async getWebsiteLeadsStats() {
    return this.websiteService.getWebsiteLeadsStats();
  }

  /**
   * GET /api/website/leads/export
   * Export website leads as CSV (super-admin only)
   */
  @Get('leads/export')
  @UseGuards(TokenAuthGuard, SuperAdminGuard)
  async exportWebsiteLeads(
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.websiteService.exportWebsiteLeads(status, search);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="website-leads.csv"');
    res.send(csv);
  }

  /**
   * GET /api/website/leads/:id
   * Get specific website lead (super-admin only)
   */
  @Get('leads/:id')
  @UseGuards(TokenAuthGuard, SuperAdminGuard)
  async getWebsiteLead(@Param('id') id: string) {
    return this.websiteService.getWebsiteLead(parseInt(id));
  }

  /**
   * PATCH /api/website/leads/:id
   * Update website lead (super-admin only)
   */
  @Patch('leads/:id')
  @UseGuards(TokenAuthGuard, SuperAdminGuard)
  async updateWebsiteLead(
    @Param('id') id: string,
    @Body() dto: UpdateWebsiteLeadDto,
  ) {
    return this.websiteService.updateWebsiteLead(parseInt(id), dto);
  }
}
