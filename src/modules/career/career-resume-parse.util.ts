import { ParsedCareerProfile } from './career-parsed-profile.types';

const SKIP_NAME_PATTERNS =
  /^(resume|curriculum vitae|cv|profile|personal details|contact|objective|summary|about me|professional summary)/i;
const JOB_TITLE_HINTS =
  /\b(developer|engineer|manager|analyst|designer|consultant|architect|lead|specialist|administrator|coordinator|executive|programmer|tester|qa|devops|full[\s-]?stack|frontend|backend|data scientist|product manager|php|java|react|node|laravel|android|ios)\b/i;
const SECTION_BREAK =
  /^(education|experience|work experience|employment|professional experience|work history|projects|certifications|achievements|awards|languages|references|personal details|contact|summary|objective|about)/i;

const SKILL_KEYWORDS = [
  'react', 'react.js', 'reactjs', 'node.js', 'nodejs', 'javascript', 'typescript', 'python', 'java',
  'spring', 'spring boot', 'angular', 'vue', 'vue.js', 'laravel', 'php', 'mysql', 'postgresql', 'mongodb',
  'redis', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops', 'jenkins', 'git', 'github', 'gitlab',
  'html', 'css', 'sass', 'tailwind', 'bootstrap', 'nestjs', 'express', 'django', 'flask', 'fastapi',
  'graphql', 'rest', 'api', 'microservices', 'kafka', 'rabbitmq', 'elasticsearch', 'terraform', 'ansible',
  'linux', 'sql', 'nosql', 'firebase', 'wordpress', 'shopify', 'magento', 'codeigniter', 'symfony',
  'android', 'kotlin', 'swift', 'flutter', 'react native', 'selenium', 'cypress', 'jest', 'junit',
  'agile', 'scrum', 'jira', 'figma', 'power bi', 'excel', 'salesforce', 'sap', 'oracle', '.net', 'c#',
  'c++', 'go', 'golang', 'rust', 'ruby', 'rails', 'blockchain', 'machine learning', 'deep learning',
  'tensorflow', 'pytorch', 'pandas', 'numpy', 'tableau', 'snowflake', 'spark', 'hadoop',
];

const INDIAN_CITIES = [
  'mumbai', 'pune', 'bangalore', 'bengaluru', 'delhi', 'new delhi', 'noida', 'gurgaon', 'gurugram',
  'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'indore', 'nagpur', 'kochi', 'coimbatore',
  'chandigarh', 'lucknow', 'bhopal', 'remote',
];

/** Normalize AI JSON with alternate key names and bad types. */
export function normalizeRawAiParse(raw: unknown): ParsedCareerProfile | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;

  const str = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s.length > 0 ? s : undefined;
  };

  const arr = (v: unknown): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) {
      return v.map((x) => String(x).trim()).filter(Boolean);
    }
    if (typeof v === 'string') {
      return splitSkillTokens(v);
    }
    return [];
  };

  const experienceRaw = o.experience ?? o.work_experience ?? o.workExperience ?? o.employment;
  const experience = parseExperienceArray(experienceRaw);

  const parsed: ParsedCareerProfile = {
    full_name: str(o.full_name ?? o.fullName ?? o.name ?? o.candidate_name),
    email: str(o.email ?? o.email_address),
    phone: normalizePhone(str(o.phone ?? o.phone_number ?? o.mobile)),
    skills: arr(o.skills ?? o.technical_skills ?? o.skill_set),
    experience,
    education: parseEducationArray(o.education),
    certifications: arr(o.certifications ?? o.certs),
    projects: arr(o.projects),
    languages: arr(o.languages),
    current_location: str(o.current_location ?? o.currentLocation ?? o.location ?? o.city),
    preferred_locations: arr(o.preferred_locations ?? o.preferredLocations),
    current_salary: str(o.current_salary ?? o.currentSalary),
    expected_salary: str(o.expected_salary ?? o.expectedSalary),
    notice_period: str(o.notice_period ?? o.noticePeriod),
    work_preference: str(o.work_preference ?? o.workPreference),
    preferred_roles: arr(o.preferred_roles ?? o.preferredRoles ?? o.target_roles ?? o.current_role),
  };

  return parsed;
}

export function mergeParsedProfiles(
  ai: ParsedCareerProfile | null,
  basic: ParsedCareerProfile | null,
  resumeText?: string,
): ParsedCareerProfile | null {
  const sectionParsed = resumeText ? extractSectionFields(resumeText) : null;
  const sources = [ai, basic, sectionParsed].filter(Boolean) as ParsedCareerProfile[];

  if (sources.length === 0) {
    return null;
  }

  const merged: ParsedCareerProfile = {
    full_name: pickBestName(sources, resumeText),
    email: firstDefined(sources.map((s) => s.email)),
    phone: firstDefined(sources.map((s) => s.phone)),
    skills: mergeSkills(sources, resumeText),
    experience: mergeExperience(sources),
    education: firstNonEmptyArray(sources.map((s) => s.education)) ?? [],
    certifications: mergeStringArrays(sources.map((s) => s.certifications)),
    projects: mergeStringArrays(sources.map((s) => s.projects)),
    languages: mergeStringArrays(sources.map((s) => s.languages)),
    current_location: firstDefined(sources.map((s) => s.current_location)),
    preferred_locations: mergeStringArrays(sources.map((s) => s.preferred_locations)),
    current_salary: firstDefined(sources.map((s) => s.current_salary)),
    expected_salary: firstDefined(sources.map((s) => s.expected_salary)),
    notice_period: firstDefined(sources.map((s) => s.notice_period)),
    work_preference: firstDefined(sources.map((s) => s.work_preference)),
    preferred_roles: mergePreferredRoles(sources, resumeText),
  };

  return finalizeParsedProfile(merged, resumeText);
}

/** Heuristic extraction — used when AI fails and to enrich AI output. */
export function extractBasicFieldsFromResume(text: string): ParsedCareerProfile {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blob = text.toLowerCase();

  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  const phone = normalizePhone(
    text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/)?.[0] ??
      text.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/)?.[0],
  );

  const currentLocation =
    extractLabeledValue(text, /(?:location|city|based in|address|current location)[:\s]+/i) ??
    INDIAN_CITIES.find((c) => blob.includes(c))
      ?.split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  const salaryMatch = text.match(
    /(?:current\s*)?salary[:\s]+([^\n]{2,30})/i,
  );
  const expectedMatch = text.match(/expected\s*salary[:\s]+([^\n]{2,30})/i);
  const noticeMatch = text.match(/notice\s*period[:\s]+([^\n]{2,25})/i);

  const fullName = detectName(lines, email);
  const skills = extractSkillsFromText(text);
  const experience = extractExperienceFromText(text);
  const preferredRoles = extractHeadlineRoles(lines, experience);

  return finalizeParsedProfile(
    {
      full_name: fullName,
      email,
      phone,
      skills: skills.length > 0 ? skills : undefined,
      experience: experience.length > 0 ? experience : undefined,
      current_location: currentLocation,
      current_salary: salaryMatch?.[1]?.trim(),
      expected_salary: expectedMatch?.[1]?.trim(),
      notice_period: noticeMatch?.[1]?.trim(),
      preferred_roles: preferredRoles.length > 0 ? preferredRoles : undefined,
    },
    text,
  );
}

function finalizeParsedProfile(
  parsed: ParsedCareerProfile,
  resumeText?: string,
): ParsedCareerProfile {
  const out = { ...parsed };

  if (out.full_name) {
    out.full_name = cleanName(out.full_name);
  }
  if (out.full_name && looksLikeJobTitle(out.full_name)) {
    out.full_name = undefined;
  }

  if (out.skills?.length) {
    out.skills = dedupeStrings(out.skills.map(normalizeSkillToken).filter(Boolean));
  }

  if (out.experience?.length) {
    out.experience = out.experience
      .map((e) => ({
        title: e.title?.trim(),
        company: e.company?.trim(),
        years: e.years ? String(e.years).trim() : undefined,
        summary: e.summary?.trim(),
      }))
      .filter((e) => e.title || e.company)
      .slice(0, 12);
  }

  if (!out.preferred_roles?.length && out.experience?.length) {
    out.preferred_roles = out.experience
      .map((e) => e.title)
      .filter((t): t is string => Boolean(t && !looksLikeCompany(t)))
      .slice(0, 3);
  }

  if (resumeText && (!out.skills?.length || out.skills.length < 3)) {
    const extra = extractSkillsFromText(resumeText);
    out.skills = dedupeStrings([...(out.skills ?? []), ...extra]);
  }

  if (resumeText && (!out.experience?.length || out.experience.length < 1)) {
    const extra = extractExperienceFromText(resumeText);
    if (extra.length > 0) {
      out.experience = extra;
    }
  }

  if (resumeText && !out.full_name) {
    out.full_name = detectName(resumeText.split('\n').map((l) => l.trim()).filter(Boolean), out.email);
  }

  if (resumeText && !out.preferred_roles?.length) {
    out.preferred_roles = extractHeadlineRoles(
      resumeText.split('\n').map((l) => l.trim()).filter(Boolean),
      out.experience ?? [],
    );
  }

  return out;
}

function extractSectionFields(text: string): ParsedCareerProfile {
  return {
    skills: extractSkillsFromText(text),
    experience: extractExperienceFromText(text),
    preferred_roles: extractHeadlineRoles(
      text.split('\n').map((l) => l.trim()).filter(Boolean),
      extractExperienceFromText(text),
    ),
  };
}

function detectName(lines: string[], email?: string): string | undefined {
  const candidates: Array<{ value: string; score: number }> = [];

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i];
    const score = scoreNameLine(line, i);
    if (score > 0) {
      candidates.push({ value: line, score });
    }
  }

  if (email) {
    const emailIdx = lines.findIndex((l) => l.includes(email));
    if (emailIdx > 0) {
      const prev = lines[emailIdx - 1];
      const score = scoreNameLine(prev, emailIdx - 1) + 3;
      if (score > 0) {
        candidates.push({ value: prev, score });
      }
    }
  }

  const labeled =
    lines
      .map((l) => l.match(/^(?:name|full name)[:\s]+(.{2,60})$/i)?.[1]?.trim())
      .find(Boolean) ?? undefined;
  if (labeled) {
    candidates.push({ value: labeled, score: 10 });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best ? cleanName(best.value) : undefined;
}

function scoreNameLine(line: string, index: number): number {
  if (!line || line.length < 3 || line.length > 60) return 0;
  if (SKIP_NAME_PATTERNS.test(line)) return 0;
  if (/@|https?:|linkedin|github|www\./i.test(line)) return 0;
  if (/^\d{5,}|\+?\d{10}/.test(line)) return 0;
  if (/[,|]/.test(line) && line.split(/[,|]/).length > 2) return 0;
  if (JOB_TITLE_HINTS.test(line) && !/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/.test(line)) {
    return 0;
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return 0;

  let score = 5 - Math.min(index, 4);
  if (words.every((w) => /^[A-Z][a-zA-Z.'-]+$/.test(w) || /^[A-Z]{2,}$/.test(w))) {
    score += 4;
  }
  if (words.length === 2 || words.length === 3) {
    score += 2;
  }
  return score;
}

function cleanName(name: string | undefined): string {
  if (!name?.trim()) return '';
  return name
    .replace(/^(?:name|full name)[:\s]+/i, '')
    .replace(/\s*(?:resume|cv)$/i, '')
    .replace(/\|.*$/, '')
    .trim();
}

function looksLikeJobTitle(text: string): boolean {
  const t = text.toLowerCase();
  return JOB_TITLE_HINTS.test(t) && !/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,2}$/.test(text);
}

function looksLikeCompany(text: string): boolean {
  return /\b(pvt|ltd|limited|llp|inc|corp|technologies|solutions|services|consulting)\b/i.test(text);
}

function extractHeadlineRoles(
  lines: string[],
  experience: NonNullable<ParsedCareerProfile['experience']>,
): string[] {
  const roles: string[] = [];

  for (const line of lines.slice(0, 10)) {
    if (SKIP_NAME_PATTERNS.test(line) || line.length > 90) continue;
    const designation = line.match(/(?:designation|current role|target role|role)[:\s]+(.+)/i)?.[1]?.trim();
    if (designation && JOB_TITLE_HINTS.test(designation)) {
      roles.push(designation);
    }
    if (JOB_TITLE_HINTS.test(line) && !looksLikeCompany(line) && !/@/.test(line)) {
      const cleaned = line.split('|')[0].split('•')[0].trim();
      if (cleaned.length >= 5 && cleaned.length <= 70) {
        roles.push(cleaned);
      }
    }
  }

  for (const exp of experience) {
    if (exp.title && !looksLikeCompany(exp.title)) {
      roles.push(exp.title);
    }
  }

  return dedupeStrings(roles).slice(0, 4);
}

function extractSkillsFromText(text: string): string[] {
  const found = new Set<string>();
  const blob = text.toLowerCase();

  for (const kw of SKILL_KEYWORDS) {
    if (blob.includes(kw.toLowerCase())) {
      found.add(normalizeSkillToken(kw));
    }
  }

  const skillsSection = extractSectionText(
    text,
    /^(?:technical\s*)?skills?(?:\s*&?\s*tools?)?|core competencies|technologies used|key skills|expertise|technical proficiencies?/i,
  );
  if (skillsSection) {
    for (const token of splitSkillTokens(skillsSection)) {
      if (token.length >= 2 && token.length <= 40) {
        found.add(normalizeSkillToken(token));
      }
    }
  }

  for (const line of text.split('\n')) {
    if (/^[-•●▪]\s*/.test(line.trim())) {
      const token = line.replace(/^[-•●▪]\s*/, '').split(/[,|:]/)[0].trim();
      if (token.length >= 2 && token.length <= 35 && !/\d{4}/.test(token)) {
        found.add(normalizeSkillToken(token));
      }
    }
  }

  return dedupeStrings([...found]);
}

function extractExperienceFromText(text: string): NonNullable<ParsedCareerProfile['experience']> {
  const entries: NonNullable<ParsedCareerProfile['experience']> = [];
  const expSection = extractSectionText(
    text,
    /^(?:work\s*)?experience|employment(?: history)?|professional experience|work history|career history/i,
  );
  const scanText = expSection || text;
  const lines = scanText.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SECTION_BREAK.test(line) && i > 0) break;

    const parsed = parseExperienceLine(line, lines[i + 1], lines[i + 2]);
    if (parsed) {
      entries.push(parsed);
      continue;
    }

    const dateMatch = line.match(
      /(\w+\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*[-–—to]+\s*(present|current|now|\w+\s+\d{4}|\d{4})/i,
    );
    if (dateMatch && i > 0) {
      const titleLine = lines[i - 1];
      const companyLine =
        lines[i - 2] && !/(\d{4}|present|current)/i.test(lines[i - 2]) ? lines[i - 2] : undefined;
      const years = yearsFromRange(dateMatch[0]);
      if (titleLine && !SECTION_BREAK.test(titleLine)) {
        const atSplit = titleLine.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
        if (atSplit) {
          entries.push({
            title: atSplit[1].trim(),
            company: atSplit[2].trim(),
            years,
          });
        } else if (companyLine && looksLikeCompany(companyLine)) {
          entries.push({ title: titleLine, company: companyLine, years });
        } else {
          const pipe = titleLine.match(/^(.+?)\s*[|–-]\s*(.+)$/);
          if (pipe) {
            entries.push({
              title: pipe[1].trim(),
              company: pipe[2].trim(),
              years,
            });
          } else {
            entries.push({ title: titleLine, years });
          }
        }
      }
    }
  }

  return dedupeExperience(entries).slice(0, 12);
}

function parseExperienceLine(
  line: string,
  next?: string,
  next2?: string,
): NonNullable<ParsedCareerProfile['experience']>[number] | null {
  if (line.length < 5 || SECTION_BREAK.test(line)) return null;

  const atMatch = line.match(
    /^(.{3,70}?)\s+(?:at|@)\s+(.{2,70}?)(?:\s*[\(|,-]\s*(.+?)\)?)?$/i,
  );
  if (atMatch && JOB_TITLE_HINTS.test(atMatch[1])) {
    return {
      title: atMatch[1].trim(),
      company: atMatch[2].trim(),
      years: extractYearsFromTail(atMatch[3]) ?? inferYearsFromNeighbor(next),
    };
  }

  const pipeMatch = line.match(/^(.{3,60}?)\s*[|]\s*(.{2,60}?)(?:\s*[|]\s*(.+))?$/);
  if (pipeMatch && JOB_TITLE_HINTS.test(pipeMatch[1])) {
    return {
      title: pipeMatch[1].trim(),
      company: pipeMatch[2].trim(),
      years: extractYearsFromTail(pipeMatch[3]) ?? inferYearsFromNeighbor(next),
    };
  }

  const dashMatch = line.match(/^(.{3,60}?)\s*[-–—]\s*(.{2,60}?)(?:\s*[\(,]\s*(.+?)\)?)?$/);
  if (dashMatch && JOB_TITLE_HINTS.test(dashMatch[1]) && !looksLikeCompany(dashMatch[1])) {
    return {
      title: dashMatch[1].trim(),
      company: dashMatch[2].trim(),
      years: extractYearsFromTail(dashMatch[3]) ?? inferYearsFromNeighbor(next),
    };
  }

  if (JOB_TITLE_HINTS.test(line) && next && /(\d{4}|present|current)/i.test(next)) {
    const company = next.replace(/(\w+\s*)?\d{4}.*/i, '').trim() || next2?.trim();
    return {
      title: line,
      company: company && !/(\d{4}|present)/i.test(company) ? company : undefined,
      years: yearsFromRange(next) ?? inferYearsFromNeighbor(next),
    };
  }

  return null;
}

function parseExperienceArray(raw: unknown): ParsedCareerProfile['experience'] {
  if (!raw) return undefined;
  if (!Array.isArray(raw)) return undefined;

  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const m = item.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
        if (m) return { title: m[1].trim(), company: m[2].trim() };
        return { title: item.trim() };
      }
      if (!item || typeof item !== 'object') return null;
      const e = item as Record<string, unknown>;
      const title = String(e.title ?? e.role ?? e.position ?? e.designation ?? '').trim();
      const company = String(e.company ?? e.employer ?? e.organization ?? '').trim();
      let years = String(e.years ?? e.duration ?? e.period ?? '').trim();
      if (!years && e.start_date && e.end_date) {
        years = yearsFromRange(`${e.start_date} - ${e.end_date}`) ?? years;
      }
      const summary = String(e.summary ?? e.description ?? e.responsibilities ?? '').trim();
      if (!title && !company) return null;
      return {
        title: title || undefined,
        company: company || undefined,
        years: years || undefined,
        summary: summary || undefined,
      };
    })
    .filter(Boolean) as NonNullable<ParsedCareerProfile['experience']>;
}

function parseEducationArray(raw: unknown): ParsedCareerProfile['education'] {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const e = item as Record<string, unknown>;
      return {
        degree: String(e.degree ?? e.qualification ?? '').trim() || undefined,
        institution: String(e.institution ?? e.college ?? e.university ?? e.school ?? '').trim() || undefined,
        year: String(e.year ?? e.graduation_year ?? '').trim() || undefined,
      };
    })
    .filter((e) => e && (e.degree || e.institution)) as NonNullable<ParsedCareerProfile['education']>;
}

function extractSectionText(text: string, headerPattern: RegExp): string | null {
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerPattern.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;

  const collected: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (SECTION_BREAK.test(t) && collected.length > 0) break;
    collected.push(t);
    if (collected.length > 40) break;
  }
  return collected.join('\n');
}

function splitSkillTokens(raw: string): string[] {
  return raw
    .split(/[,|•●▪;\n/]+/)
    .map((s) => s.replace(/^[-•●▪]\s*/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 40 && !/^\d+$/.test(s));
}

function normalizeSkillToken(skill: string): string {
  const s = skill.trim();
  const map: Record<string, string> = {
    nodejs: 'Node.js',
    'node.js': 'Node.js',
    reactjs: 'React',
    'react.js': 'React',
    vuejs: 'Vue.js',
    'vue.js': 'Vue.js',
    postgresql: 'PostgreSQL',
    mongodb: 'MongoDB',
    mysql: 'MySQL',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    php: 'PHP',
    html: 'HTML',
    css: 'CSS',
    aws: 'AWS',
    gcp: 'GCP',
    api: 'REST APIs',
    '.net': '.NET',
    'c#': 'C#',
    'c++': 'C++',
  };
  const lower = s.toLowerCase();
  if (map[lower]) return map[lower];
  if (s.length <= 4) return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone.trim();
}

function extractLabeledValue(text: string, labelPattern: RegExp): string | undefined {
  const m = text.match(new RegExp(`${labelPattern.source}([^\\n]{2,40})`, 'i'));
  return m?.[1]?.split(/[,|]/)[0]?.trim();
}

function extractYearsFromTail(tail?: string): string | undefined {
  if (!tail) return undefined;
  const y = tail.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y\b)/i);
  if (y) return y[1];
  return yearsFromRange(tail);
}

function inferYearsFromNeighbor(line?: string): string | undefined {
  if (!line) return undefined;
  return yearsFromRange(line) ?? extractYearsFromTail(line);
}

function yearsFromRange(range: string): string | undefined {
  const m = range.match(
    /(\d{4})\s*[-–—to]+\s*(present|current|now|(\w+\s+)?(\d{4}))/i,
  );
  if (!m) return undefined;
  const startYear = parseInt(m[1], 10);
  let endYear = new Date().getFullYear();
  if (m[2] && !/present|current|now/i.test(m[2])) {
    const endMatch = m[2].match(/(\d{4})/);
    if (endMatch) endYear = parseInt(endMatch[1], 10);
  }
  if (Number.isNaN(startYear) || endYear < startYear) return undefined;
  const yrs = endYear - startYear;
  return yrs > 0 ? String(Math.min(yrs, 40)) : '1';
}

function pickBestName(sources: ParsedCareerProfile[], resumeText?: string): string | undefined {
  const fromResume = resumeText
    ? detectName(resumeText.split('\n').map((l) => l.trim()).filter(Boolean), undefined)
    : undefined;
  const candidates = [
    fromResume,
    ...sources.map((s) => s.full_name).filter(Boolean),
  ].filter((name): name is string => Boolean(name?.trim()));

  const scored = candidates
    .map((name) => ({
      name: cleanName(name),
      score: scoreNameLine(cleanName(name), 0) + (looksLikeJobTitle(name) ? -5 : 0),
    }))
    .filter((c) => c.score > 0 && c.name.length >= 2);

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name;
}

function mergeSkills(sources: ParsedCareerProfile[], resumeText?: string): string[] | undefined {
  const all: string[] = [];
  for (const s of sources) {
    if (s.skills?.length) all.push(...s.skills);
  }
  if (resumeText) {
    all.push(...extractSkillsFromText(resumeText));
  }
  const merged = dedupeStrings(all.map(normalizeSkillToken));
  return merged.length > 0 ? merged : undefined;
}

function mergeExperience(
  sources: ParsedCareerProfile[],
): ParsedCareerProfile['experience'] {
  const lists = sources.map((s) => s.experience ?? []).filter((l) => l.length > 0);
  if (lists.length === 0) return undefined;

  lists.sort((a, b) => b.length - a.length);
  let best = lists[0];
  for (const list of lists.slice(1)) {
    best = dedupeExperience([...best, ...list]);
  }
  return best.length > 0 ? best : undefined;
}

function mergePreferredRoles(sources: ParsedCareerProfile[], resumeText?: string): string[] | undefined {
  const roles: string[] = [];
  for (const s of sources) {
    if (s.preferred_roles?.length) roles.push(...s.preferred_roles);
  }
  for (const s of sources) {
    for (const e of s.experience ?? []) {
      if (e.title) roles.push(e.title);
    }
  }
  if (resumeText) {
    roles.push(
      ...extractHeadlineRoles(
        resumeText.split('\n').map((l) => l.trim()).filter(Boolean),
        sources.flatMap((s) => s.experience ?? []),
      ),
    );
  }
  const merged = dedupeStrings(roles.filter((r) => !looksLikeCompany(r) && r.length >= 3));
  return merged.length > 0 ? merged.slice(0, 4) : undefined;
}

function mergeStringArrays(arrays: (string[] | undefined)[]): string[] | undefined {
  const merged = dedupeStrings(arrays.flatMap((a) => a ?? []));
  return merged.length > 0 ? merged : undefined;
}

function firstDefined(values: (string | undefined)[]): string | undefined {
  return values.find((v) => v && v.trim().length > 0);
}

function firstNonEmptyArray<T>(arrays: (T[] | undefined)[]): T[] | undefined {
  return arrays.find((a) => a && a.length > 0);
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function dedupeExperience(
  entries: NonNullable<ParsedCareerProfile['experience']>,
): NonNullable<ParsedCareerProfile['experience']> {
  const seen = new Set<string>();
  const out: NonNullable<ParsedCareerProfile['experience']> = [];
  for (const e of entries) {
    const key = `${(e.title ?? '').toLowerCase()}|${(e.company ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
