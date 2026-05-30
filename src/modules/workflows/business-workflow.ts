/**
 * Maps a (business category, use case) pair to a starter workflow template and
 * the business context used to personalize AI node prompts. Used by the guided
 * "generate workflow" flow. Slugs reference WORKFLOW_TEMPLATES.
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

/** Fallback template per use case when no specific combo override matches. */
const USE_CASE_FALLBACK: Record<string, string> = {
  customer_support: 'ai-support-assistant',
  lead_generation: 'lead-capture-api',
  appointment_booking: 'welcome-auto-reply',
  sales_assistant: 'ai-support-assistant',
  faq_bot: 'keyword-faq',
  ai_chat: 'ai-support-assistant',
};

/** Hand-picked overrides for high-value combinations (`<business>:<useCase>`). */
const COMBO_OVERRIDES: Record<string, string> = {
  'real_estate:lead_generation': 'lead-capture-api',
  'insurance:lead_generation': 'lead-capture-api',
  'local_shop:faq_bot': 'keyword-faq',
  'clinic:appointment_booking': 'welcome-auto-reply',
  'coaching:lead_generation': 'lead-capture-api',
  'local_shop:customer_support': 'order-status-inquiry',
};

const DEFAULT_TEMPLATE = 'ai-support-assistant';

/** Resolves the best starter template slug for a business + use case. */
export function resolveTemplateSlug(businessCategory: string, useCase: string): string {
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
