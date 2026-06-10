import { Injectable } from '@nestjs/common';
import { CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** Baseline queries when a tenant has no complete seeker profiles yet. */
export const CAREER_FALLBACK_FETCH_KEYWORDS = [
  'software developer',
  'frontend developer',
  'backend developer',
  'full stack developer',
  'data analyst',
  'digital marketing',
  'sales executive',
  'business development',
] as const;

function asArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

function addKeyword(scores: Map<string, number>, phrase: string, weight: number): void {
  const key = phrase.toLowerCase().trim().replace(/\s+/g, ' ');
  if (key.length < 3 || key.length > 60) return;
  scores.set(key, (scores.get(key) ?? 0) + weight);
}

@Injectable()
export class CareerProfileKeywordsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds Adzuna/JSearch queries from active seeker profiles on this tenant.
   * Falls back to generic IT keywords when no profiles exist.
   */
  async buildFetchKeywordsForUser(userId: number, maxKeywords = 12): Promise<string[]> {
    const profiles = await this.prisma.careerProfile.findMany({
      where: { userId, isComplete: true },
      select: {
        preferredRoles: true,
        skills: true,
        currentLocation: true,
        preferredLocations: true,
      },
      take: 100,
    });

    if (profiles.length === 0) {
      return [...CAREER_FALLBACK_FETCH_KEYWORDS];
    }

    const scores = new Map<string, number>();

    for (const profile of profiles) {
      for (const role of asArray(profile.preferredRoles)) {
        addKeyword(scores, role, 4);
        const words = role.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        if (words.length >= 2) {
          addKeyword(scores, words.slice(0, 2).join(' '), 2);
        }
      }

      for (const skill of asArray(profile.skills).slice(0, 6)) {
        if (skill.length > 2) {
          addKeyword(scores, `${skill} developer`, 2);
          addKeyword(scores, skill, 1);
        }
      }

      if (profile.currentLocation?.trim()) {
        addKeyword(scores, profile.currentLocation.trim(), 1);
      }
      for (const loc of asArray(profile.preferredLocations).slice(0, 2)) {
        addKeyword(scores, loc, 1);
      }
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword);

    const keywords: string[] = [];
    for (const kw of ranked) {
      if (keywords.includes(kw)) continue;
      keywords.push(kw);
      if (keywords.length >= maxKeywords) break;
    }

    if (keywords.length < 4) {
      for (const fallback of CAREER_FALLBACK_FETCH_KEYWORDS) {
        if (!keywords.includes(fallback)) {
          keywords.push(fallback);
        }
        if (keywords.length >= maxKeywords) break;
      }
    }

    return keywords;
  }

  /** Search queries tailored to one seeker profile (zero-match playbook). */
  buildFetchKeywordsForProfile(profile: CareerProfile, maxKeywords = 8): string[] {
    const scores = new Map<string, number>();

    for (const role of asArray(profile.preferredRoles)) {
      addKeyword(scores, role, 5);
    }

    for (const skill of asArray(profile.skills).slice(0, 8)) {
      if (skill.length > 2) {
        addKeyword(scores, `${skill} developer`, 3);
        addKeyword(scores, skill, 2);
      }
    }

    if (profile.currentLocation?.trim()) {
      addKeyword(scores, profile.currentLocation.trim(), 1);
    }
    for (const loc of asArray(profile.preferredLocations).slice(0, 2)) {
      addKeyword(scores, loc, 1);
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword);

    const keywords: string[] = [];
    for (const kw of ranked) {
      if (keywords.includes(kw)) continue;
      keywords.push(kw);
      if (keywords.length >= maxKeywords) break;
    }

    if (keywords.length === 0) {
      return [...CAREER_FALLBACK_FETCH_KEYWORDS].slice(0, maxKeywords);
    }

    return keywords;
  }
}
