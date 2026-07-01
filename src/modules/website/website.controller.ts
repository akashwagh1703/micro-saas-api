import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, Logger, BadRequestException, Patch, Query, UseGuards } from '@nestjs/common';
import { WebsiteService } from './website.service';
import { CaptureDemoDto, CaptureDemoResponseDto } from './dto/capture-demo.dto';
import { ContactUsDto, ContactUsResponseDto } from './dto/contact-us.dto';
import { UpdateWebsiteLeadDto } from './dto/update-website-lead.dto';
import { TokenAuthGuard } from '../../common/guards/token-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
  ): Promise<CaptureDemoResponseDto> {
    this.logger.log(`Demo request received: ${dto.email}`);
    return this.websiteService.captureDemoRequest(dto);
  }

  /**
   * POST /api/website/leads/contact-us
   * Handle contact form submission
   */
  @Post('leads/contact-us')
  @HttpCode(HttpStatus.CREATED)
  async captureContactForm(
    @Body() dto: ContactUsDto,
  ): Promise<ContactUsResponseDto> {
    this.logger.log(`Contact form received: ${dto.email}`);
    return this.websiteService.captureContactForm(dto);
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
    return {
      apiUrl: process.env.API_URL || 'https://api.autowave.playltp.in',
      websiteUrl: process.env.WEBSITE_URL || 'https://autowave.playltp.in',
      features: {
        demoRequest: true,
        contactForm: true,
        trialSignup: true,
      },
      industries: [
        { id: 'healthcare', label: 'Healthcare Clinic', color: '#06B6D4' },
        { id: 'retail', label: 'Retail Shop', color: '#EC4899' },
        { id: 'coaching', label: 'Coaching Center', color: '#9333EA' },
        { id: 'real-estate', label: 'Real Estate Agent', color: '#F59E0B' },
        { id: 'agency', label: 'Agency/Freelancer', color: '#3B82F6' },
      ],
      pricing: {
        trial: {
          days: 14,
          price: 0,
        },
        plans: [
          {
            name: 'Starter',
            price: 499,
            currency: 'INR',
            period: 'month',
            features: ['Up to 10 workflows', '1000 conversations/month', 'Basic support'],
          },
          {
            name: 'Business',
            price: 2499,
            currency: 'INR',
            period: 'month',
            features: ['Unlimited workflows', 'Unlimited conversations', 'Priority support', 'Custom integration'],
          },
        ],
      },
    };
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  async health(): Promise<{ status: string; message: string }> {
    return {
      status: 'ok',
      message: 'Website API is running',
    };
  }

  /**
   * GET /api/website/leads
   * Get all website leads (admin only)
   */
  @Get('leads')
  @UseGuards(TokenAuthGuard)
  async getWebsiteLeads(
    @CurrentUser('id') userId: number,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.websiteService.getWebsiteLeads(status, page);
  }

  /**
   * GET /api/website/leads/stats
   * Get website leads statistics (admin only)
   */
  @Get('leads/stats')
  @UseGuards(TokenAuthGuard)
  async getWebsiteLeadsStats(@CurrentUser('id') userId: number) {
    return this.websiteService.getWebsiteLeadsStats();
  }

  /**
   * GET /api/website/leads/:id
   * Get specific website lead (admin only)
   */
  @Get('leads/:id')
  @UseGuards(TokenAuthGuard)
  async getWebsiteLead(
    @CurrentUser('id') userId: number,
    @Param('id') id: string,
  ) {
    return this.websiteService.getWebsiteLead(parseInt(id));
  }

  /**
   * PATCH /api/website/leads/:id
   * Update website lead (admin only)
   */
  @Patch('leads/:id')
  @UseGuards(TokenAuthGuard)
  async updateWebsiteLead(
    @CurrentUser('id') userId: number,
    @Param('id') id: string,
    @Body() dto: UpdateWebsiteLeadDto,
  ) {
    return this.websiteService.updateWebsiteLead(parseInt(id), dto);
  }
}
