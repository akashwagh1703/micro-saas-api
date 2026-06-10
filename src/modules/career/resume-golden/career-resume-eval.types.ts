import { ParsedCareerProfile } from '../career-parsed-profile.types';

export interface GoldenExperienceExpectation {
  title: string;
  company?: string;
  years?: string;
}

export interface GoldenResumeExpectation {
  full_name?: string;
  email?: string;
  phone?: string;
  skills?: string[];
  experience?: GoldenExperienceExpectation[];
  education?: Array<{ degree?: string; institution?: string; year?: string }>;
  current_location?: string;
  preferred_roles?: string[];
  current_salary?: string;
  expected_salary?: string;
  notice_period?: string;
  work_preference?: string;
}

export interface GoldenResumeCase {
  id: string;
  description: string;
  tags?: string[];
  /** Simulated pdf-parse / mammoth output — primary R0 input. */
  extracted_text: string;
  /** Optional fixture simulating AI JSON output (no API call). */
  mock_ai?: ParsedCareerProfile;
  expected: GoldenResumeExpectation;
  /** Fields omitted from scoring (optional in real resumes). */
  optional_fields?: Array<keyof GoldenResumeExpectation>;
}

export interface FieldScore {
  field: string;
  score: number;
  expected?: unknown;
  actual?: unknown;
  note?: string;
  skipped?: boolean;
}

export interface CaseEvalResult {
  id: string;
  description: string;
  tags: string[];
  pipeline: string;
  fieldScores: FieldScore[];
  overallScore: number;
  skillsRecall?: number;
  skillsPrecision?: number;
  experienceMatchRate?: number;
}

export interface GoldenEvalReport {
  runAt: string;
  pipeline: string;
  caseCount: number;
  cases: CaseEvalResult[];
  aggregates: {
    overallScore: number;
    byField: Record<string, { avgScore: number; evaluated: number }>;
    byTag: Record<string, { avgScore: number; count: number }>;
  };
}

export type EvalPipelineMode = 'heuristic' | 'merged' | 'ai-only';
