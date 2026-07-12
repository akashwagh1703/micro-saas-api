export interface AppointmentServiceOption {
  text: string;
  description?: string;
  value: string;
}

export const APPOINTMENT_SERVICES_SETTING_KEY = 'appointment_services';
/** @deprecated Use appointment_services — kept for migration */
export const SALON_SERVICES_SETTING_KEY = 'salon_services';

export const SCHEDULING_VERTICALS = [
  'salon',
  'clinic',
  'coaching',
  'real_estate',
  'ca_accountant',
  'travel',
] as const;

export type SchedulingVertical = (typeof SCHEDULING_VERTICALS)[number];

export function isSchedulingVertical(
  businessCategory: string | null | undefined,
): businessCategory is SchedulingVertical {
  return !!businessCategory && (SCHEDULING_VERTICALS as readonly string[]).includes(businessCategory);
}

export const DEFAULT_APPOINTMENT_SERVICES: Record<SchedulingVertical, AppointmentServiceOption[]> = {
  salon: [
    { text: 'Haircut', description: 'Classic cut & finish', value: 'Haircut' },
    { text: 'Beard trim', description: 'Shape & tidy', value: 'Beard trim' },
    { text: 'Styling', description: 'Blow-dry & style', value: 'Styling' },
  ],
  clinic: [
    { text: 'Consultation', description: 'General visit', value: 'Consultation' },
    { text: 'Follow-up', description: 'Review visit', value: 'Follow-up' },
    { text: 'Health check', description: 'Routine checkup', value: 'Health check' },
    { text: 'Vaccination', description: 'Immunization', value: 'Vaccination' },
  ],
  coaching: [
    { text: 'Demo class', description: 'Free trial session', value: 'Demo class' },
    { text: 'Counselling', description: 'Course guidance', value: 'Counselling' },
    { text: 'Batch trial', description: 'Try a batch', value: 'Batch trial' },
    { text: 'Doubt session', description: 'Q&A with faculty', value: 'Doubt session' },
  ],
  real_estate: [
    { text: 'Site visit', description: 'Property tour', value: 'Site visit' },
    { text: 'Virtual tour', description: 'Online walkthrough', value: 'Virtual tour' },
    { text: 'Consultation', description: 'Buying advice', value: 'Consultation' },
  ],
  ca_accountant: [
    { text: 'Tax consult', description: 'ITR & planning', value: 'Tax consult' },
    { text: 'GST filing', description: 'GST compliance', value: 'GST filing' },
    { text: 'Audit review', description: 'Audit support', value: 'Audit review' },
  ],
  travel: [
    { text: 'Trip planning', description: 'Custom itinerary', value: 'Trip planning' },
    { text: 'Visa help', description: 'Visa guidance', value: 'Visa help' },
    { text: 'Package quote', description: 'Tour packages', value: 'Package quote' },
  ],
};

const MAX_SERVICES = 10;
const MAX_TEXT_LEN = 20;
const MAX_DESC_LEN = 72;
const MAX_VALUE_LEN = 40;

export function normalizeAppointmentServiceRow(raw: unknown): AppointmentServiceOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const text = String(row.text ?? row.label ?? '').trim();
  const value = String(row.value ?? text).trim();
  if (!text || !value) return null;
  const description = row.description != null ? String(row.description).trim() : undefined;
  return {
    text: text.slice(0, MAX_TEXT_LEN),
    value: value.slice(0, MAX_VALUE_LEN),
    ...(description ? { description: description.slice(0, MAX_DESC_LEN) } : {}),
  };
}

export function defaultServicesForVertical(
  businessCategory: string | null | undefined,
): AppointmentServiceOption[] {
  if (isSchedulingVertical(businessCategory)) {
    return [...DEFAULT_APPOINTMENT_SERVICES[businessCategory]];
  }
  return [...DEFAULT_APPOINTMENT_SERVICES.salon];
}

export function parseAppointmentServicesJson(
  raw: string | null | undefined,
  businessCategory?: string | null,
): AppointmentServiceOption[] {
  const fallback = defaultServicesForVertical(businessCategory);
  if (!raw?.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const rows = parsed
      .map(normalizeAppointmentServiceRow)
      .filter((r): r is AppointmentServiceOption => r != null);
    return rows.length > 0 ? rows : fallback;
  } catch {
    return fallback;
  }
}

export function validateAppointmentServices(services: unknown): {
  valid: boolean;
  services: AppointmentServiceOption[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!Array.isArray(services)) {
    return { valid: false, services: [], errors: ['Services must be an array.'] };
  }
  if (services.length < 1) errors.push('Add at least one service.');
  if (services.length > MAX_SERVICES) errors.push(`You can add up to ${MAX_SERVICES} services.`);

  const rows: AppointmentServiceOption[] = [];
  const seen = new Set<string>();

  services.forEach((item, index) => {
    const row = normalizeAppointmentServiceRow(item);
    if (!row) {
      errors.push(`Service ${index + 1}: name is required.`);
      return;
    }
    const key = row.value.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Duplicate service value: ${row.value}`);
    } else {
      seen.add(key);
    }
    rows.push(row);
  });

  return { valid: errors.length === 0, services: rows, errors };
}
