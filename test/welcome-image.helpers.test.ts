import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHttpsImageUrl,
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
});
