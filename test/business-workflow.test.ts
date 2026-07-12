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
    const nodeIds = (template?.definition.nodes ?? []).map((n) => n.id);
    assert.ok(!nodeTypes.includes('ai'), 'Pending approval flow does not auto-confirm with AI');
    assert.ok(!nodeIds.includes('ai-thanks'));
    assert.equal(nodeTypes[1], 'pick_options', 'Service buttons are the first customer-facing step');
    assert.ok(nodeTypes.includes('pick_options'));
    assert.ok(nodeTypes.includes('list_resources'));
    assert.ok(nodeTypes.includes('list_slots'));
    assert.ok(nodeTypes.includes('book_slot'));
    const bookSlot = (template?.definition.nodes ?? []).find((n) => n.type === 'book_slot');
    assert.equal((bookSlot?.data as Record<string, unknown>)?.status, 'pending');
    assert.ok(!nodeTypes.includes('collect_input'), 'Appointment flow is tap-to-pick only');
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

  it('resolves clinic appointment to live booking template with pending approval', () => {
    assert.equal(resolveTemplateSlug('clinic', 'appointment_booking'), 'clinic-appointment');
    const template = findGuidedTemplate('clinic-appointment');
    assert.ok(template);
    const types = (template?.definition.nodes ?? []).map((n) => n.type);
    assert.ok(!types.includes('ai'));
    assert.ok(types.includes('pick_options'));
    assert.ok(types.includes('book_slot'));
  });

  it('keeps active vertical combo overrides for appointment flows', () => {
    assert.equal(resolveTemplateSlug('coaching', 'appointment_booking'), 'coaching-appointment');
    assert.equal(resolveTemplateSlug('ca_accountant', 'appointment_booking'), 'ca-accountant-appointment');
    assert.equal(resolveTemplateSlug('travel', 'appointment_booking'), 'travel-booking');
    assert.equal(resolveTemplateSlug('real_estate', 'appointment_booking'), 'real-estate-appointment');
    assert.equal(resolveTemplateSlug('local_shop', 'lead_generation'), 'local-shop-support');
  });
});
