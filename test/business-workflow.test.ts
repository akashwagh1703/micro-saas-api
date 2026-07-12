import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUseCaseTriggerKeywords,
  businessLabel,
  businessPromptPrefix,
  resolveTemplateSlug,
  USE_CASE_TRIGGER_KEYWORDS,
  useCaseLabel,
} from '../src/modules/workflows/business-workflow';
import { findGuidedTemplate } from '../src/modules/workflows/business-workflow-templates';

describe('business workflow templates', () => {
  it('resolves salon appointment to salon-appointment slug', () => {
    assert.equal(resolveTemplateSlug('salon', 'appointment_booking'), 'salon-appointment');
  });

  it('exposes salon-appointment guided template with live booking nodes', () => {
    const template = findGuidedTemplate('salon-appointment');
    assert.ok(template);
    assert.equal(template?.name, 'Salon Appointment Booking');
    assert.equal(template?.category, 'guided');

    const nodeTypes = (template?.definition.nodes ?? []).map((n) => n.type);
    assert.deepEqual(nodeTypes, [
      'trigger',
      'collect_input',
      'collect_input',
      'list_resources',
      'list_slots',
      'book_slot',
      'save_lead',
      'send_message',
    ]);
  });

  it('labels salon setup workflow name parts', () => {
    assert.equal(businessLabel('salon'), 'Salon / Beauty');
    assert.equal(useCaseLabel('appointment_booking'), 'Appointment Booking');
    assert.match(
      businessPromptPrefix('salon'),
      /salon\/beauty business managing barber\/stylist appointments/i,
    );
  });

  it('includes salon booking keywords on appointment_booking triggers', () => {
    for (const keyword of ['slot', 'barber', 'stylist', 'haircut']) {
      assert.ok(USE_CASE_TRIGGER_KEYWORDS.appointment_booking.includes(keyword));
    }

    const template = findGuidedTemplate('salon-appointment');
    assert.ok(template);
    const withKeywords = applyUseCaseTriggerKeywords(
      template!.definition,
      'appointment_booking',
    );
    const trigger = withKeywords.nodes?.find((n) => n.type === 'trigger');
    const keywords = String(trigger?.data?.keywords ?? '');
    assert.ok(keywords.includes('barber'));
    assert.ok(keywords.includes('haircut'));
  });

  it('keeps active vertical combo overrides for appointment flows', () => {
    assert.equal(resolveTemplateSlug('clinic', 'appointment_booking'), 'clinic-appointment');
    assert.equal(resolveTemplateSlug('coaching', 'appointment_booking'), 'coaching-appointment');
    assert.equal(resolveTemplateSlug('ca_accountant', 'appointment_booking'), 'ca-accountant-support');
    assert.equal(resolveTemplateSlug('local_shop', 'lead_generation'), 'local-shop-support');
  });
});
