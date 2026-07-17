/** Strip non-digit characters from a phone string. */
export function extractDigits(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '');
}

/** Normalize to a 10-digit Indian mobile number (last 10 digits, strip +91/leading 0). */
export function normalizeIndianMobile(phone: string): string {
  let digits = extractDigits(phone);
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  } else if (digits.length > 10) {
    digits = digits.slice(-10);
  }
  return digits;
}

/** True when the normalized value is a valid Indian mobile (starts 6–9). */
export function isValidIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeIndianMobile(phone));
}

/** Format as E.164 India (+91XXXXXXXXXX). */
export function toE164Indian(phone: string): string {
  return `+91${normalizeIndianMobile(phone)}`;
}

/**
 * Accept only 10-digit Indian mobiles, optionally prefixed with +91 / 91 / leading 0.
 * Returns null when length is not exactly 10 after normalization.
 */
export function parseStrictIndianMobile(phone: string): string | null {
  const digits = extractDigits(phone);
  let mobile: string;

  if (digits.length === 10) {
    mobile = digits;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    mobile = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    mobile = digits.slice(1);
  } else {
    return null;
  }

  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return null;
  }
  return mobile;
}
