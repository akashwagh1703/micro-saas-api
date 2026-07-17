/** Shared public website configuration and lead-scoring maps. */

export const WEBSITE_INDUSTRIES = [
  { id: 'salon', label: 'Salon / Spa', color: '#DB2777' },
  { id: 'healthcare', label: 'Healthcare Clinic', color: '#06B6D4' },
  { id: 'retail', label: 'Retail Shop', color: '#EC4899' },
  { id: 'coaching', label: 'Coaching Center', color: '#9333EA' },
  { id: 'real-estate', label: 'Real Estate Agent', color: '#F59E0B' },
  { id: 'agency', label: 'Agency / Freelancer', color: '#3B82F6' },
  { id: 'other', label: 'Other Business', color: '#64748B' },
] as const;

/** Lead score points by industry id (aligned with WEBSITE_INDUSTRIES). */
export const BUSINESS_TYPE_SCORES: Record<string, number> = {
  salon: 25,
  healthcare: 30,
  'real-estate': 30,
  agency: 30,
  retail: 20,
  coaching: 20,
  other: 10,
  general: 10,
};

const DEFAULT_FEATURES = [
  'Unlimited WhatsApp automation',
  'Create & use workflows',
  'Advanced analytics dashboard',
  'Any business type support',
];

export function normalizeBusinessTypeId(raw?: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function scoreForBusinessType(businessType?: string): number {
  const id = normalizeBusinessTypeId(businessType);
  return BUSINESS_TYPE_SCORES[id] ?? 10;
}

function parseInr(envKey: string, fallback: number): number {
  const n = parseInt(process.env[envKey] ?? String(fallback), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function buildWebsitePublicConfig() {
  const monthlyPrice = parseInr('PLATFORM_PRICE_MONTHLY_INR', 499);
  const yearlyPrice = parseInr('PLATFORM_PRICE_YEARLY_INR', 4999);
  const trialDays = parseInr('BILLING_TRIAL_DAYS', 14);
  const yearlySavings = Math.max(0, monthlyPrice * 12 - yearlyPrice);

  return {
    apiUrl: process.env.APP_URL || process.env.API_URL || 'https://api.autowave.playltp.in',
    websiteUrl: process.env.WEBSITE_URL || 'https://autowave.playltp.in',
    portalUrl: process.env.PORTAL_URL || 'https://app.autowave.playltp.in',
    features: {
      demoRequest: true,
      trialSignup: true,
    },
    industries: WEBSITE_INDUSTRIES,
    pricing: {
      trial: {
        days: trialDays,
        price: 0,
      },
      plans: [
        {
          id: 'monthly',
          name: 'Monthly',
          price: monthlyPrice,
          currency: 'INR',
          period: 'month',
          periodLabel: '/month',
          featured: false,
          features: DEFAULT_FEATURES,
          ctaLabel: 'Get Started',
        },
        {
          id: 'yearly',
          name: 'Yearly',
          price: yearlyPrice,
          currency: 'INR',
          period: 'year',
          periodLabel: '/year',
          featured: true,
          badge: 'Best Value',
          savings:
            yearlySavings > 0
              ? `Save ₹${yearlySavings.toLocaleString('en-IN')}/year`
              : undefined,
          features: [...DEFAULT_FEATURES, 'Priority support'],
          ctaLabel: 'Start Free Trial',
        },
      ],
    },
  };
}
