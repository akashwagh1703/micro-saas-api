import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WebsiteService } from './website.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('WebsiteService', () => {
  let service: WebsiteService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebsiteService,
        {
          provide: PrismaService,
          useValue: {
            websiteLead: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'WEBSITE_URL') return 'https://autowave.playltp.in';
              if (key === 'SMTP_HOST') return '';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebsiteService>(WebsiteService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('captureDemoRequest', () => {
    it('should create a new demo request', async () => {
      const dto = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        businessType: 'healthcare',
        companyName: 'Health Clinic',
        challenge: 'Missed appointments',
      };

      const mockLead = {
        id: 1,
        ...dto,
        source: 'website',
        status: 'new',
        confirmationToken: 'abc123',
        score: 55,
        qualification: 'warm',
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        monthlyMessages: null,
        demoDate: null,
        demoConfirmed: false,
        metadata: {},
      };

      jest.spyOn(prismaService.websiteLead, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prismaService.websiteLead, 'create').mockResolvedValue(mockLead);

      const result = await service.captureDemoRequest(dto);

      expect(result.success).toBe(true);
      expect(result.leadId).toBe(1);
      expect(result.message).toContain('Demo request received');
      expect(prismaService.websiteLead.create).toHaveBeenCalled();
    });

    it('should throw error for duplicate email', async () => {
      const dto = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        businessType: 'healthcare',
      };

      jest.spyOn(prismaService.websiteLead, 'findUnique').mockResolvedValue({
        id: 1,
        name: 'Jane Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        businessType: 'retail',
        companyName: null,
        monthlyMessages: null,
        challenge: null,
        source: 'website',
        status: 'new',
        score: 0,
        qualification: 'cold',
        notes: null,
        demoDate: null,
        demoConfirmed: false,
        confirmationToken: 'old-token',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(service.captureDemoRequest(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmDemo', () => {
    it('should confirm demo successfully', async () => {
      const token = 'valid-token-123';
      const mockLead = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        businessType: 'healthcare',
        companyName: null,
        monthlyMessages: null,
        challenge: null,
        source: 'website',
        status: 'new',
        score: 40,
        qualification: 'warm',
        notes: null,
        demoDate: null,
        demoConfirmed: false,
        confirmationToken: token,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.websiteLead, 'findUnique').mockResolvedValue(mockLead);
      jest.spyOn(prismaService.websiteLead, 'update').mockResolvedValue({
        ...mockLead,
        status: 'demo_confirmed',
        demoConfirmed: true,
      });

      const result = await service.confirmDemo(token);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Demo confirmed');
      expect(prismaService.websiteLead.update).toHaveBeenCalled();
    });

    it('should throw error for invalid token', async () => {
      jest.spyOn(prismaService.websiteLead, 'findUnique').mockResolvedValue(null);

      await expect(service.confirmDemo('invalid-token')).rejects.toThrow(BadRequestException);
    });
  });
});
