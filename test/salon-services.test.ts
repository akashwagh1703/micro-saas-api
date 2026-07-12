import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SALON_SERVICES,
  parseSalonServicesJson,
  validateSalonServices,
} from '../src/platform/salon-services';
import { parseWhatsAppFormattedText, stripWhatsAppFormatting } from '../src/common/whatsapp-format';

describe('salon services settings', () => {
  it('parses stored JSON and falls back to defaults', () => {
    const custom = parseSalonServicesJson(
      JSON.stringify([{ text: 'Spa', value: 'Spa', description: 'Relax' }]),
    );
    assert.equal(custom.length, 1);
    assert.equal(custom[0].text, 'Spa');

    const fallback = parseSalonServicesJson(null);
    assert.deepEqual(fallback, DEFAULT_SALON_SERVICES);
  });

  it('validates service rows and rejects duplicates', () => {
    const ok = validateSalonServices([
      { text: 'Haircut', value: 'Haircut' },
      { text: 'Spa', value: 'Spa' },
    ]);
    assert.equal(ok.valid, true);
    assert.equal(ok.services.length, 2);

    const dup = validateSalonServices([
      { text: 'Haircut', value: 'Haircut' },
      { text: 'Cut', value: 'haircut' },
    ]);
    assert.equal(dup.valid, false);
    assert.ok(dup.errors.some((e) => e.includes('Duplicate')));
  });

  it('truncates long titles for WhatsApp list rows', () => {
    const result = validateSalonServices([
      { text: 'Very long service name here', value: 'long', description: 'x'.repeat(100) },
    ]);
    assert.equal(result.services[0].text.length, 20);
    assert.equal(result.services[0].description?.length, 72);
  });
});

describe('whatsapp message formatting', () => {
  it('parses bold markers into segments', () => {
    const lines = parseWhatsAppFormattedText('Hello *World*');
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], [
      { text: 'Hello ' },
      { text: 'World', bold: true },
    ]);
  });

  it('preserves newlines across lines', () => {
    const lines = parseWhatsAppFormattedText('Line one\nLine *two*');
    assert.equal(lines.length, 2);
    assert.equal(lines[0][0].text, 'Line one');
    assert.equal(lines[1][1].bold, true);
  });

  it('strips markers for plain preview', () => {
    assert.equal(stripWhatsAppFormatting('Hi *{{business_name}}*!'), 'Hi {{business_name}}!');
  });
});
