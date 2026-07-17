/**
 * Single source of truth for business verticals and use cases.
 * Portal/mobile load via GET /platform/verticals — avoid duplicating lists in the UI.
 */

export type VerticalKind = 'workflow' | 'plugin';

export interface BusinessVerticalDefinition {
  key: string;
  label: string;
  hint: string;
  example: string;
  kind: VerticalKind;
  portal_route?: string;
  skip_workflows?: boolean;
  recommended_use_cases: string[];
  supports_use_case_picker: boolean;
  /** Whitelist of use cases selectable for this vertical (v4). */
  allowed_use_cases: string[];
  /** Max use cases per setup (Option B — per vertical). */
  max_use_cases: number;
  /** Show in new signup wizard when true. */
  visible_in_signup: boolean;
  /** Legacy vertical — existing tenants only when v4 catalog is enabled. */
  deprecated?: boolean;
}

export interface UseCaseDefinition {
  key: string;
  label: string;
  hint: string;
  example: string;
  visible_in_signup: boolean;
  deprecated?: boolean;
}

export const CATALOG_VERSION = 2;

const ACTIVE_USE_CASE_KEYS = [
  'appointment_booking',
  'lead_generation',
  'customer_support',
] as const;

export const USE_CASE_DEFINITIONS: UseCaseDefinition[] = [
  {
    key: 'appointment_booking',
    label: 'Appointment Booking',
    hint: 'Collect date, time, and details for bookings.',
    example: 'Doctor visit, barber slot, site tour.',
    visible_in_signup: true,
  },
  {
    key: 'lead_generation',
    label: 'Lead Generation',
    hint: 'Capture name, phone, and interest from new chats.',
    example: 'Property enquiry, course demo, travel quote.',
    visible_in_signup: true,
  },
  {
    key: 'customer_support',
    label: 'Customer Support',
    hint: 'Answer questions and resolve issues automatically.',
    example: 'Order status, complaints, general help.',
    visible_in_signup: true,
  },
  {
    key: 'faq_bot',
    label: 'FAQ Bot',
    hint: 'Instant answers to common repeated questions.',
    example: 'Timings, prices, location, policies.',
    visible_in_signup: false,
    deprecated: true,
  },
  {
    key: 'sales_assistant',
    label: 'Sales Assistant',
    hint: 'Qualify buyers and suggest next steps.',
    example: 'Product recommendations, upsell, follow-up.',
    visible_in_signup: false,
    deprecated: true,
  },
  {
    key: 'ai_chat',
    label: 'AI Chat Assistant',
    hint: 'Flexible AI replies for open-ended conversations.',
    example: 'When customers ask varied or complex questions.',
    visible_in_signup: false,
    deprecated: true,
  },
];

export const BUSINESS_VERTICALS: BusinessVerticalDefinition[] = [
  {
    key: 'career_ai',
    label: 'CareerAI Bot',
    hint: 'Job seekers on WhatsApp — resumes, 65%+ matches, cover letters.',
    example: 'Upload resume → matched jobs → apply with cover letter.',
    kind: 'plugin',
    portal_route: '/career-ai',
    skip_workflows: true,
    recommended_use_cases: ['ai_chat'],
    supports_use_case_picker: false,
    allowed_use_cases: ['ai_chat'],
    max_use_cases: 1,
    visible_in_signup: true,
  },
  {
    key: 'salon',
    label: 'Salon / Beauty',
    hint: 'Haircuts, styling, and barber appointments on WhatsApp.',
    example: 'Customers book a barber and time slot.',
    kind: 'workflow',
    recommended_use_cases: ['appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['appointment_booking'],
    max_use_cases: 1,
    visible_in_signup: true,
  },
  {
    key: 'clinic',
    label: 'Clinic / Doctor',
    hint: 'Appointments, timings, reports, and patient queries.',
    example: 'Patients book doctor slots or ask clinic hours.',
    kind: 'workflow',
    recommended_use_cases: ['appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['appointment_booking', 'customer_support'],
    max_use_cases: 1,
    visible_in_signup: true,
  },
  {
    key: 'coaching',
    label: 'Coaching Institute',
    hint: 'Courses, admissions, batch timings, and demo classes.',
    example: 'Students ask about fees or book a trial session.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['lead_generation', 'appointment_booking'],
    max_use_cases: 2,
    visible_in_signup: true,
  },
  {
    key: 'real_estate',
    label: 'Real Estate',
    hint: 'Property listings, site visits, and buyer enquiries.',
    example: 'Leads ask for flats or book a property tour.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['lead_generation', 'appointment_booking'],
    max_use_cases: 2,
    visible_in_signup: true,
  },
  {
    key: 'ca_accountant',
    label: 'CA / Accountant',
    hint: 'Tax filing, GST, documents, and consultation slots.',
    example: 'Clients book a tax consultation slot.',
    kind: 'workflow',
    recommended_use_cases: ['appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['appointment_booking'],
    max_use_cases: 1,
    visible_in_signup: true,
  },
  {
    key: 'sports_turf',
    label: 'Sports Turf / Ground',
    hint: 'Book cricket, football, or multi-sport turf slots on WhatsApp.',
    example: 'Players pick turf, date, and time slot for hourly booking.',
    kind: 'workflow',
    recommended_use_cases: ['appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['appointment_booking'],
    max_use_cases: 1,
    visible_in_signup: true,
  },
  {
    key: 'travel',
    label: 'Travel Agency',
    hint: 'Trip packages, bookings, itineraries, and quotes.',
    example: 'Customers enquire about destinations or book a call.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'appointment_booking'],
    supports_use_case_picker: true,
    allowed_use_cases: ['lead_generation', 'appointment_booking'],
    max_use_cases: 2,
    visible_in_signup: true,
  },
  {
    key: 'local_shop',
    label: 'Local Shop',
    hint: 'Product enquiries, orders, and customer help.',
    example: 'Shoppers ask about products or delivery.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation'],
    supports_use_case_picker: true,
    allowed_use_cases: ['lead_generation', 'customer_support'],
    max_use_cases: 1,
    visible_in_signup: true,
  },
  {
    key: 'farmer',
    label: 'Farmer / Agriculture',
    hint: 'Sell seeds, fertilizers, or advise on crops and seasons.',
    example: 'Customers ask about prices, availability, and farming tips.',
    kind: 'workflow',
    recommended_use_cases: ['faq_bot', 'customer_support'],
    supports_use_case_picker: true,
    allowed_use_cases: ['faq_bot', 'customer_support', 'lead_generation', 'appointment_booking'],
    max_use_cases: 2,
    visible_in_signup: false,
    deprecated: true,
  },
  {
    key: 'insurance',
    label: 'Insurance Agent',
    hint: 'Policies, renewals, claims, and premium quotes.',
    example: 'Clients ask about coverage, documents, or renewal.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'customer_support'],
    supports_use_case_picker: true,
    allowed_use_cases: ['lead_generation', 'customer_support', 'appointment_booking'],
    max_use_cases: 2,
    visible_in_signup: false,
    deprecated: true,
  },
  {
    key: 'support',
    label: 'Customer Support Team',
    hint: 'Resolve tickets, FAQs, and follow-ups on WhatsApp.',
    example: 'Users report issues or ask how to use your product.',
    kind: 'workflow',
    recommended_use_cases: ['customer_support', 'faq_bot'],
    supports_use_case_picker: true,
    allowed_use_cases: ['customer_support', 'faq_bot', 'lead_generation'],
    max_use_cases: 2,
    visible_in_signup: false,
    deprecated: true,
  },
  {
    key: 'other',
    label: 'Other business',
    hint: 'Any business not listed above — we generate a custom flow.',
    example: 'Describe your business and we tailor workflows with AI.',
    kind: 'workflow',
    recommended_use_cases: ['ai_chat', 'customer_support'],
    supports_use_case_picker: true,
    allowed_use_cases: ['ai_chat', 'customer_support', 'lead_generation', 'appointment_booking'],
    max_use_cases: 2,
    visible_in_signup: false,
    deprecated: true,
  },
];

export const BUSINESS_CATEGORY_KEYS = BUSINESS_VERTICALS.map((v) => v.key);
export const USE_CASE_KEYS = USE_CASE_DEFINITIONS.map((u) => u.key);
export const SIGNUP_USE_CASE_KEYS = USE_CASE_DEFINITIONS.filter((u) => u.visible_in_signup).map(
  (u) => u.key,
);

export function getVertical(key: string): BusinessVerticalDefinition | undefined {
  return BUSINESS_VERTICALS.find((v) => v.key === key);
}

export function getUseCase(key: string): UseCaseDefinition | undefined {
  return USE_CASE_DEFINITIONS.find((u) => u.key === key);
}

export function isPluginVertical(key: string): boolean {
  return getVertical(key)?.kind === 'plugin';
}

export function getSignupVerticals(): BusinessVerticalDefinition[] {
  return BUSINESS_VERTICALS.filter((v) => v.visible_in_signup !== false);
}

export function getSignupUseCases(): UseCaseDefinition[] {
  return USE_CASE_DEFINITIONS.filter((u) => u.visible_in_signup);
}

export function verticalProfileFields(
  businessCategory: string | null,
): {
  max_use_cases?: number;
  allowed_use_cases?: string[];
  vertical_deprecated?: boolean;
} {
  if (!businessCategory) return {};
  const vertical = getVertical(businessCategory);
  if (!vertical) return {};
  return {
    max_use_cases: vertical.max_use_cases,
    allowed_use_cases: [...vertical.allowed_use_cases],
    vertical_deprecated: !!vertical.deprecated,
  };
}

export function serializePlatformCatalog() {
  return {
    verticals: BUSINESS_VERTICALS,
    use_cases: USE_CASE_DEFINITIONS,
    version: CATALOG_VERSION,
    active_use_cases: [...ACTIVE_USE_CASE_KEYS],
  };
}
