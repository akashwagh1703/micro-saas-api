import { Prisma } from '@prisma/client';
import { CareerInterviewType } from './career.constants';

export const INTERVIEW_SESSION_KEY = 'interview_session';
export const INTERVIEW_HISTORY_KEY = 'interview_history';
export const MAX_INTERVIEW_HISTORY = 20;
export const MOCK_QUESTIONS_PER_SESSION = 5;

export interface InterviewAnswerRecord {
  question: string;
  answer: string;
  score: number;
  feedback: string;
}

export interface ActiveInterviewSession {
  status: 'choosing_type' | 'active';
  type?: CareerInterviewType;
  role: string;
  jobId?: number;
  jobTitle?: string;
  company?: string;
  questions: string[];
  currentIndex: number;
  answers: InterviewAnswerRecord[];
  startedAt: string;
}

export interface InterviewHistoryEntry {
  id: string;
  type: CareerInterviewType;
  typeLabel: string;
  role: string;
  jobTitle?: string;
  company?: string;
  readinessScore: number;
  readinessLabel: string;
  questionCount: number;
  avgAnswerScore: number;
  completedAt: string;
  answers: InterviewAnswerRecord[];
}

export function formatReadinessLabel(score: number): string {
  if (score >= 90) return 'Excellent readiness';
  if (score >= 75) return 'Good readiness';
  if (score >= 60) return 'Needs more practice';
  return 'Keep practicing';
}

export function readActiveInterviewSession(onboardingData: unknown): ActiveInterviewSession | null {
  const data = (onboardingData as Record<string, unknown>) ?? {};
  const raw = data[INTERVIEW_SESSION_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const session = raw as Partial<ActiveInterviewSession>;
  if (session.status !== 'choosing_type' && session.status !== 'active') {
    return null;
  }
  return {
    status: session.status,
    type: session.type,
    role: session.role ?? 'professional',
    jobId: session.jobId,
    jobTitle: session.jobTitle,
    company: session.company,
    questions: Array.isArray(session.questions) ? session.questions.map(String) : [],
    currentIndex: typeof session.currentIndex === 'number' ? session.currentIndex : 0,
    answers: Array.isArray(session.answers)
      ? (session.answers as InterviewAnswerRecord[])
      : [],
    startedAt: session.startedAt ?? new Date().toISOString(),
  };
}

export function readInterviewHistory(onboardingData: unknown): InterviewHistoryEntry[] {
  const data = (onboardingData as Record<string, unknown>) ?? {};
  const raw = data[INTERVIEW_HISTORY_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as InterviewHistoryEntry[];
}

export function buildInterviewDataPatch(
  existingData: unknown,
  patch: {
    session?: ActiveInterviewSession | null;
    historyEntry?: InterviewHistoryEntry;
  },
): Prisma.InputJsonValue {
  const data = (existingData as Record<string, unknown>) ?? {};
  const next: Record<string, unknown> = { ...data };

  if (patch.session === null) {
    delete next[INTERVIEW_SESSION_KEY];
  } else if (patch.session) {
    next[INTERVIEW_SESSION_KEY] = patch.session;
  }

  if (patch.historyEntry) {
    const history = readInterviewHistory(existingData);
    next[INTERVIEW_HISTORY_KEY] = [patch.historyEntry, ...history].slice(0, MAX_INTERVIEW_HISTORY);
  }

  return next as Prisma.InputJsonValue;
}

export function parseInterviewType(text: string): CareerInterviewType | null {
  const t = text.toLowerCase().trim();
  if (/managerial|manager\s*round|\bmanager\b/.test(t)) return 'managerial';
  if (/behavioral interview|behavioral|behaviour/.test(t)) return 'behavioral';
  if (/technical interview|technical|\btech\b|coding/.test(t)) return 'technical';
  if (/^hr interview|human resources|\bhr\b/.test(t)) return 'hr';
  return null;
}
