/** CareerAI Bot — business type slug and WhatsApp command vocabulary. */

export const CAREER_AI_BUSINESS = 'career_ai';

/** Max bot replies per contact per minute (Phase 10 rate limit). */
export const CAREER_RATE_LIMIT_DEFAULT = 20;

/** Max characters accepted from a single WhatsApp user message. */
export const CAREER_MAX_INBOUND_CHARS = 4000;

export const CAREER_APPLICATION_STATUSES = [
  'saved',
  'applied',
  'interview',
  'rejected',
  'offer',
  'accepted',
] as const;

export type CareerApplicationStatus = (typeof CAREER_APPLICATION_STATUSES)[number];

export const CAREER_ONBOARDING_STEPS = [
  'welcome',
  'awaiting_resume',
  'parsing_resume',
  'follow_up_location',
  'follow_up_preferred_location',
  'follow_up_current_salary',
  'follow_up_expected_salary',
  'follow_up_notice_period',
  'follow_up_job_type',
  'follow_up_roles',
  'complete',
] as const;

export const CAREER_COMMANDS = {
  FIND_JOBS: ['find jobs', 'find job', 'search jobs', 'job search'],
  SHOW_APPLICATIONS: ['show applications', 'applications', 'my applications'],
  GENERATE_RESUME: ['generate resume', 'resume for job', 'tailor resume'],
  GENERATE_COVER_LETTER: ['generate cover letter', 'cover letter'],
  IMPROVE_RESUME: ['improve resume', 'resume tips'],
  CAREER_ADVICE: ['career advice', 'career tips'],
  PREPARE_INTERVIEW: ['prepare interview', 'interview prep', 'interview tips'],
  VIEW_JOBS: ['view jobs', 'top jobs', 'daily jobs'],
  STOP_DIGEST: ['stop digest', 'unsubscribe', 'stop daily digest'],
  START_DIGEST: ['start digest', 'subscribe digest'],
  HELP: ['help', 'commands', 'menu'],
} as const;

export const CAREER_RESUME_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export const CAREER_FUTURE_MODULES = [
  'browser_extension',
  'ats_integration',
  'auto_apply',
  'linkedin_integration',
  'naukri_integration',
  'interview_ai_agent',
  'salary_predictor',
  'career_coach',
] as const;
