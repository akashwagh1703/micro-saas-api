import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHttpsImageUrl,
  resolveWelcomeImageUrl,
  shouldAttachWelcomeImage,
} from '../src/modules/workflows/nodes/welcome-image.helpers';

describe('welcome-image.helpers', () => {
  it('accepts https URLs only', () => {
    assert.equal(normalizeHttpsImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(normalizeHttpsImageUrl('http://cdn.example.com/a.jpg'), null);
  });

  it('attaches image for appointment service pick step', () => {
    assert.equal(
      shouldAttachWelcomeImage({ options_source: 'appointment_services' }),
      true,
    );
    assert.equal(
      shouldAttachWelcomeImage({ mode: 'date_quick_pick', options_source: 'appointment_services' }),
      false,
    );
    assert.equal(
      shouldAttachWelcomeImage({
        options_source: 'appointment_services',
        include_welcome_image: false,
      }),
      false,
    );
  });

  it('uses catalog WA logo and never booking welcome image', async () => {
    const settings = {
      get: async () => 'https://cdn.example.com/booking-welcome.jpg',
    };
    const url = await resolveWelcomeImageUrl(
      settings,
      1,
      {
        send_welcome_image: true,
        use_catalog_wa_logo: true,
        welcome_image_url: '{{catalog_wa_logo_url}}',
      },
      { catalog_wa_logo_url: 'https://cdn.example.com/business-logo.jpg' },
    );
    assert.equal(url, 'https://cdn.example.com/business-logo.jpg');

    const missing = await resolveWelcomeImageUrl(
      settings,
      1,
      {
        send_welcome_image: true,
        use_catalog_wa_logo: true,
        welcome_image_url: '{{catalog_wa_logo_url}}',
      },
      { catalog_wa_logo_url: '' },
    );
    assert.equal(missing, null);
  });
});
