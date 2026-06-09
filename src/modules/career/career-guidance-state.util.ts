import { Prisma } from '@prisma/client';

export const GUIDANCE_HISTORY_KEY = 'guidance_history';
export const MAX_GUIDANCE_HISTORY = 15;

export type GuidanceType = 'roadmap' | 'skill_gap' | 'certifications' | 'salary' | 'full';

export interface CareerRoadmapStep {
  role: string;
  timeframe?: string;
  focus?: string;
}

export interface CareerRoadmapData {
  currentRole: string;
  steps: CareerRoadmapStep[];
  summary: string;
}

export interface SkillGapPriority {
  skill: string;
  why: string;
  actions: string[];
  timeline?: string;
}

export interface SkillGapPlanData {
  missingSkills: string[];
  priorities: SkillGapPriority[];
  summary: string;
}

export interface CertificationRecommendation {
  name: string;
  provider?: string;
  skills: string[];
  reason: string;
}

export interface CertificationRecData {
  recommendations: CertificationRecommendation[];
  summary: string;
}

export interface SalaryInsightData {
  roles: string;
  location: string;
  juniorRange?: string;
  midRange?: string;
  seniorRange?: string;
  insight: string;
  growthTips?: string[];
}

export interface GuidanceHistoryEntry {
  id: string;
  type: GuidanceType;
  generatedAt: string;
  roadmap?: CareerRoadmapData;
  skillGap?: SkillGapPlanData;
  certifications?: CertificationRecData;
  salary?: SalaryInsightData;
  whatsappSummary?: string;
}

export function readGuidanceHistory(onboardingData: unknown): GuidanceHistoryEntry[] {
  const data = (onboardingData as Record<string, unknown>) ?? {};
  const raw = data[GUIDANCE_HISTORY_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as GuidanceHistoryEntry[];
}

export function readLatestGuidance(
  onboardingData: unknown,
  type: GuidanceType,
): GuidanceHistoryEntry | null {
  return readGuidanceHistory(onboardingData).find((entry) => entry.type === type) ?? null;
}

export function buildGuidanceDataPatch(
  existingData: unknown,
  entry: GuidanceHistoryEntry,
): Prisma.InputJsonValue {
  const data = (existingData as Record<string, unknown>) ?? {};
  const history = readGuidanceHistory(existingData).filter((h) => h.type !== entry.type);
  const next: Record<string, unknown> = {
    ...data,
    [GUIDANCE_HISTORY_KEY]: [entry, ...history].slice(0, MAX_GUIDANCE_HISTORY),
  };
  return next as Prisma.InputJsonValue;
}
