import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebsiteController } from './website.controller';
import { WebsiteService } from './website.service';
import { CaptureDemoDto } from './dto/capture-demo.dto';

/** Minimal mock — tracks calls without Jest (project uses node:test). */
function createWebsiteServiceMock() {
  const calls = {
    captureDemoRequest: [] as CaptureDemoDto[],
    confirmDemo: [] as string[],
    getWebsiteLeads: [] as Array<[string | undefined, string | undefined, string | undefined]>,
    getWebsiteLeadsStats: [] as number[],
    getWebsiteLead: [] as number[],
    updateWebsiteLead: [] as Array<[number, unknown]>,
  };

  const mock = {
    calls,
    captureDemoRequest: async (dto: CaptureDemoDto) => {
      calls.captureDemoRequest.push(dto);
      return {
        success: true,
        leadId: 1,
        message: 'Demo request received!',
        demoLink: 'https://autowave.playltp.in/demo/confirm/?token=abc123',
      };
    },
    confirmDemo: async (token: string) => {
      calls.confirmDemo.push(token);
      return { success: true, message: 'Demo confirmed!' };
    },
    getWebsiteLeads: async (status?: string, page?: string, search?: string) => {
      calls.getWebsiteLeads.push([status, page, search]);
      return { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } };
    },
    getWebsiteLeadsStats: async () => {
      calls.getWebsiteLeadsStats.push(1);
      return { total: 0, new: 0 };
    },
    getWebsiteLead: async (id: number) => {
      calls.getWebsiteLead.push(id);
      return { id, email: 'lead@example.com' };
    },
    updateWebsiteLead: async (id: number, dto: unknown) => {
      calls.updateWebsiteLead.push([id, dto]);
      return { id, status: 'contacted' };
    },
  };

  return mock as unknown as WebsiteService & { calls: typeof calls };
}

describe('WebsiteController', () => {
  let controller: WebsiteController;
  let serviceMock: ReturnType<typeof createWebsiteServiceMock>;

  beforeEach(() => {
    serviceMock = createWebsiteServiceMock();
    controller = new WebsiteController(serviceMock);
  });

  it('should be defined', () => {
    assert.ok(controller);
  });

  describe('getWebsiteConfig', () => {
    it('returns website configuration with industries and pricing', async () => {
      const config = await controller.getWebsiteConfig();
      assert.ok(config.apiUrl);
      assert.ok(config.websiteUrl);
      assert.equal(config.industries.length, 6);
      assert.ok(config.pricing);
      assert.equal(config.features.demoRequest, true);
    });

    it('includes expected industry ids', async () => {
      const config = await controller.getWebsiteConfig();
      const ids = config.industries.map((i: { id: string }) => i.id);
      assert.deepEqual(
        ids.sort(),
        ['agency', 'coaching', 'healthcare', 'other', 'real-estate', 'retail'].sort(),
      );
    });
  });

  describe('captureDemoRequest', () => {
    it('delegates to WebsiteService with the DTO', async () => {
      const dto: CaptureDemoDto = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+919876543210',
        businessType: 'healthcare',
        companyName: 'Health Clinic',
        source: 'website',
      };

      const result = await controller.captureDemoRequest(dto);

      assert.equal(result.success, true);
      assert.equal(result.leadId, 1);
      assert.equal(serviceMock.calls.captureDemoRequest.length, 1);
      assert.deepEqual(serviceMock.calls.captureDemoRequest[0], dto);
    });
  });

  describe('confirmDemo', () => {
    it('delegates to WebsiteService with the token', async () => {
      const token = 'valid-token-123';
      const result = await controller.confirmDemo(token);

      assert.equal(result.success, true);
      assert.deepEqual(serviceMock.calls.confirmDemo, [token]);
    });
  });

  describe('admin lead endpoints', () => {
    it('getWebsiteLeads forwards status, page, and search query params', async () => {
      await controller.getWebsiteLeads('new', '2', 'acme');
      assert.deepEqual(serviceMock.calls.getWebsiteLeads, [['new', '2', 'acme']]);
    });

    it('getWebsiteLeadsStats delegates to service', async () => {
      await controller.getWebsiteLeadsStats();
      assert.equal(serviceMock.calls.getWebsiteLeadsStats.length, 1);
    });

    it('getWebsiteLead parses id and delegates', async () => {
      await controller.getWebsiteLead('7');
      assert.deepEqual(serviceMock.calls.getWebsiteLead, [7]);
    });

    it('updateWebsiteLead parses id and forwards dto', async () => {
      const dto = { status: 'contacted' };
      await controller.updateWebsiteLead('9', dto as never);
      assert.deepEqual(serviceMock.calls.updateWebsiteLead, [[9, dto]]);
    });
  });
});
