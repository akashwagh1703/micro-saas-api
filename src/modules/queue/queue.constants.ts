export const QUEUE_PROCESS_INCOMING = 'process-incoming-message';
export const QUEUE_EXECUTE_WORKFLOW = 'execute-workflow';
export const QUEUE_SEND_MESSAGE = 'send-whatsapp-message';
export const QUEUE_CAREER_TASK = 'career-background-task';
export const QUEUE_CAREER_DIGEST = 'career-digest-batch';
export const QUEUE_CAREER_JOB_REFRESH = 'career-job-refresh';
export const QUEUE_CAREER_RETENTION = 'career-resume-text-retention';

export const ALL_QUEUES = [
  QUEUE_PROCESS_INCOMING,
  QUEUE_EXECUTE_WORKFLOW,
  QUEUE_SEND_MESSAGE,
  QUEUE_CAREER_TASK,
  QUEUE_CAREER_DIGEST,
  QUEUE_CAREER_JOB_REFRESH,
  QUEUE_CAREER_RETENTION,
];

export interface SendMessageJob {
  userId: number;
  conversationId: number | null;
  content: string;
}

export type CareerTaskType = 'parse_resume' | 'generate_resume' | 'generate_cover_letter';

export interface CareerTaskJob {
  type: CareerTaskType;
  messageId: number;
  profileId: number;
  userId: number;
  reupload?: boolean;
  jobIndex?: number;
}
