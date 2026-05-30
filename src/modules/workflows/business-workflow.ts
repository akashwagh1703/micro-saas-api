/**
 * Maps a (business category, use case) pair to a starter workflow template and
 * the business context used to personalize AI node prompts. Used by the guided
 * "generate workflow" flow. Slugs reference WORKFLOW_TEMPLATES or guided templates.
 */

export const BUSINESS_LABELS: Record<string, string> = {
  farmer: 'Farmer / Agriculture',
  real_estate: 'Real Estate',
  coaching: 'Coaching Institute',
  clinic: 'Clinic / Doctor',
  local_shop: 'Local Shop',
  travel: 'Travel Agency',
  insurance: 'Insurance Agent',
  ca_accountant: 'CA / Accountant',
  support: 'Customer Support Team',
  other: 'Business',
};

export const USE_CASE_LABELS: Record<string, string> = {
  customer_support: 'Customer Support',
  lead_generation: 'Lead Generation',
  appointment_booking: 'Appointment Booking',
  sales_assistant: 'Sales Assistant',
  faq_bot: 'FAQ Bot',
  ai_chat: 'AI Chat Assistant',
};

/** Short phrase describing the business, injected into AI prompts. */
const BUSINESS_CONTEXT: Record<string, string> = {
  farmer: 'an agriculture/farming business helping farmers with produce, crops, and supplies',
  real_estate: 'a real estate agency helping clients buy, sell, or rent property',
  coaching: 'a coaching institute helping students with courses, admissions, and schedules',
  clinic: 'a clinic/doctor handling patient queries and appointments',
  local_shop: 'a local shop helping customers with products, prices, and availability',
  travel: 'a travel agency helping customers plan trips, bookings, and itineraries',
  insurance: 'an insurance agent helping clients with policies, claims, and renewals',
  ca_accountant: 'a CA/accountant helping clients with taxes, filings, and financial queries',
  support: 'a customer support team resolving customer issues quickly and politely',
  other: 'a business helping its customers over WhatsApp',
};

/** Fallback template per use case when no guided override matches. */
const USE_CASE_FALLBACK: Record<string, string> = {
  customer_support: 'ai-support-assistant',
  lead_generation: 'lead-capture-api',
  appointment_booking: 'welcome-auto-reply',
  sales_assistant: 'ai-support-assistant',
  faq_bot: 'keyword-faq',
  ai_chat: 'ai-support-assistant',
};

/**
 * Phase 2: curated guided templates per business × use case.
 * Keys are `<business>:<useCase>`. "other" uses generic fallbacks only.
 */
const COMBO_OVERRIDES: Record<string, string> = {
  // Real Estate
  'real_estate:lead_generation': 'real-estate-lead-gen',
  'real_estate:appointment_booking': 'real-estate-appointment',
  'real_estate:faq_bot': 'real-estate-faq',
  'real_estate:customer_support': 'real-estate-appointment',
  'real_estate:sales_assistant': 'real-estate-lead-gen',
  'real_estate:ai_chat': 'real-estate-lead-gen',

  // Clinic
  'clinic:appointment_booking': 'clinic-appointment',
  'clinic:customer_support': 'clinic-support',
  'clinic:lead_generation': 'clinic-appointment',
  'clinic:faq_bot': 'clinic-support',
  'clinic:sales_assistant': 'clinic-support',
  'clinic:ai_chat': 'clinic-support',

  // Coaching
  'coaching:lead_generation': 'coaching-lead-gen',
  'coaching:appointment_booking': 'coaching-appointment',
  'coaching:customer_support': 'coaching-lead-gen',
  'coaching:faq_bot': 'coaching-lead-gen',
  'coaching:sales_assistant': 'coaching-lead-gen',
  'coaching:ai_chat': 'coaching-lead-gen',

  // Local Shop
  'local_shop:faq_bot': 'local-shop-faq',
  'local_shop:customer_support': 'local-shop-support',
  'local_shop:lead_generation': 'local-shop-support',
  'local_shop:appointment_booking': 'local-shop-support',
  'local_shop:sales_assistant': 'local-shop-support',
  'local_shop:ai_chat': 'local-shop-support',

  // Travel
  'travel:appointment_booking': 'travel-booking',
  'travel:lead_generation': 'travel-lead-gen',
  'travel:customer_support': 'travel-booking',
  'travel:faq_bot': 'travel-booking',
  'travel:sales_assistant': 'travel-lead-gen',
  'travel:ai_chat': 'travel-booking',

  // Insurance
  'insurance:lead_generation': 'insurance-lead-gen',
  'insurance:sales_assistant': 'insurance-sales',
  'insurance:customer_support': 'insurance-sales',
  'insurance:faq_bot': 'insurance-lead-gen',
  'insurance:appointment_booking': 'insurance-lead-gen',
  'insurance:ai_chat': 'insurance-sales',

  // Farmer
  'farmer:customer_support': 'farmer-support',
  'farmer:faq_bot': 'farmer-faq',
  'farmer:lead_generation': 'farmer-support',
  'farmer:appointment_booking': 'farmer-support',
  'farmer:sales_assistant': 'farmer-support',
  'farmer:ai_chat': 'farmer-support',

  // CA / Accountant
  'ca_accountant:customer_support': 'ca-accountant-support',
  'ca_accountant:lead_generation': 'ca-accountant-support',
  'ca_accountant:appointment_booking': 'ca-accountant-support',
  'ca_accountant:faq_bot': 'ca-accountant-support',
  'ca_accountant:sales_assistant': 'ca-accountant-support',
  'ca_accountant:ai_chat': 'ca-accountant-support',

  // Customer Support Team (business type)
  'support:customer_support': 'support-team-assistant',
  'support:ai_chat': 'support-team-assistant',
  'support:lead_generation': 'support-team-assistant',
  'support:faq_bot': 'support-team-assistant',
  'support:appointment_booking': 'support-team-assistant',
  'support:sales_assistant': 'support-team-assistant',
};

const DEFAULT_TEMPLATE = 'ai-support-assistant';

/** Phase 4: "Other" businesses get an AI-drafted workflow instead of a generic template. */
export function shouldUseAiGeneration(businessCategory: string): boolean {
  return businessCategory === 'other';
}

/** Resolves the best starter template slug for a business + use case. */
export function resolveTemplateSlug(businessCategory: string, useCase: string): string {
  if (businessCategory === 'other') {
    return USE_CASE_FALLBACK[useCase] ?? DEFAULT_TEMPLATE;
  }
  return (
    COMBO_OVERRIDES[`${businessCategory}:${useCase}`] ??
    USE_CASE_FALLBACK[useCase] ??
    DEFAULT_TEMPLATE
  );
}

export function businessLabel(key: string): string {
  return BUSINESS_LABELS[key] ?? BUSINESS_LABELS.other;
}

export function useCaseLabel(key: string): string {
  return USE_CASE_LABELS[key] ?? 'Automation';
}

/** Sentence prepended to AI node prompts so replies are tailored to the business. */
export function businessPromptPrefix(businessCategory: string): string {
  const context = BUSINESS_CONTEXT[businessCategory] ?? BUSINESS_CONTEXT.other;
  return `You are a WhatsApp assistant for ${context}. Keep replies relevant to this business. `;
}
