import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APPOINTMENT_SERVICES,
  parseAppointmentServicesJson,
  validateAppointmentServices,
  isSchedulingVertical,
} from '../src/platform/appointment-services';
import { parseWhatsAppFormattedText, stripWhatsAppFormatting } from '../src/common/whatsapp-format';

describe('appointment services settings', () => {
  it('parses stored JSON and falls back to vertical defaults', () => {
    const custom = parseAppointmentServicesJson(
      JSON.stringify([{ text: 'Spa', value: 'Spa', description: 'Relax' }]),
      'salon',
    );
    assert.equal(custom.length, 1);
    assert.equal(custom[0].text, 'Spa');

    const fallback = parseAppointmentServicesJson(null, 'clinic');
    assert.deepEqual(fallback, DEFAULT_APPOINTMENT_SERVICES.clinic);
  });

  it('validates service rows and rejects duplicates', () => {
    const ok = validateAppointmentServices([
      { text: 'Haircut', value: 'Haircut' },
      { text: 'Spa', value: 'Spa' },
    ]);
    assert.equal(ok.valid, true);
    assert.equal(ok.services.length, 2);

    const dup = validateAppointmentServices([
      { text: 'Haircut', value: 'Haircut' },
      { text: 'Cut', value: 'haircut' },
    ]);
    assert.equal(dup.valid, false);
    assert.ok(dup.errors.some((e) => e.includes('Duplicate')));
  });

  it('recognizes scheduling verticals', () => {
    assert.equal(isSchedulingVertical('clinic'), true);
    assert.equal(isSchedulingVertical('local_shop'), false);
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
