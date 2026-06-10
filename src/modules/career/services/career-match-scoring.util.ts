import { CareerJob } from '@prisma/client';
import {
  detectSeniority,
  JobSeniority,
  JobWorkMode,
  normalizeSkillList,
  normalizeSkillToken,
  parseSalaryFromText,
} from '../job-sources/job-source.utils';

export interface MatchFactorBreakdown {
  skills: { matched: string[]; partial: string[]; missing: string[]; score: number; max: number };
  experience: { profileYears: number; required: string; score: number; max: number };
  seniority: { profile: string; job: string; score: number; max: number };
  salary: { score: number; max: number; note?: string };
  location: { score: number; max: number; note?: string };
  role: { score: number; max: number; note?: string };
  notice: { score: number; max: number; note?: string };
  overall_band: string;
}

export interface StoredMatchFactors {
  display: string[];
  breakdown: MatchFactorBreakdown;
}

/** Skills that count as partial (related) matches — not full substitutes. */
const SKILL_RELATED: Record<string, string[]> = {
  react: ['javascript', 'typescript', 'html', 'css', 'redux'],
  vue: ['javascript', 'typescript', 'html', 'css'],
  angular: ['typescript', 'javascript', 'html'],
  javascript: ['typescript', 'react', 'nodejs'],
  typescript: ['javascript', 'react', 'nodejs'],
  nodejs: ['javascript', 'typescript', 'express', 'nestjs'],
  nestjs: ['nodejs', 'typescript', 'express'],
  express: ['nodejs', 'javascript'],
  laravel: ['php', 'mysql'],
  django: ['python', 'postgresql'],
  postgresql: ['sql', 'mysql'],
  mysql: ['sql', 'postgresql'],
  mongodb: ['nodejs', 'javascript'],
  kubernetes: ['docker', 'aws'],
  docker: ['kubernetes', 'linux', 'aws'],
};

const SKILL_CATEGORIES: Record<string, string[]> = {
  frontend: ['react', 'vue', 'angular', 'javascript', 'typescript', 'html', 'css', 'tailwind', 'next.js'],
  backend: ['nodejs', 'nestjs', 'express', 'python', 'java', 'php', 'laravel', 'django', 'graphql'],
  devops: ['aws', 'docker', 'kubernetes', 'linux', 'ci/cd', 'azure', 'gcp'],
  data: ['python', 'sql', 'postgresql', 'mongodb', 'excel'],
};

const CITY_ALIASES: Record<string, string[]> = {
  bangalore: ['bangalore', 'bengaluru'],
  bengaluru: ['bangalore', 'bengaluru'],
  mumbai: ['mumbai', 'bombay'],
  bombay: ['mumbai', 'bombay'],
  delhi: ['delhi', 'new delhi', 'ncr', 'gurgaon', 'gurugram', 'noida'],
  gurgaon: ['gurgaon', 'gurugram', 'delhi', 'ncr'],
  gurugram: ['gurgaon', 'gurugram', 'delhi', 'ncr'],
  noida: ['noida', 'delhi', 'ncr'],
  chennai: ['chennai', 'madras'],
  kolkata: ['kolkata', 'calcutta'],
  hyderabad: ['hyderabad'],
  pune: ['pune', 'poona'],
  nashik: ['nashik', 'nasik'],
  nasik: ['nashik', 'nasik'],
};

const STATE_HINTS: Record<string, string[]> = {
  maharashtra: ['mumbai', 'pune', 'nashik', 'nasik', 'nagpur'],
  karnataka: ['bangalore', 'bengaluru', 'mysore'],
  'tamil nadu': ['chennai', 'coimbatore'],
  telangana: ['hyderabad'],
  'uttar pradesh': ['noida', 'lucknow'],
  'west bengal': ['kolkata'],
};

type ProfileLevel = 'junior' | 'mid' | 'senior' | 'lead';

const LEVEL_RANK: Record<ProfileLevel, number> = {
  junior: 0,
  mid: 1,
  senior: 2,
  lead: 3,
};

export function readMatchFactorLines(factors: unknown): string[] {
  if (Array.isArray(factors)) {
    return factors.map(String);
  }
  if (factors && typeof factors === 'object' && Array.isArray((factors as StoredMatchFactors).display)) {
    return (factors as StoredMatchFactors).display;
  }
  return [];
}

export function readMatchBreakdown(factors: unknown): MatchFactorBreakdown | null {
  if (factors && typeof factors === 'object' && !Array.isArray(factors)) {
    const breakdown = (factors as StoredMatchFactors).breakdown;
    return breakdown ?? null;
  }
  return null;
}

export function profileSeniorityLevel(years: number): ProfileLevel {
  if (years <= 2) return 'junior';
  if (years <= 5) return 'mid';
  if (years <= 10) return 'senior';
  return 'lead';
}

export function jobSeniorityLevel(job: CareerJob): JobSeniority {
  const tags = job.tags as { seniority?: JobSeniority } | null;
  if (tags?.seniority && tags.seniority !== 'unknown') {
    return tags.seniority;
  }
  return detectSeniority(job.title, job.description ?? '');
}

export function getJobWorkMode(job: CareerJob): JobWorkMode {
  const tags = job.tags as { workMode?: JobWorkMode } | null;
  if (tags?.workMode && tags.workMode !== 'unknown') {
    return tags.workMode;
  }
  const city = (job.city ?? job.location ?? '').toLowerCase();
  if (city.includes('remote')) return 'remote';
  return detectWorkModeFromText(`${job.title} ${job.description ?? ''} ${job.location ?? ''}`);
}

function detectWorkModeFromText(text: string): JobWorkMode {
  const t = text.toLowerCase();
  if (/\b(fully remote|work from home|wfh)\b/.test(t)) return 'remote';
  if (/\bremote\b/.test(t)) return 'remote';
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(on[\s-]?site|in[\s-]?office)\b/.test(t)) return 'onsite';
  return 'unknown';
}

export function parseSkillRequirements(
  requiredSkills: string[],
  description: string,
): { mustHave: string[]; niceToHave: string[] } {
  const normalized = normalizeSkillList(requiredSkills);
  if (!description.trim()) {
    return { mustHave: normalized, niceToHave: [] };
  }

  const mustHave: string[] = [];
  const niceToHave: string[] = [];

  for (const skill of normalized) {
    const idx = description.toLowerCase().search(new RegExp(`\\b${escapeRegex(skill)}\\b`, 'i'));
    if (idx === -1) {
      mustHave.push(skill);
      continue;
    }
    const context = description.slice(Math.max(0, idx - 90), idx + 90).toLowerCase();
    if (/good to have|nice to have|preferred|plus if|bonus|optional|desirable/.test(context)) {
      niceToHave.push(skill);
    } else {
      mustHave.push(skill);
    }
  }

  return { mustHave, niceToHave };
}

export function skillMatchStrength(profileSkills: string[], required: string): number {
  const req = normalizeSkillToken(required);
  if (profileSkills.includes(req)) return 1;

  for (const ps of profileSkills) {
    if (skillMatchesToken(ps, req)) return 1;
  }

  const related = SKILL_RELATED[req] ?? [];
  for (const rel of related) {
    if (profileSkills.some((ps) => ps === rel || skillMatchesToken(ps, rel))) {
      return 0.7;
    }
  }

  for (const skills of Object.values(SKILL_CATEGORIES)) {
    if (!skills.includes(req)) continue;
    for (const ps of profileSkills) {
      if (skills.includes(ps)) return 0.45;
    }
  }

  return 0;
}

function skillMatchesToken(profileSkill: string, required: string): boolean {
  if (profileSkill === required) return true;
  const [short, long] = profileSkill.length <= required.length ? [profileSkill, required] : [required, profileSkill];
  if (short.length < 2) return false;
  return new RegExp(`\\b${escapeRegex(short)}\\b`).test(long);
}

export function scoreSkills(
  profileSkills: string[],
  requiredSkills: string[],
  description: string,
  maxPoints: number,
): {
  points: number;
  matched: string[];
  partial: string[];
  missing: string[];
} {
  if (requiredSkills.length === 0) {
    return { points: maxPoints * 0.25, matched: [], partial: [], missing: [] };
  }

  const { mustHave, niceToHave } = parseSkillRequirements(requiredSkills, description);
  const mustWeight = 0.72;
  const niceWeight = 0.28;

  const scoreBucket = (skills: string[]) => {
    if (skills.length === 0) {
      return { ratio: 1, matched: [] as string[], partial: [] as string[], missing: [] as string[] };
    }
    let total = 0;
    const matched: string[] = [];
    const partial: string[] = [];
    const missing: string[] = [];

    for (const skill of skills) {
      const strength = skillMatchStrength(profileSkills, skill);
      total += strength;
      if (strength >= 1) matched.push(skill);
      else if (strength >= 0.4) partial.push(skill);
      else missing.push(skill);
    }

    return { ratio: total / skills.length, matched, partial, missing };
  };

  const must =
    mustHave.length > 0
      ? scoreBucket(mustHave)
      : { ratio: 1, matched: [] as string[], partial: [] as string[], missing: [] as string[] };
  const nice =
    niceToHave.length > 0
      ? scoreBucket(niceToHave)
      : { ratio: 1, matched: [] as string[], partial: [] as string[], missing: [] as string[] };

  const mustRatio = must.ratio;
  const niceRatio = nice.ratio;

  const ratio =
    niceToHave.length === 0
      ? mustRatio
      : mustHave.length === 0
        ? niceRatio
        : mustRatio * mustWeight + niceRatio * niceWeight;

  return {
    points: ratio * maxPoints,
    matched: [...must.matched, ...nice.matched],
    partial: [...must.partial, ...nice.partial],
    missing: [...must.missing, ...nice.missing],
  };
}

export function scoreExperienceAndSeniority(
  profileYears: number,
  job: CareerJob,
  maxExperiencePoints: number,
  maxSeniorityPoints: number,
): {
  experiencePoints: number;
  seniorityPoints: number;
  experienceNote: string;
  seniorityNote: string;
  profileLevel: ProfileLevel;
  jobLevel: JobSeniority;
} {
  const minExp = job.minExperience ?? 0;
  const maxExp = job.experienceMax ?? 99;
  const profileLevel = profileSeniorityLevel(profileYears);
  const jobLevel = jobSeniorityLevel(job);

  let experiencePoints = 0;
  if (profileYears >= minExp && profileYears <= maxExp) {
    experiencePoints = maxExperiencePoints;
  } else if (profileYears >= minExp && profileYears > maxExp) {
    experiencePoints = maxExperiencePoints * 0.75;
  } else if (minExp > 0 && profileYears > 0) {
    experiencePoints = Math.min(maxExperiencePoints * 0.5, (profileYears / minExp) * maxExperiencePoints * 0.5);
  }

  const profileRank = LEVEL_RANK[profileLevel];
  const jobRank = LEVEL_RANK[jobLevel === 'unknown' ? 'mid' : (jobLevel as ProfileLevel)] ?? 1;
  const gap = profileRank - jobRank;

  let seniorityPoints = maxSeniorityPoints;
  if (gap === 0) seniorityPoints = maxSeniorityPoints;
  else if (gap === 1) seniorityPoints = maxSeniorityPoints * 0.85;
  else if (gap === -1) seniorityPoints = maxSeniorityPoints * 0.55;
  else if (gap >= 2) seniorityPoints = maxSeniorityPoints * 0.35;
  else seniorityPoints = maxSeniorityPoints * 0.25;

  if (gap <= -2 && experiencePoints > maxExperiencePoints * 0.3) {
    experiencePoints = Math.min(experiencePoints, maxExperiencePoints * 0.3);
  }

  return {
    experiencePoints,
    seniorityPoints,
    experienceNote: `${profileYears}y vs role ${minExp}–${maxExp}y`,
    seniorityNote: `${profileLevel} profile vs ${jobLevel} role`,
    profileLevel,
    jobLevel,
  };
}

export function scoreRoleTitle(preferredRoles: string[], jobTitle: string, maxPoints: number): {
  points: number;
  note: string;
} {
  if (preferredRoles.length === 0) {
    return { points: maxPoints * 0.5, note: 'No role preference set' };
  }

  const titleLower = jobTitle.toLowerCase();
  let best = 0;
  let bestRole = '';

  for (const role of preferredRoles) {
    const roleLower = role.toLowerCase().trim();
    if (!roleLower) continue;

    if (titleLower.includes(roleLower) || roleLower.includes(titleLower)) {
      best = 1;
      bestRole = role;
      break;
    }

    const overlap = tokenOverlapScore(roleLower, titleLower);
    if (overlap > best) {
      best = overlap;
      bestRole = role;
    }
  }

  if (best >= 0.85) {
    return { points: maxPoints, note: `Title aligns with ${bestRole}` };
  }
  if (best >= 0.5) {
    return { points: maxPoints * 0.7, note: `Partial title fit (${bestRole})` };
  }
  if (best >= 0.3) {
    return { points: maxPoints * 0.4, note: 'Weak title overlap' };
  }
  return { points: 0, note: 'Title does not match preferred roles' };
}

function tokenOverlapScore(role: string, title: string): number {
  const roleTokens = role.split(/\s+/).filter((t) => t.length > 2);
  if (roleTokens.length === 0) return 0;
  const titleTokens = new Set(title.split(/\s+/).filter((t) => t.length > 2));
  let hits = 0;
  for (const token of roleTokens) {
    if (titleTokens.has(token)) hits++;
  }
  return hits / roleTokens.length;
}

export function scoreLocation(
  preferredLocs: string[],
  workPref: string,
  job: CareerJob,
  maxPoints: number,
): { points: number; note: string } {
  const jobCity = (job.city ?? job.location ?? '').toLowerCase();
  const workMode = getJobWorkMode(job);
  const isRemoteCapable = workMode === 'remote' || workMode === 'hybrid' || jobCity.includes('remote');

  if (workPref === 'remote') {
    if (workMode === 'remote') return { points: maxPoints, note: 'Remote role' };
    if (workMode === 'hybrid') return { points: maxPoints * 0.85, note: 'Hybrid with remote option' };
    return { points: 0, note: 'Onsite — remote preferred' };
  }

  if (workPref === 'hybrid') {
    if (workMode === 'hybrid') return { points: maxPoints, note: 'Hybrid role' };
    if (workMode === 'remote') return { points: maxPoints * 0.8, note: 'Remote (hybrid OK)' };
  }

  if (preferredLocs.length > 0) {
    const locHit = preferredLocs.some((loc) => locationMatches(loc, jobCity));
    if (locHit) return { points: maxPoints, note: 'Preferred location' };

    if (isRemoteCapable && workPref !== 'onsite') {
      return { points: maxPoints * 0.65, note: 'Remote/hybrid fallback' };
    }

    return { points: 0, note: `Outside preferred locations` };
  }

  return { points: maxPoints * 0.5, note: 'No location preference' };
}

export function locationMatches(preferred: string, jobCity: string): boolean {
  if (!preferred || !jobCity) return false;

  const pref = preferred.toLowerCase().trim();
  const city = jobCity.toLowerCase();

  if (city.includes(pref) || pref.includes(city.split(',')[0]?.trim() ?? '')) {
    return true;
  }

  const prefKey = pref.split(/\s+/)[0];
  const aliases = CITY_ALIASES[prefKey] ?? [prefKey];
  if (aliases.some((alias) => city.includes(alias))) {
    return true;
  }

  for (const [state, cities] of Object.entries(STATE_HINTS)) {
    if (pref.includes(state) || state.includes(pref)) {
      if (cities.some((c) => city.includes(c))) return true;
    }
    if (cities.some((c) => pref.includes(c) || c.includes(prefKey))) {
      if (cities.some((c) => city.includes(c))) return true;
    }
  }

  return false;
}

export function parseSalaryLPA(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const parsed = parseSalaryFromText(raw);
  if (parsed.min) return Math.round((parsed.min / 100_000) * 10) / 10;
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return n > 1000 ? Math.round((n / 100_000) * 10) / 10 : n;
}

export function inrToLPA(inr: number | null | undefined): number | null {
  if (!inr) return null;
  return inr > 1000 ? Math.round((inr / 100_000) * 10) / 10 : inr;
}

export function scoreSalary(
  expectedSalaryL: number | null,
  jobMinL: number | null,
  jobMaxL: number | null,
  maxPoints: number,
): { points: number; note?: string } {
  if (expectedSalaryL !== null && jobMinL !== null && jobMaxL !== null) {
    if (expectedSalaryL >= jobMinL && expectedSalaryL <= jobMaxL * 1.15) {
      return { points: maxPoints, note: `Expect ${expectedSalaryL}L, range ${jobMinL}–${jobMaxL}L` };
    }
    if (expectedSalaryL <= jobMaxL) {
      return { points: maxPoints * 0.75, note: 'Within employer budget' };
    }
    return { points: maxPoints * 0.15, note: `Expect ${expectedSalaryL}L, max ${jobMaxL}L` };
  }
  return { points: maxPoints * 0.5, note: 'Salary data incomplete' };
}

export function buildStoredMatchFactors(
  display: string[],
  breakdown: MatchFactorBreakdown,
): StoredMatchFactors {
  return { display, breakdown };
}

export function emptyMatchBreakdown(): MatchFactorBreakdown {
  return {
    skills: { matched: [], partial: [], missing: [], score: 0, max: 40 },
    experience: { profileYears: 0, required: '—', score: 0, max: 14 },
    seniority: { profile: 'unknown', job: 'unknown', score: 0, max: 6 },
    salary: { score: 0, max: 15 },
    location: { score: 0, max: 15 },
    role: { score: 0, max: 5 },
    notice: { score: 0, max: 5 },
    overall_band: 'low',
  };
}

export function overallBand(score: number): string {
  if (score >= 95) return 'excellent';
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 50) return 'partial';
  return 'low';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatSkillDisplayLines(
  matched: string[],
  partial: string[],
  missing: string[],
): { display: string[]; missingDisplay: string[] } {
  const display: string[] = [];
  matched.forEach((s) => display.push(`✓ ${cap(s)}`));
  partial.forEach((s) => display.push(`≈ ${cap(s)} (related)`));
  const missingDisplay = missing.map((s) => cap(s));
  return { display, missingDisplay };
}
