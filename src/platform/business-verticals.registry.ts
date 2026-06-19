/**
 * Single source of truth for business verticals and use cases.
 * Portal loads this via GET /platform/verticals — avoid duplicating lists in the UI.
 */

export type VerticalKind = 'workflow' | 'plugin';

export interface BusinessVerticalDefinition {
  key: string;
  label: string;
  hint: string;
  example: string;
  /** workflow = standard auto-replies; plugin = dedicated product surface (e.g. CareerAI). */
  kind: VerticalKind;
  /** Portal route when kind is plugin. */
  portal_route?: string;
  /** Hide workflow builder nav for plugin verticals. */
  skip_workflows?: boolean;
  recommended_use_cases: string[];
  supports_use_case_picker: boolean;
}

export interface UseCaseDefinition {
  key: string;
  label: string;
  hint: string;
  example: string;
}

export const USE_CASE_DEFINITIONS: UseCaseDefinition[] = [
  {
    key: 'customer_support',
    label: 'Customer Support',
    hint: 'Answer questions and resolve issues automatically.',
    example: 'Order status, complaints, general help.',
  },
  {
    key: 'lead_generation',
    label: 'Lead Generation',
    hint: 'Capture name, phone, and interest from new chats.',
    example: 'Property enquiry, course demo, insurance quote.',
  },
  {
    key: 'appointment_booking',
    label: 'Appointment Booking',
    hint: 'Collect date, time, and details for bookings.',
    example: 'Doctor visit, site tour, tax consultation.',
  },
  {
    key: 'sales_assistant',
    label: 'Sales Assistant',
    hint: 'Qualify buyers and suggest next steps.',
    example: 'Product recommendations, upsell, follow-up.',
  },
  {
    key: 'faq_bot',
    label: 'FAQ Bot',
    hint: 'Instant answers to common repeated questions.',
    example: 'Timings, prices, location, policies.',
  },
  {
    key: 'ai_chat',
    label: 'AI Chat Assistant',
    hint: 'Flexible AI replies for open-ended conversations.',
    example: 'When customers ask varied or complex questions.',
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
  },
  {
    key: 'farmer',
    label: 'Farmer / Agriculture',
    hint: 'Sell seeds, fertilizers, or advise on crops and seasons.',
    example: 'Customers ask about prices, availability, and farming tips.',
    kind: 'workflow',
    recommended_use_cases: ['faq_bot', 'customer_support'],
    supports_use_case_picker: true,
  },
  {
    key: 'real_estate',
    label: 'Real Estate',
    hint: 'Property listings, site visits, and buyer enquiries.',
    example: 'Leads ask for flats, rent, or booking a property tour.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'appointment_booking'],
    supports_use_case_picker: true,
  },
  {
    key: 'coaching',
    label: 'Coaching Institute',
    hint: 'Courses, admissions, batch timings, and demo classes.',
    example: 'Students ask about fees, syllabus, or trial sessions.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'appointment_booking'],
    supports_use_case_picker: true,
  },
  {
    key: 'clinic',
    label: 'Clinic / Doctor',
    hint: 'Appointments, timings, reports, and general queries.',
    example: 'Patients book slots or ask clinic hours and location.',
    kind: 'workflow',
    recommended_use_cases: ['appointment_booking', 'faq_bot'],
    supports_use_case_picker: true,
  },
  {
    key: 'local_shop',
    label: 'Local Shop',
    hint: 'Product catalog, prices, stock, and order updates.',
    example: 'Shoppers ask "Do you have this?" or delivery time.',
    kind: 'workflow',
    recommended_use_cases: ['faq_bot', 'customer_support'],
    supports_use_case_picker: true,
  },
  {
    key: 'travel',
    label: 'Travel Agency',
    hint: 'Trip packages, bookings, itineraries, and quotes.',
    example: 'Customers enquire about destinations and travel dates.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'appointment_booking'],
    supports_use_case_picker: true,
  },
  {
    key: 'insurance',
    label: 'Insurance Agent',
    hint: 'Policies, renewals, claims, and premium quotes.',
    example: 'Clients ask about coverage, documents, or renewal.',
    kind: 'workflow',
    recommended_use_cases: ['lead_generation', 'customer_support'],
    supports_use_case_picker: true,
  },
  {
    key: 'ca_accountant',
    label: 'CA / Accountant',
    hint: 'Tax filing, GST, documents, and consultation slots.',
    example: 'Clients share queries about ITR, GST, or deadlines.',
    kind: 'workflow',
    recommended_use_cases: ['appointment_booking', 'customer_support'],
    supports_use_case_picker: true,
  },
  {
    key: 'support',
    label: 'Customer Support Team',
    hint: 'Resolve tickets, FAQs, and follow-ups on WhatsApp.',
    example: 'Users report issues or ask how to use your product.',
    kind: 'workflow',
    recommended_use_cases: ['customer_support', 'faq_bot'],
    supports_use_case_picker: true,
  },
  {
    key: 'other',
    label: 'Other business',
    hint: 'Any business not listed above — we generate a custom flow.',
    example: 'Describe your business and we tailor workflows with AI.',
    kind: 'workflow',
    recommended_use_cases: ['ai_chat', 'customer_support'],
    supports_use_case_picker: true,
  },
];

export const BUSINESS_CATEGORY_KEYS = BUSINESS_VERTICALS.map((v) => v.key);
export const USE_CASE_KEYS = USE_CASE_DEFINITIONS.map((u) => u.key);

export function getVertical(key: string): BusinessVerticalDefinition | undefined {
  return BUSINESS_VERTICALS.find((v) => v.key === key);
}

export function isPluginVertical(key: string): boolean {
  return getVertical(key)?.kind === 'plugin';
}

export function serializePlatformCatalog() {
  return {
    verticals: BUSINESS_VERTICALS,
    use_cases: USE_CASE_DEFINITIONS,
    version: 1,
  };
}
