import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptureDemoDto, CaptureDemoResponseDto } from './dto/capture-demo.dto';
import { ContactUsDto, ContactUsResponseDto } from './dto/contact-us.dto';
import { UpdateWebsiteLeadDto } from './dto/update-website-lead.dto';
import { randomBytes } from 'crypto';
import * as nodemailer from 'nodemailer';

@Injectable()
export class WebsiteService {
  private readonly logger = new Logger(WebsiteService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.transporter) {
      const smtpHost = this.config.get<string>('SMTP_HOST');
      if (!smtpHost?.trim()) {
        return null;
      }
      
      const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number.isNaN(port) ? 587 : port,
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: this.config.get<string>('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
      });
    }
    return this.transporter;
  }

  private async sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    const transport = this.getTransporter();
    if (!transport) {
      this.logger.warn('SMTP not configured, skipping email notification');
      return false;
    }

    const from =
      this.config.get<string>('SMTP_FROM')?.trim() ??
      this.config.get<string>('SMTP_USER')?.trim() ??
      'noreply@autowave.in';

    try {
      await transport.sendMail({
        from,
        to,
        subject,
        text,
        html: html ?? text.replace(/\n/g, '<br>'),
      });
      this.logger.log(`Email sent successfully to ${to}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error);
      return false;
    }
  }

  private async sendLeadNotificationEmail(lead: any): Promise<void> {
    const salesEmail = this.config.get<string>('SALES_EMAIL') ?? 'sales@autowave.in';
    
    const subject = `New Demo Request: ${lead.name} - ${lead.companyName || lead.businessType}`;
    const text = `
New Demo Request Received

Name: ${lead.name}
Email: ${lead.email}
Phone: ${lead.phone}
Business Type: ${lead.businessType}
Company: ${lead.companyName || 'Not specified'}
Monthly Messages: ${lead.monthlyMessages || 'Not specified'}
Challenge: ${lead.challenge || 'Not specified'}
Source: ${lead.source}
Lead ID: ${lead.id}
Created: ${lead.createdAt}

Please follow up with this lead promptly.
`;

    await this.sendEmail(salesEmail, subject, text);
  }

  private async sendConfirmationEmail(lead: any): Promise<void> {
    const subject = 'Demo Request Confirmed - AutoWave';
    const text = `
Hi ${lead.name},

Thank you for your interest in AutoWave! We've received your demo request and our team will contact you shortly.

Request Details:
- Business Type: ${lead.businessType}
- Company: ${lead.companyName || 'Not specified'}

What happens next:
1. Our team will review your request
2. We'll reach out within 24 hours to schedule your demo
3. You'll receive a calendar invitation with meeting details

If you have any questions in the meantime, feel free to reply to this email.

Best regards,
The AutoWave Team
`;

    await this.sendEmail(lead.email, subject, text);
  }

  private calculateLeadScore(lead: any): number {
    let score = 0;
    
    // Business type scoring (higher value businesses get more points)
    const highValueBusinesses = ['E-commerce', 'Real Estate', 'Healthcare', 'Agency'];
    const mediumValueBusinesses = ['Retail', 'Coaching', 'Consulting', 'Services'];
    
    if (highValueBusinesses.includes(lead.businessType)) {
      score += 30;
    } else if (mediumValueBusinesses.includes(lead.businessType)) {
      score += 20;
    } else {
      score += 10;
    }
    
    // Monthly message volume scoring
    if (lead.monthlyMessages) {
      const messages = parseInt(lead.monthlyMessages);
      if (messages > 10000) score += 25;
      else if (messages > 5000) score += 20;
      else if (messages > 1000) score += 15;
      else if (messages > 500) score += 10;
      else score += 5;
    }
    
    // Challenge description indicates engagement and intent
    if (lead.challenge && lead.challenge.length > 50) {
      score += 20;
    } else if (lead.challenge && lead.challenge.length > 20) {
      score += 10;
    }
    
    // Company name provided indicates established business
    if (lead.companyName && lead.companyName.length > 2) {
      score += 15;
    }
    
    // Phone number validation (Indian numbers starting with 6-9 are valid)
    if (lead.phone && /^[6-9]\d{9}$/.test(lead.phone.replace(/\D/g, ''))) {
      score += 10;
    }
    
    // Cap score at 100
    return Math.min(score, 100);
  }

  /**
   * Capture demo request from marketing website
   * @param dto Demo request data
   * @returns Response with lead ID and confirmation token
   */
  async captureDemoRequest(dto: CaptureDemoDto): Promise<CaptureDemoResponseDto> {
    try {
      // Check if email already exists
      const existingLead = await this.prisma.websiteLead.findUnique({
        where: { email: dto.email },
      });

      if (existingLead) {
        throw new BadRequestException(
          'This email has already been used for a demo request. Please check your email for the confirmation link.'
        );
      }

      // Generate confirmation token
      const confirmationToken = randomBytes(32).toString('hex');

      // Create website lead
      const lead = await this.prisma.websiteLead.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          businessType: dto.businessType,
          companyName: dto.companyName,
          monthlyMessages: dto.monthlyMessages ? parseInt(dto.monthlyMessages) : null,
          challenge: dto.challenge,
          source: dto.source || 'website',
          status: 'new',
          confirmationToken,
          metadata: {
            userAgent: process.env.NODE_ENV,
            timestamp: new Date().toISOString(),
          },
        },
      });

      this.logger.log(`Demo request created: ${lead.id} - ${lead.email}`);

      // Calculate and save lead score
      const score = this.calculateLeadScore(lead);
      const qualification = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
      
      // Note: This requires database migration to add score and qualification fields
      // Run: npx prisma migrate dev --name add_lead_scoring
      try {
        await this.prisma.websiteLead.update({
          where: { id: lead.id },
          data: { 
            score,
            qualification,
          } as any,
        });
      } catch (error) {
        this.logger.warn(`Could not update lead score (migration may be needed): ${error.message}`);
      }

      // Send email notifications
      await this.sendConfirmationEmail(lead);
      await this.sendLeadNotificationEmail(lead);

      return {
        success: true,
        leadId: lead.id,
        confirmationToken: lead.confirmationToken || '',
        message: 'Demo request received! Check your email for confirmation.',
        demoLink: `${process.env.WEBSITE_URL}/demo/confirm/${confirmationToken}`,
      };
    } catch (error) {
      this.logger.error(`Error capturing demo request: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Handle contact form submission
   * @param dto Contact form data
   * @returns Response
   */
  async captureContactForm(dto: ContactUsDto): Promise<ContactUsResponseDto> {
    try {
      const referenceId = randomBytes(6).toString('hex').toUpperCase();

      this.logger.log(`Contact form submitted: ${referenceId} - ${dto.email}`);

      return {
        success: true,
        message: 'Thank you for reaching out! Our team will get back to you within 24 hours.',
        referenceId,
      };
    } catch (error) {
      this.logger.error(`Error capturing contact form: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Confirm demo attendance
   * @param token Confirmation token
   */
  async confirmDemo(token: string): Promise<{ success: boolean; message: string }> {
    try {
      const lead = await this.prisma.websiteLead.findUnique({
        where: { confirmationToken: token },
      });

      if (!lead) {
        throw new BadRequestException('Invalid or expired confirmation link');
      }

      if (lead.demoConfirmed) {
        return {
          success: true,
          message: 'Demo already confirmed. Check your calendar for the link.',
        };
      }

      // Update lead status
      await this.prisma.websiteLead.update({
        where: { id: lead.id },
        data: {
          status: 'demo_confirmed',
          demoConfirmed: true,
        },
      });

      this.logger.log(`Demo confirmed: ${lead.id} - ${lead.email}`);

      return {
        success: true,
        message: 'Demo confirmed! Check your email for the calendar link.',
      };
    } catch (error) {
      this.logger.error(`Error confirming demo: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get all website leads with optional filtering
   */
  async getWebsiteLeads(status?: string, page?: string) {
    const currentPage = page ? parseInt(page) : 1;
    const perPage = 20;
    const skip = (currentPage - 1) * perPage;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.websiteLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.websiteLead.count({ where }),
    ]);

    return {
      data: leads,
      meta: {
        total,
        page: currentPage,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Get website leads statistics
   */
  async getWebsiteLeadsStats() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, thisWeek, newCount, contacted, demoConfirmed, converted, lost] =
      await this.prisma.$transaction([
        this.prisma.websiteLead.count(),
        this.prisma.websiteLead.count({
          where: { createdAt: { gte: weekAgo } },
        }),
        this.prisma.websiteLead.count({ where: { status: 'new' } }),
        this.prisma.websiteLead.count({ where: { status: 'contacted' } }),
        this.prisma.websiteLead.count({ where: { status: 'demo_confirmed' } }),
        this.prisma.websiteLead.count({ where: { status: 'converted' } }),
        this.prisma.websiteLead.count({ where: { status: 'lost' } }),
      ]);

    const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(1) : '0';

    return {
      total,
      thisWeek,
      new: newCount,
      contacted,
      demoConfirmed,
      converted,
      lost,
      conversionRate: parseFloat(conversionRate),
    };
  }

  /**
   * Get specific website lead by ID
   */
  async getWebsiteLead(id: number) {
    const lead = await this.prisma.websiteLead.findUnique({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException('Website lead not found');
    }

    return lead;
  }

  /**
   * Update website lead
   */
  async updateWebsiteLead(id: number, dto: UpdateWebsiteLeadDto) {
    const lead = await this.getWebsiteLead(id);

    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.qualification !== undefined) data.qualification = dto.qualification;
    if (dto.score !== undefined) data.score = dto.score;

    const updated = await this.prisma.websiteLead.update({
      where: { id },
      data,
    });

    this.logger.log(`Website lead updated: ${id} - ${updated.email}`);

    return updated;
  }
}
