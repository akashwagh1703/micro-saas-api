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
  'parse_review',
  'follow_up_location',
  'follow_up_preferred_location',
  'follow_up_experience',
  'follow_up_current_salary',
  'follow_up_expected_salary',
  'follow_up_notice_period',
  'follow_up_employment_type',
  'follow_up_job_type',
  'follow_up_roles',
  'complete',
] as const;

export const CAREER_COMMANDS = {
  FIND_JOBS: ['find jobs', 'find job', 'search jobs', 'job search'],
  SHOW_APPLICATIONS: ['show applications', 'applications', 'my applications'],
  GENERATE_COVER_LETTER: ['generate cover letter', 'cover letter'],
  IMPROVE_RESUME: ['improve resume', 'resume tips'],
  CAREER_ADVICE: ['career advice', 'career tips'],
  PREPARE_INTERVIEW: ['prepare interview', 'interview prep', 'interview tips'],
  MOCK_INTERVIEW: ['mock interview', 'practice interview', 'mock interview session'],
  END_INTERVIEW: ['end interview', 'stop interview', 'exit interview', 'quit interview'],
  INTERVIEW_STATUS: ['interview status', 'mock status'],
  VIEW_JOBS: ['view jobs', 'top jobs', 'daily jobs'],
  VIEW_JOB: ['view job', 'job details', 'job detail'],
  DISMISS_JOB: ['not interested', 'pass job', 'skip job', 'dismiss job'],
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
  CAREER_ROADMAP: ['career roadmap', 'career path', 'growth path', 'career ladder'],
  SKILL_GAP: ['skill gap', 'skill plan', 'skills to learn', 'skill development'],
  CERTIFICATIONS: ['certifications', 'certification recommendations', 'certs to learn', 'recommended certs'],
  CAREER_GUIDANCE: ['career guidance', 'growth guidance', 'career growth'],
  ALERT_SETTINGS: ['alert settings', 'notification settings', 'alert preferences'],
  ALERT_EMAIL_ON: ['alert email on', 'email alerts on', 'enable email alerts'],
  ALERT_EMAIL_OFF: ['alert email off', 'email alerts off', 'disable email alerts'],
  PORTAL_LINK: ['portal link', 'my portal', 'candidate portal', 'web portal'],
  SUBSCRIBE: ['subscribe', 'pay now', 'upgrade', 'buy plan', 'get subscription'],
  MY_PLAN: ['my plan', 'plan status', 'subscription', 'subscription status'],
  SCHEDULE_INTERVIEW: ['schedule interview', 'book interview', 'interview slot'],
} as const;

/** WhatsApp reply button ids → titles (max 20 chars). */
export const CAREER_WORK_MODE_BUTTONS = [
  { id: 'work_remote', title: 'Remote' },
  { id: 'work_hybrid', title: 'Hybrid' },
  { id: 'work_onsite', title: 'Onsite' },
] as const;

export const CAREER_EMPLOYMENT_TYPE_BUTTONS = [
  { id: 'emp_fulltime', title: 'Full-time' },
  { id: 'emp_parttime', title: 'Part-time' },
  { id: 'emp_contract', title: 'Contract' },
] as const;

export const CAREER_INTERVIEW_TYPES = ['hr', 'technical', 'behavioral', 'managerial'] as const;
export type CareerInterviewType = (typeof CAREER_INTERVIEW_TYPES)[number];

export const CAREER_INTERVIEW_TYPE_LABELS: Record<CareerInterviewType, string> = {
  hr: 'HR Interview',
  technical: 'Technical Interview',
  behavioral: 'Behavioral Interview',
  managerial: 'Managerial Interview',
};

/** WhatsApp allows max 3 reply buttons — managerial via text command. */
export const CAREER_INTERVIEW_TYPE_BUTTONS = [
  { id: 'int_hr', title: 'HR' },
  { id: 'int_technical', title: 'Technical' },
  { id: 'int_behavioral', title: 'Behavioral' },
] as const;

export function buildJobActionButtons(count: number): Array<{ id: string; title: string }> {
  const buttons: Array<{ id: string; title: string }> = [];
  if (count >= 1) {
    buttons.push({ id: 'apply_1', title: 'Apply #1' });
    buttons.push({ id: 'cover_1', title: 'Cover #1' });
  }
  if (count >= 2) {
    buttons.push({ id: 'apply_2', title: 'Apply #2' });
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
  'salary_predictor',
  'career_coach',
] as const;
