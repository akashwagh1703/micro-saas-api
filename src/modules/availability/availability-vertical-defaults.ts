/** Per-vertical defaults for slot length and resource type labels (v4). */

export interface VerticalAvailabilityDefaults {
  defaultSlotMinutes: number;
  resourceType: string;
  resourceLabel: string;
}

export const VERTICAL_AVAILABILITY_DEFAULTS: Record<string, VerticalAvailabilityDefaults> = {
  salon: { defaultSlotMinutes: 30, resourceType: 'barber', resourceLabel: 'Barber' },
  clinic: { defaultSlotMinutes: 15, resourceType: 'doctor', resourceLabel: 'Doctor' },
  coaching: { defaultSlotMinutes: 60, resourceType: 'counselor', resourceLabel: 'Counselor' },
  real_estate: { defaultSlotMinutes: 45, resourceType: 'agent', resourceLabel: 'Agent' },
  ca_accountant: { defaultSlotMinutes: 30, resourceType: 'consultant', resourceLabel: 'Consultant' },
  travel: { defaultSlotMinutes: 30, resourceType: 'agent', resourceLabel: 'Agent' },
};

export const DEFAULT_AVAILABILITY: VerticalAvailabilityDefaults = {
  defaultSlotMinutes: 30,
  resourceType: 'room',
  resourceLabel: 'Resource',
};

export function getVerticalAvailabilityDefaults(
  businessCategory: string | null | undefined,
): VerticalAvailabilityDefaults {
  if (!businessCategory) return DEFAULT_AVAILABILITY;
  return VERTICAL_AVAILABILITY_DEFAULTS[businessCategory] ?? DEFAULT_AVAILABILITY;
}
