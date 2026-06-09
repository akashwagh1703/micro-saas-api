/** Onboarding questions, validation, and friendly WhatsApp copy for CareerAI. */

export interface OnboardingStepDef {
  next: string;
  field:
    | 'currentLocation'
    | 'preferredLocations'
    | 'currentSalary'
    | 'expectedSalary'
    | 'noticePeriod'
    | 'preferredJobTypes'
    | 'workPreference'
    | 'preferredRoles';
  question: string;
  stepNumber: number;
}

export interface OnboardingValidationResult {
  ok: boolean;
  error?: string;
  /** Value to persist — string or string[] depending on field. */
  value?: string | string[];
  /** Short label for acknowledgment message. */
  display?: string;
}

const STEP_ORDER = [
  'follow_up_location',
  'follow_up_preferred_location',
  'follow_up_current_salary',
  'follow_up_expected_salary',
  'follow_up_notice_period',
  'follow_up_employment_type',
  'follow_up_job_type',
  'follow_up_roles',
] as const;

const GIBBERISH = new Set([
  'yes',
  'no',
  'ok',
  'okay',
  'test',
  'na',
  'n/a',
  'none',
  'nil',
  'skip',
  'idk',
  'dont know',
  "don't know",
  'nothing',
  '.',
  '-',
]);

export function getOnboardingSteps(): Record<string, OnboardingStepDef> {
  return {
    follow_up_location: {
      next: 'follow_up_preferred_location',
      field: 'currentLocation',
      stepNumber: 1,
      question: [
        '📍 *Question 1 of 8 — Current location*',
        '',
        'Where are you based right now?',
        '_Examples: Mumbai · Pune · Bengaluru · Remote_',
      ].join('\n'),
    },
    follow_up_preferred_location: {
      next: 'follow_up_current_salary',
      field: 'preferredLocations',
      stepNumber: 2,
      question: [
        '🌍 *Question 2 of 8 — Preferred work locations*',
        '',
        'Which cities would you like to work in?',
        '_Comma-separated — e.g. Pune, Remote, Hyderabad_',
      ].join('\n'),
    },
    follow_up_current_salary: {
      next: 'follow_up_expected_salary',
      field: 'currentSalary',
      stepNumber: 3,
      question: [
        '💰 *Question 3 of 8 — Current salary*',
        '',
        'What is your current CTC?',
        '_Examples: 8 LPA · 6.5 LPA · Fresher · Not applicable_',
      ].join('\n'),
    },
    follow_up_expected_salary: {
      next: 'follow_up_notice_period',
      field: 'expectedSalary',
      stepNumber: 4,
      question: [
        '🎯 *Question 4 of 8 — Expected salary*',
        '',
        'What CTC are you targeting in your next role?',
        '_Examples: 12 LPA · 10-14 LPA · Negotiable_',
      ].join('\n'),
    },
    follow_up_notice_period: {
      next: 'follow_up_employment_type',
      field: 'noticePeriod',
      stepNumber: 5,
      question: [
        '⏳ *Question 5 of 8 — Notice period*',
        '',
        'How soon can you join a new company?',
        '_Examples: 30 days · 2 months · Immediate · Serving notice_',
      ].join('\n'),
    },
    follow_up_employment_type: {
      next: 'follow_up_job_type',
      field: 'preferredJobTypes',
      stepNumber: 6,
      question: [
        '💼 *Question 6 of 8 — Employment type*',
        '',
        'What type of role are you looking for?',
        'Tap a button below or type *Full-time*, *Part-time*, or *Contract*.',
      ].join('\n'),
    },
    follow_up_job_type: {
      next: 'follow_up_roles',
      field: 'workPreference',
      stepNumber: 7,
      question: [
        '🏠 *Question 7 of 8 — Work mode*',
        '',
        'Do you prefer Remote, Hybrid, or Onsite work?',
        'Tap a button below or type your preference.',
      ].join('\n'),
    },
    follow_up_roles: {
      next: 'complete',
      field: 'preferredRoles',
      stepNumber: 8,
      question: [
        '🚀 *Question 8 of 8 — Target roles*',
        '',
        'Which job titles are you aiming for?',
        '_Comma-separated — e.g. React Developer, Full Stack Engineer, PHP Developer_',
      ].join('\n'),
    },
  };
}

export function welcomeMessage(name?: string | null): string {
  const greeting = name?.trim() ? `Hi *${name.trim().split(/\s+/)[0]}*! ` : '';
  return [
    `${greeting}Welcome to *CareerAI* 🎯`,
    '',
    'Your personal career coach on WhatsApp — I\'ll:',
    '✨ Match you with 70%+ fit jobs',
    '📝 Tailor resumes & cover letters',
    '🎤 Run mock interviews & career guidance',
    '',
    '📄 *Let\'s start:* Upload your latest resume (*PDF* or *DOCX*)',
  ].join('\n');
}

export function awaitingResumeMessage(): string {
  return [
    '📎 *Resume needed*',
    '',
    'Please attach your resume as a *PDF*, *DOCX*, or a clear photo (JPEG/PNG).',
    '',
    '_Tip: Text-based PDFs parse most accurately._',
  ].join('\n');
}

export function parsingResumeRecoveryMessage(): string {
  return getOnboardingSteps().follow_up_location.question;
}

export function formatOnboardingAck(step: string, display: string): string {
  const icons: Record<string, string> = {
    follow_up_location: '📍',
    follow_up_preferred_location: '🌍',
    follow_up_current_salary: '💰',
    follow_up_expected_salary: '🎯',
    follow_up_notice_period: '⏳',
    follow_up_employment_type: '💼',
    follow_up_job_type: '🏠',
    follow_up_roles: '🚀',
  };
  const icon = icons[step] ?? '✅';
  return `${icon} Got it — *${display}* ✅`;
}

export function validateOnboardingAnswer(step: string, rawText: string): OnboardingValidationResult {
  const text = normalizeInboundAnswer(rawText);
  if (!text) {
    return { ok: false, error: emptyAnswerError(step) };
  }

  switch (step) {
    case 'follow_up_location':
      return validateLocation(text, false);
    case 'follow_up_preferred_location':
      return validatePreferredLocations(text);
    case 'follow_up_current_salary':
      return validateSalary(text, 'current');
    case 'follow_up_expected_salary':
      return validateSalary(text, 'expected');
    case 'follow_up_notice_period':
      return validateNoticePeriod(text);
    case 'follow_up_employment_type':
      return validateEmploymentType(text);
    case 'follow_up_job_type':
      return validateWorkMode(text);
    case 'follow_up_roles':
      return validateRoles(text);
    default:
      return { ok: true, value: text, display: text };
  }
}

function normalizeInboundAnswer(raw: string): string {
  return raw
    .replace(/^(work_|emp_)/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function emptyAnswerError(step: string): string {
  const prompts: Record<string, string> = {
    follow_up_location: 'Please share your current city — e.g. *Mumbai* or *Pune*.',
    follow_up_preferred_location: 'Please list at least one preferred location — e.g. *Pune, Remote*.',
    follow_up_current_salary: 'Please enter your current CTC — e.g. *8 LPA* or *Fresher*.',
    follow_up_expected_salary: 'Please enter your expected CTC — e.g. *12 LPA* or *Negotiable*.',
    follow_up_notice_period: 'Please enter your notice period — e.g. *30 days* or *Immediate*.',
    follow_up_employment_type: 'Please choose *Full-time*, *Part-time*, or *Contract*.',
    follow_up_job_type: 'Please choose *Remote*, *Hybrid*, or *Onsite*.',
    follow_up_roles: 'Please enter at least one target role — e.g. *React Developer*.',
  };
  return `⚠️ *I didn't catch that.*\n\n${prompts[step] ?? 'Please type a valid answer.'}`;
}

function validateLocation(text: string, allowRemoteOnly: boolean): OnboardingValidationResult {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2 || cleaned.length > 80) {
    return {
      ok: false,
      error: [
        '⚠️ *That doesn\'t look like a valid location.*',
        '',
        'Please enter your city — e.g. *Mumbai*, *Pune*, *Bengaluru*, or *Remote*.',
      ].join('\n'),
    };
  }
  if (/@|https?:|www\./i.test(cleaned)) {
    return {
      ok: false,
      error: '⚠️ Please enter a *city name*, not an email or link.\n\n_Example: Hyderabad_',
    };
  }
  if (!/[a-zA-Z]/.test(cleaned)) {
    return {
      ok: false,
      error: '⚠️ Location should contain letters — e.g. *Delhi* or *Remote*.',
    };
  }
  if (GIBBERISH.has(cleaned.toLowerCase()) && !/remote/i.test(cleaned)) {
    return {
      ok: false,
      error: '⚠️ Please share your actual city or type *Remote* if you work remotely.',
    };
  }
  if (/^\d+$/.test(cleaned)) {
    return {
      ok: false,
      error: '⚠️ Please enter a city name, not numbers only.\n\n_Example: Chennai_',
    };
  }

  const display = capitalizeLocation(cleaned);
  if (!allowRemoteOnly && /^remote$/i.test(display)) {
    return { ok: true, value: 'Remote', display: 'Remote' };
  }
  return { ok: true, value: display, display };
}

function validatePreferredLocations(text: string): OnboardingValidationResult {
  const parts = text
    .split(/[,|/;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      ok: false,
      error: [
        '⚠️ *Please add at least one location.*',
        '',
        '_Examples: Pune, Remote · Mumbai, Hyderabad · Remote only_',
      ].join('\n'),
    };
  }
  if (parts.length > 6) {
    return {
      ok: false,
      error: '⚠️ Please limit to *6 locations* max — e.g. *Pune, Mumbai, Remote*.',
    };
  }

  const normalized: string[] = [];
  for (const part of parts) {
    const check = validateLocation(part, true);
    if (!check.ok) {
      return {
        ok: false,
        error: `⚠️ *"${part}"* doesn't look valid.\n\nUse city names or *Remote* — comma-separated.`,
      };
    }
    normalized.push(String(check.value));
  }

  const unique = dedupeCaseInsensitive(normalized);
  return {
    ok: true,
    value: unique,
    display: unique.join(', '),
  };
}

function validateSalary(text: string, kind: 'current' | 'expected'): OnboardingValidationResult {
  const t = text.trim();
  const lower = t.toLowerCase();

  const allowedKeywords =
    /negotiable|open to discuss|discuss|fresher|not applicable|n\/a|na|none|no salary|student|intern|stipend/i;
  if (allowedKeywords.test(lower)) {
    const display = /fresher|student|intern|stipend/i.test(lower)
      ? 'Fresher'
      : 'Negotiable';
    return { ok: true, value: display, display };
  }

  const hasNumber = /\d/.test(t);
  const hasSalaryUnit = /lpa|lac|lakh|lakhs|crore|cr|k\b|pm|per month|month|annum|year|ctc|package/i.test(lower);

  if (!hasNumber) {
    return {
      ok: false,
      error: [
        '⚠️ *Please enter a salary amount or keyword.*',
        '',
        kind === 'current'
          ? '_Examples: 8 LPA · 6.5 LPA · Fresher · Not applicable_'
          : '_Examples: 12 LPA · 10-14 LPA · Negotiable_',
      ].join('\n'),
    };
  }

  if (t.length < 2 || t.length > 40) {
    return {
      ok: false,
      error: '⚠️ Please enter a concise salary — e.g. *12 LPA* or *8-10 LPA*.',
    };
  }

  if (!hasSalaryUnit && !/\d+\s*[-–—]\s*\d+/.test(t) && !/^\d+(\.\d+)?$/.test(t)) {
    return {
      ok: false,
      error: '⚠️ Add units if you can — e.g. *12 LPA*, *8 lakh*, or *50k per month*.',
    };
  }

  const display = normalizeSalaryDisplay(t);
  return { ok: true, value: display, display };
}

function validateNoticePeriod(text: string): OnboardingValidationResult {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (/immediate|join immediately|asap|right away|no notice|zero notice|0 day|can join now/i.test(lower)) {
    return { ok: true, value: 'Immediate', display: 'Immediate' };
  }
  if (/serving|already serving|in notice|notice period serving/i.test(lower)) {
    return { ok: true, value: 'Serving notice', display: 'Serving notice' };
  }

  const hasNumber = /\d/.test(t);
  const hasUnit = /day|days|month|months|week|weeks|d\b|m\b|month/i.test(lower);

  if (!hasNumber && !/negotiable|discuss|flexible/i.test(lower)) {
    return {
      ok: false,
      error: [
        '⚠️ *Please enter your notice period clearly.*',
        '',
        '_Examples: 30 days · 2 months · Immediate · Serving notice_',
      ].join('\n'),
    };
  }

  if (hasNumber && !hasUnit && !/immediate/i.test(lower)) {
    return {
      ok: false,
      error: '⚠️ Include the unit — e.g. *30 days*, *45 days*, or *2 months*.',
    };
  }

  const display = capitalizeFirst(t);
  return { ok: true, value: display, display };
}

function validateEmploymentType(text: string): OnboardingValidationResult {
  const lower = text.toLowerCase();
  if (/full.?time|fulltime|ft\b/.test(lower)) {
    return { ok: true, value: 'full_time', display: 'Full-time' };
  }
  if (/part.?time|parttime|pt\b/.test(lower)) {
    return { ok: true, value: 'part_time', display: 'Part-time' };
  }
  if (/contract|freelance|consulting|intern|internship|temporary|temp\b/.test(lower)) {
    const display = /intern/i.test(lower) ? 'Internship' : 'Contract';
    return { ok: true, value: 'contract', display };
  }

  return {
    ok: false,
    error: [
      '⚠️ *Please pick an employment type.*',
      '',
      'Tap a button or type:',
      '• *Full-time*',
      '• *Part-time*',
      '• *Contract*',
    ].join('\n'),
  };
}

function validateWorkMode(text: string): OnboardingValidationResult {
  const mode = normalizeWorkPreference(text);
  if (mode) {
    return { ok: true, value: mode, display: mode };
  }

  return {
    ok: false,
    error: [
      '⚠️ *Please choose a work mode.*',
      '',
      'Tap a button or type:',
      '🏠 *Remote* · 🏢 *Hybrid* · 🏬 *Onsite*',
    ].join('\n'),
  };
}

export function normalizeWorkPreference(text: string): string | null {
  const lower = text.toLowerCase().trim();
  if (/remote|wfh|work from home|anywhere|home based/i.test(lower)) return 'Remote';
  if (/hybrid|partial remote|flexible/i.test(lower)) return 'Hybrid';
  if (/on.?site|onsite|office|in office|in-office|work from office/i.test(lower)) return 'Onsite';
  return null;
}

function validateRoles(text: string): OnboardingValidationResult {
  const parts = text
    .split(/[,|/;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0 || parts.every((p) => p.length < 2)) {
    return {
      ok: false,
      error: [
        '⚠️ *Please enter at least one target role.*',
        '',
        '_Examples: React Developer · PHP Developer · Full Stack Engineer_',
      ].join('\n'),
    };
  }
  if (parts.length > 5) {
    return {
      ok: false,
      error: '⚠️ Please limit to *5 target roles* — e.g. *React Developer, Node.js Developer*.',
    };
  }

  const roles: string[] = [];
  for (const part of parts) {
    if (part.length < 2 || part.length > 80) {
      return {
        ok: false,
        error: '⚠️ Each role should be *2–80 characters* — e.g. *Senior Laravel Developer*.',
      };
    }
    if (!/[a-zA-Z]/.test(part)) {
      return {
        ok: false,
        error: '⚠️ Role titles should contain letters — e.g. *Data Analyst*, not numbers only.',
      };
    }
    if (/@|https?:|www\./i.test(part)) {
      return {
        ok: false,
        error: '⚠️ Enter *job titles*, not emails or links.',
      };
    }
    if (GIBBERISH.has(part.toLowerCase())) {
      return {
        ok: false,
        error: '⚠️ Please enter real job titles you are targeting.',
      };
    }
    roles.push(part.replace(/\s+/g, ' '));
  }

  const unique = dedupeCaseInsensitive(roles);
  return {
    ok: true,
    value: unique,
    display: unique.join(', '),
  };
}

function normalizeSalaryDisplay(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/lakhs?/gi, 'LPA')
    .replace(/lacs?/gi, 'LPA')
    .replace(/crore/gi, 'Cr')
    .trim();
}

function capitalizeLocation(value: string): string {
  if (/^remote$/i.test(value)) return 'Remote';
  return value
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function employmentTypePromptBody(prefix?: string): string {
  return [
    prefix,
    '💼 *Question 6 of 8 — Employment type*',
    '',
    'What type of role are you looking for?',
    'Tap a button below or type *Full-time*, *Part-time*, or *Contract*.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function workModePromptBody(prefix?: string): string {
  return [
    prefix,
    '🏠 *Question 7 of 8 — Work mode*',
    '',
    'Do you prefer *Remote*, *Hybrid*, or *Onsite* work?',
    'Tap a button below or type your preference.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export { STEP_ORDER as ONBOARDING_STEP_ORDER };
