/** CareerAI Bot — business type slug and WhatsApp command vocabulary. */

export const CAREER_AI_BUSINESS = 'career_ai';

/** Max bot replies per contact per minute (Phase 10 rate limit). */
export const CAREER_RATE_LIMIT_DEFAULT = 20;

/** Stored on outgoing message metadata to distinguish bot replies from human inbox messages. */
export const CAREER_BOT_MESSAGE_SOURCE = 'career_bot';

/** Max characters accepted from a single WhatsApp user message. */
export const CAREER_MAX_INBOUND_CHARS = 4000;

export const CAREER_APPLICATION_STATUSES = [
  'saved',
  'applied',
  'auto_apply_queued',
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
  UPLOAD_RESUME: ['upload resume', 'update resume', 'new resume'],
  RESET_PROFILE: ['reset profile', 'start over', 'restart profile', 'start again'],
  DELETE_MY_DATA: ['delete my data', 'erase my data', 'delete profile', 'remove my data'],
  ENABLE_AUTO_APPLY: ['enable auto apply', 'auto apply on', 'turn on auto apply'],
  DISABLE_AUTO_APPLY: ['disable auto apply', 'auto apply off', 'turn off auto apply'],
  AUTO_APPLY_STATUS: ['auto apply status'],
  SALARY_BENCHMARK: ['salary benchmark', 'salary check', 'market salary', 'salary range'],
  SCHEDULE_INTERVIEW: ['schedule interview', 'book interview', 'interview slot'],
} as const;

/** WhatsApp reply button ids → titles (max 20 chars). */
export const CAREER_WORK_MODE_BUTTONS = [
  { id: 'work_remote', title: 'Remote' },
  { id: 'work_hybrid', title: 'Hybrid' },
  { id: 'work_onsite', title: 'Onsite' },
] as const;

export function buildJobActionButtons(count: number): Array<{ id: string; title: string }> {
  const buttons: Array<{ id: string; title: string }> = [];
  for (let i = 1; i <= Math.min(count, 3); i++) {
    buttons.push({ id: `apply_${i}`, title: `Apply #${i}` });
  }
  if (buttons.length < 3 && count >= 1) {
    buttons.push({ id: 'resume_1', title: 'Resume #1' });
  }
  return buttons.slice(0, 3);
}

export const CAREER_RESUME_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
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
