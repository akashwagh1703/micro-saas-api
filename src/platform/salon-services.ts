export interface SalonServiceOption {
  text: string;
  description?: string;
  value: string;
}

export const SALON_SERVICES_SETTING_KEY = 'salon_services';

export const DEFAULT_SALON_SERVICES: SalonServiceOption[] = [
  { text: 'Haircut', description: 'Classic cut & finish', value: 'Haircut' },
  { text: 'Beard trim', description: 'Shape & tidy', value: 'Beard trim' },
  { text: 'Styling', description: 'Blow-dry & style', value: 'Styling' },
  { text: 'Hair coloring', description: 'Color & highlights', value: 'Hair coloring' },
];

const MAX_SERVICES = 10;
const MAX_TEXT_LEN = 20;
const MAX_DESC_LEN = 72;
const MAX_VALUE_LEN = 40;

export function normalizeSalonServiceRow(raw: unknown): SalonServiceOption | null {
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

export function parseSalonServicesJson(raw: string | null | undefined): SalonServiceOption[] {
  if (!raw?.trim()) return [...DEFAULT_SALON_SERVICES];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SALON_SERVICES];
    const rows = parsed.map(normalizeSalonServiceRow).filter((r): r is SalonServiceOption => r != null);
    return rows.length > 0 ? rows : [...DEFAULT_SALON_SERVICES];
  } catch {
    return [...DEFAULT_SALON_SERVICES];
  }
}

export function validateSalonServices(services: unknown): {
  valid: boolean;
  services: SalonServiceOption[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!Array.isArray(services)) {
    return { valid: false, services: [], errors: ['Services must be an array.'] };
  }
  if (services.length < 1) {
    errors.push('Add at least one service.');
  }
  if (services.length > MAX_SERVICES) {
    errors.push(`You can add up to ${MAX_SERVICES} services.`);
  }

  const rows: SalonServiceOption[] = [];
  const seen = new Set<string>();

  services.forEach((item, index) => {
    const row = normalizeSalonServiceRow(item);
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
