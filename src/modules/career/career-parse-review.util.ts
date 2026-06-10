import { ParsedCareerProfile } from './career-parsed-profile.types';
import { ParsedProfileValidation } from './career-resume-validate.util';

export interface StagedParseReview {
  parsed: ParsedCareerProfile;
  validation?: ParsedProfileValidation | null;
  reupload?: boolean;
  resumeId?: number;
  stagedAt?: string;
}

export type ParseReviewEditField =
  | 'location'
  | 'roles'
  | 'skills'
  | 'name'
  | 'email'
  | 'phone';

export type ParseReviewReply =
  | { type: 'confirm' }
  | { type: 'edit'; field: ParseReviewEditField; value: string }
  | { type: 'unknown' };

const CONFIRM_RE =
  /^(yes|y|confirm|confirmed|correct|approve|looks good|ok confirm|yes confirm|that's correct|thats correct)$/i;

export function isParseConfirmEnabled(): boolean {
  return process.env.CAREER_PARSE_CONFIRM_ENABLED !== 'false';
}

export function readParseReview(onboardingData: unknown): StagedParseReview | null {
  if (!onboardingData || typeof onboardingData !== 'object') {
    return null;
  }
  const raw = (onboardingData as Record<string, unknown>).parseReview;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const staged = raw as StagedParseReview;
  if (!staged.parsed || typeof staged.parsed !== 'object') {
    return null;
  }
  return staged;
}

export function parseParseReviewReply(text: string): ParseReviewReply {
  const trimmed = text.trim();
  if (!trimmed) {
    return { type: 'unknown' };
  }

  if (CONFIRM_RE.test(trimmed) || /^yes[,.!?\s]/i.test(trimmed)) {
    return { type: 'confirm' };
  }

  const editMatch = trimmed.match(
    /^edit\s+(location|roles?|skills?|name|email|phone)\s+(.+)$/i,
  );
  if (editMatch) {
    const field = normalizeEditField(editMatch[1]);
    const value = editMatch[2].trim();
    if (value) {
      return { type: 'edit', field, value };
    }
  }

  return { type: 'unknown' };
}

export function applyParseReviewEdit(
  parsed: ParsedCareerProfile,
  edit: Extract<ParseReviewReply, { type: 'edit' }>,
): ParsedCareerProfile {
  const out: ParsedCareerProfile = { ...parsed };

  switch (edit.field) {
    case 'name':
      out.full_name = edit.value.trim();
      break;
    case 'email':
      out.email = edit.value.trim().toLowerCase();
      break;
    case 'phone': {
      const digits = edit.value.replace(/\D/g, '');
      out.phone =
        digits.length === 10
          ? `+91${digits}`
          : digits.length === 12 && digits.startsWith('91')
            ? `+${digits}`
            : edit.value.trim();
      break;
    }
    case 'location':
      out.current_location = edit.value.trim();
      break;
    case 'roles':
      out.preferred_roles = splitCommaList(edit.value);
      break;
    case 'skills':
      out.skills = splitCommaList(edit.value);
      break;
    default:
      break;
  }

  return out;
}

export function formatParsedPreviewSummary(parsed: ParsedCareerProfile): string {
  const lines: string[] = [];

  if (parsed.full_name) {
    lines.push(`Name: ${parsed.full_name}`);
  }
  if (parsed.current_location) {
    lines.push(`Location: ${parsed.current_location}`);
  }
  if (parsed.email) {
    lines.push(`Email: ${parsed.email}`);
  }
  if (parsed.phone) {
    lines.push(`Phone: ${parsed.phone}`);
  }

  const roles = parsed.preferred_roles ?? [];
  if (roles.length > 0) {
    lines.push(`Target roles: ${roles.slice(0, 3).join(', ')}`);
  }

  const skills = parsed.skills ?? [];
  if (skills.length > 0) {
    lines.push(`Skills: ${skills.slice(0, 8).join(', ')}`);
  }

  const exp = parsed.experience ?? [];
  if (exp.length > 0) {
    const latest = exp[0];
    const label = [latest.title, latest.company ? `at ${latest.company}` : '']
      .filter(Boolean)
      .join(' ');
    if (label) {
      lines.push(`Latest job: ${label}`);
    }
  }

  if (parsed.expected_salary) {
    lines.push(`Expected salary: ${parsed.expected_salary}`);
  }

  return lines.length > 0 ? lines.join('\n') : '_No fields detected — you can add details with EDIT commands below._';
}

export function formatParseReviewPrompt(
  parsed: ParsedCareerProfile,
  options?: {
    validationHint?: string | null;
    qualityHint?: string | null;
    reupload?: boolean;
    validation?: ParsedProfileValidation | null;
  },
): string {
  const summary = formatParsedPreviewSummary(parsed);
  const lowConf = formatLowConfidenceNotes(options?.validation);

  return [
    options?.reupload
      ? '📄 *Here’s what I read from your new resume:*'
      : '✨ *Here’s what I read from your resume:*',
    '',
    summary,
    ...lowConf,
    options?.qualityHint ?? '',
    options?.validationHint ?? '',
    '',
    'Reply *YES* to confirm, or fix a field:',
    '• *EDIT LOCATION* Mumbai',
    '• *EDIT ROLES* Java Developer, Backend Developer',
    '• *EDIT SKILLS* React, Node.js, Python',
    '• *EDIT NAME* Your Full Name',
    '• *EDIT EMAIL* you@email.com',
    '• *EDIT PHONE* 9876543210',
    '',
    options?.reupload
      ? '_After you confirm, I’ll update your profile and refresh job matches._'
      : '_After you confirm, I’ll save these details and ask any remaining quick questions._',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatParseReviewEditAck(
  parsed: ParsedCareerProfile,
  field: ParseReviewEditField,
  displayValue: string,
  options?: {
    validationHint?: string | null;
    qualityHint?: string | null;
    reupload?: boolean;
    validation?: ParsedProfileValidation | null;
  },
): string {
  const labels: Record<ParseReviewEditField, string> = {
    location: 'Location',
    roles: 'Target roles',
    skills: 'Skills',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
  };

  return [
    `Updated *${labels[field]}* → *${displayValue}* ✅`,
    '',
    formatParseReviewPrompt(parsed, options),
  ].join('\n');
}

export function parseReviewHelpMessage(): string {
  return [
    'Please reply *YES* to confirm these details, or edit a field — for example:',
    '• *EDIT LOCATION* Pune',
    '• *EDIT ROLES* Java Developer',
    '• *EDIT SKILLS* Java, Spring Boot',
  ].join('\n');
}

function formatLowConfidenceNotes(validation: ParsedProfileValidation | null | undefined): string[] {
  if (!validation?.fieldConfidence) {
    return [];
  }
  const notes: string[] = [];
  const labels: Record<string, string> = {
    full_name: 'Name',
    current_location: 'Location',
    skills: 'Skills',
    experience: 'Experience',
    preferred_roles: 'Target roles',
  };

  for (const [field, conf] of Object.entries(validation.fieldConfidence)) {
    if (conf === 'low' && labels[field]) {
      notes.push(`⚠️ *${labels[field]}* — please double-check or use *EDIT ${field === 'current_location' ? 'LOCATION' : field.toUpperCase()}* …`);
    }
  }

  return notes;
}

function normalizeEditField(raw: string): ParseReviewEditField {
  const key = raw.toLowerCase().replace(/s$/, '');
  if (key === 'role') return 'roles';
  if (key === 'skill') return 'skills';
  return key as ParseReviewEditField;
}

function splitCommaList(raw: string): string[] {
  return raw
    .split(/[,|•\n/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
