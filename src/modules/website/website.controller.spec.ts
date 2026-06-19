import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { WebsiteController } from './website.controller';
import { WebsiteService } from './website.service';

describe('WebsiteController', () => {
  let app: INestApplication;
  let controller: WebsiteController;
  let service: WebsiteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebsiteController],
      providers: [
        {
          provide: WebsiteService,
          useValue: {
            captureDemoRequest: jest.fn(),
            captureContactForm: jest.fn(),
            confirmDemo: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WebsiteController>(WebsiteController);
    service = module.get<WebsiteService>(WebsiteService);
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('health', () => {
    it('should return health status', async () => {
      const result = await controller.health();
      expect(result.status).toBe('ok');
      expect(result.message).toBe('Website API is running');
    });
  });

  describe('getWebsiteConfig', () => {
    it('should return website configuration', async () => {
      const config = await controller.getWebsiteConfig();
      expect(config.apiUrl).toBeDefined();
      expect(config.websiteUrl).toBeDefined();
      expect(config.industries).toBeDefined();
      expect(config.industries.length).toBe(5);
      expect(config.pricing).toBeDefined();
    });

    it('should include all industries', async () => {
      const config = await controller.getWebsiteConfig();
      const industries = config.industries.map((i: any) => i.id);
      expect(industries).toContain('healthcare');
      expect(industries).toContain('retail');
      expect(industries).toContain('coaching');
      expect(industries).toContain('real-estate');
      expect(industries).toContain('agency');
    });
  });

  describe('captureDemoRequest', () => {
    it('should call service with correct DTO', async () => {
      const dto = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        businessType: 'healthcare',
      };

      const mockResponse = {
        success: true,
        leadId: 1,
        confirmationToken: 'abc123',
        message: 'Demo request received!',
        demoLink: 'https://autowave.in/demo/confirm/abc123',
      };

      jest.spyOn(service, 'captureDemoRequest').mockResolvedValue(mockResponse);

      const result = await controller.captureDemoRequest(dto);

      expect(result).toEqual(mockResponse);
      expect(service.captureDemoRequest).toHaveBeenCalledWith(dto);
    });
  });

  describe('captureContactForm', () => {
    it('should call service with correct DTO', async () => {
      const dto = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        subject: 'Integration help',
        message: 'Can I integrate?',
      };

      const mockResponse = {
        success: true,
        message: 'Thank you for reaching out!',
        referenceId: 'A1B2C3D4',
      };

      jest.spyOn(service, 'captureContactForm').mockResolvedValue(mockResponse);

      const result = await controller.captureContactForm(dto);

      expect(result).toEqual(mockResponse);
      expect(service.captureContactForm).toHaveBeenCalledWith(dto);
    });
  });

  describe('confirmDemo', () => {
    it('should confirm demo with valid token', async () => {
      const token = 'valid-token-123';
      const mockResponse = {
        success: true,
        message: 'Demo confirmed!',
      };

      jest.spyOn(service, 'confirmDemo').mockResolvedValue(mockResponse);

      const result = await controller.confirmDemo(token);

      expect(result).toEqual(mockResponse);
      expect(service.confirmDemo).toHaveBeenCalledWith(token);
    });
  });
});
