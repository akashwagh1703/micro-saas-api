import { CareerProfile } from '@prisma/client';

/** Profile fields that affect job matching scores. */
export const MATCH_RELEVANT_PROFILE_FIELDS = [
  'skills',
  'preferredRoles',
  'preferredLocations',
  'currentLocation',
  'expectedSalary',
  'workPreference',
  'noticePeriod',
  'experience',
  'preferredJobTypes',
] as const satisfies ReadonlyArray<keyof CareerProfile>;

export type MatchRelevantField = (typeof MATCH_RELEVANT_PROFILE_FIELDS)[number];

export function buildProfileMatchSignature(profile: CareerProfile): string {
  const slice: Record<string, unknown> = {};
  for (const field of MATCH_RELEVANT_PROFILE_FIELDS) {
    slice[field] = profile[field] ?? null;
  }
  return JSON.stringify(slice);
}

export function profileMatchFieldsChanged(before: CareerProfile, after: CareerProfile): boolean {
  return buildProfileMatchSignature(before) !== buildProfileMatchSignature(after);
}

export function listChangedMatchFields(
  before: CareerProfile,
  after: CareerProfile,
): MatchRelevantField[] {
  return MATCH_RELEVANT_PROFILE_FIELDS.filter((field) => {
    return JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null);
  });
}
