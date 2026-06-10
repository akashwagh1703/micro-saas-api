import { CareerInterviewType } from './career.constants';

export interface InterviewEvalBreakdown {
  completeness: number;
  specificity: number;
  relevance: number;
  structure: number;
}

export interface InterviewEvalResult {
  score: number;
  feedback: string;
  breakdown: InterviewEvalBreakdown;
  tips: string[];
}

export interface InterviewEvalInput {
  interviewType: CareerInterviewType | string;
  role: string;
  question: string;
  answer: string;
}

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'been', 'being', 'could', 'from', 'have', 'into',
  'just', 'like', 'more', 'much', 'some', 'such', 'than', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'very', 'what',
  'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'tell',
  'describe', 'explain', 'walk', 'through', 'please', 'question', 'interview',
]);

const GENERIC_FEEDBACK = [
  'good effort',
  'thanks for your answer',
  'try adding a concrete example',
  'add more specific examples next time',
  'add a concrete example from your experience',
];

/** Deterministic rubric score (0–100) with answer-specific tips. */
export function evaluateInterviewAnswerHeuristic(input: InterviewEvalInput): InterviewEvalResult {
  const answer = input.answer.trim();
  const question = input.question.trim();
  const type = normalizeInterviewType(input.interviewType);

  const breakdown: InterviewEvalBreakdown = {
    completeness: scoreCompleteness(answer),
    specificity: scoreSpecificity(answer),
    relevance: scoreRelevance(question, answer),
    structure: scoreStructure(type, question, answer),
  };

  const score = clamp(
    breakdown.completeness +
      breakdown.specificity +
      breakdown.relevance +
      breakdown.structure,
    0,
    100,
  );

  const tips = buildTips(type, question, answer, breakdown);
  const feedback = buildFeedback(score, tips, breakdown);

  return { score, feedback, breakdown, tips };
}

/** Blend heuristic baseline with optional AI evaluation for stable, fair scores. */
export function mergeInterviewEvaluation(
  heuristic: InterviewEvalResult,
  ai: { score: number; feedback: string } | null,
): InterviewEvalResult {
  if (!ai || !Number.isFinite(ai.score)) {
    return heuristic;
  }

  const aiScore = clamp(Math.round(ai.score), 0, 100);
  const hScore = heuristic.score;
  const diff = Math.abs(aiScore - hScore);

  let mergedScore: number;
  if (diff > 30) {
    mergedScore = Math.round(0.7 * hScore + 0.3 * aiScore);
  } else if (diff > 15) {
    mergedScore = Math.round(0.55 * hScore + 0.45 * aiScore);
  } else {
    mergedScore = Math.round(0.35 * hScore + 0.65 * aiScore);
  }

  const feedback = pickFeedback(heuristic, ai.feedback, mergedScore);

  return {
    score: mergedScore,
    feedback,
    breakdown: heuristic.breakdown,
    tips: heuristic.tips,
  };
}

/** Top actionable tips across a mock session (weakest dimensions first). */
export function aggregateSessionTips(
  answers: Array<{ tips?: string[]; breakdown?: InterviewEvalBreakdown }>,
  limit = 3,
): string[] {
  const counts = new Map<string, number>();

  for (const answer of answers) {
    for (const tip of answer.tips ?? []) {
      counts.set(tip, (counts.get(tip) ?? 0) + 1);
    }
    if (answer.breakdown) {
      for (const tip of tipsFromBreakdown(answer.breakdown)) {
        counts.set(tip, (counts.get(tip) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tip]) => tip);
}

export function parseInterviewEvalJson(raw: string): { score: number; feedback: string } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const obj = JSON.parse(match[0]) as {
      score?: unknown;
      feedback?: unknown;
      improvements?: unknown;
      suggestion?: unknown;
      tips?: unknown;
    };

    const scoreRaw = obj.score;
    const score =
      typeof scoreRaw === 'number'
        ? scoreRaw
        : typeof scoreRaw === 'string'
          ? parseFloat(scoreRaw.replace(/[^\d.]/g, ''))
          : NaN;

    if (!Number.isFinite(score)) {
      return null;
    }

    let feedback = String(obj.feedback ?? '').trim();
    const extraTips = extractStringList(obj.improvements ?? obj.tips ?? obj.suggestion);
    if (extraTips.length > 0) {
      const extra = extraTips.slice(0, 2).join(' ');
      feedback = feedback ? `${feedback} ${extra}`.trim() : extra;
    }

    return {
      score: clamp(Math.round(score), 0, 100),
      feedback: feedback || '',
    };
  } catch {
    return null;
  }
}

function scoreCompleteness(answer: string): number {
  const words = wordCount(answer);
  const sentences = sentenceCount(answer);

  if (words < 8) {
    return 4;
  }
  if (words < 20) {
    return 12;
  }
  if (words < 45) {
    return 18 + Math.min(4, sentences);
  }
  if (words < 90) {
    return 22 + Math.min(3, Math.floor(sentences / 2));
  }
  return 25;
}

function scoreSpecificity(answer: string): number {
  let score = 8;
  const lower = answer.toLowerCase();

  if (/\d+/.test(answer)) {
    score += 6;
  }
  if (/%|\bpercent\b|\bx\b|\btimes\b|\bfold\b/i.test(answer)) {
    score += 4;
  }
  if (/\b(reduced|increased|improved|saved|delivered|achieved|grew|cut|boosted)\b/i.test(lower)) {
    score += 4;
  }
  if (/\b(i |i'|my role|i led|i built|i created|i implemented|i designed|i managed)\b/i.test(lower)) {
    score += 4;
  }
  if (/\b(project|client|team|company|product|system|module|feature|release)\b/i.test(lower)) {
    score += 3;
  }

  return clamp(score, 0, 25);
}

function scoreRelevance(question: string, answer: string): number {
  const qTokens = tokenize(question);
  const aTokens = tokenize(answer);

  if (qTokens.size === 0) {
    return 15;
  }

  let hits = 0;
  for (const token of qTokens) {
    if (aTokens.has(token)) {
      hits += 1;
    }
  }

  const ratio = hits / qTokens.size;
  if (ratio >= 0.45) {
    return 25;
  }
  if (ratio >= 0.3) {
    return 20;
  }
  if (ratio >= 0.15) {
    return 14;
  }
  if (ratio > 0) {
    return 8;
  }
  return 3;
}

function scoreStructure(
  type: CareerInterviewType,
  question: string,
  answer: string,
): number {
  const lower = answer.toLowerCase();
  const qLower = question.toLowerCase();

  if (type === 'behavioral' || /situation|challenge|conflict|example|time when/.test(qLower)) {
    return scoreStarStructure(lower);
  }

  if (type === 'technical' || /explain|how would|debug|design|architecture|code/.test(qLower)) {
    return scoreTechnicalStructure(lower);
  }

  if (type === 'managerial' || /lead|manage|prioriti|decision|team/.test(qLower)) {
    return scoreManagerialStructure(lower);
  }

  if (type === 'hr' || /yourself|salary|notice|why|leaving|years/.test(qLower)) {
    return scoreHrStructure(lower, qLower);
  }

  return scoreGeneralStructure(lower);
}

function scoreStarStructure(lower: string): number {
  let score = 6;
  if (/(when|while|during|at my|previous|last (project|role|company)|situation)/.test(lower)) {
    score += 5;
  }
  if (/(needed to|had to|responsible|goal|objective|challenge|task)/.test(lower)) {
    score += 5;
  }
  if (/(i (built|led|created|implemented|designed|worked|collaborated|decided|resolved|fixed|handled))/.test(lower)) {
    score += 5;
  }
  if (/(result|outcome|achieved|improved|reduced|increased|saved|delivered|\d+%)/.test(lower)) {
    score += 9;
  }
  return clamp(score, 0, 25);
}

function scoreTechnicalStructure(lower: string): number {
  let score = 8;
  if (/(first|then|next|finally|step|approach|because|therefore|so that)/.test(lower)) {
    score += 6;
  }
  if (/(debug|test|monitor|log|profile|optimiz|design|implement|api|database|server|client)/.test(lower)) {
    score += 6;
  }
  if (/(trade.?off|constraint|scal|perform|security|reliab)/.test(lower)) {
    score += 5;
  }
  return clamp(score, 0, 25);
}

function scoreManagerialStructure(lower: string): number {
  let score = 8;
  if (/(team|stakeholder|delegate|prioriti|decision|align|communicat)/.test(lower)) {
    score += 6;
  }
  if (/(conflict|deadline|risk|budget|roadmap|mentor|coach)/.test(lower)) {
    score += 5;
  }
  if (/(outcome|result|impact|metric|\d+)/.test(lower)) {
    score += 6;
  }
  return clamp(score, 0, 25);
}

function scoreHrStructure(lower: string, qLower: string): number {
  let score = 10;
  if (/yourself|introduce/.test(qLower)) {
    if (/(experience|skill|background|role|years|passion|motivat)/.test(lower)) {
      score += 8;
    }
  }
  if (/salary|compensation|notice|ctc|lpa/.test(qLower)) {
    if (/(expect|notice|month|lpa|salary|range|negotiat)/.test(lower)) {
      score += 10;
    }
  }
  if (/why|leaving|join/.test(qLower)) {
    if (/(growth|learn|impact|role|company|team|opportunit)/.test(lower)) {
      score += 8;
    }
  }
  return clamp(score, 0, 25);
}

function scoreGeneralStructure(lower: string): number {
  let score = 10;
  if (sentenceCount(lower) >= 2) {
    score += 5;
  }
  if (/(because|therefore|for example|specifically|as a result)/.test(lower)) {
    score += 5;
  }
  if (/(i |my )/.test(lower)) {
    score += 5;
  }
  return clamp(score, 0, 25);
}

function buildTips(
  type: CareerInterviewType,
  question: string,
  answer: string,
  breakdown: InterviewEvalBreakdown,
): string[] {
  const tips: string[] = [];
  const qLower = question.toLowerCase();

  if (breakdown.completeness < 16) {
    tips.push('Give a fuller answer — aim for 3–5 sentences that directly address the question.');
  }
  if (breakdown.specificity < 14) {
    tips.push('Add one concrete example with your action and a measurable outcome (numbers help).');
  }
  if (breakdown.relevance < 14) {
    const topic = extractQuestionTopic(question);
    tips.push(
      topic
        ? `Stay on topic — explicitly address "${topic}" instead of giving a generic reply.`
        : 'Answer the exact question asked rather than giving a generic response.',
    );
  }
  if (breakdown.structure < 14) {
    if (type === 'behavioral' || /situation|challenge|example/.test(qLower)) {
      tips.push('Use STAR: Situation → Task → Action → Result.');
    } else if (type === 'technical') {
      tips.push('Explain your approach step by step — context, solution, and why it works.');
    } else if (type === 'managerial') {
      tips.push('Show how you led the decision: context, trade-offs, actions, and team impact.');
    } else if (type === 'hr' && /yourself/.test(qLower)) {
      tips.push('Structure intro as: current role → key skills → why this role fits you.');
    } else {
      tips.push('Organize your answer: point → example → outcome.');
    }
  }

  if (wordCount(answer) >= 45 && breakdown.specificity >= 18 && tips.length === 0) {
    tips.push('Strong answer — tighten the opening sentence and lead with your biggest result.');
  }

  return tips.slice(0, 3);
}

function tipsFromBreakdown(breakdown: InterviewEvalBreakdown): string[] {
  const tips: string[] = [];
  if (breakdown.completeness < 16) {
    tips.push('Practice longer, complete answers (3–5 sentences).');
  }
  if (breakdown.specificity < 14) {
    tips.push('Include metrics or outcomes in your examples.');
  }
  if (breakdown.relevance < 14) {
    tips.push('Listen carefully to each question and answer it directly.');
  }
  if (breakdown.structure < 14) {
    tips.push('Use a clear structure (STAR for behavioral, steps for technical).');
  }
  return tips;
}

function buildFeedback(score: number, tips: string[], breakdown: InterviewEvalBreakdown): string {
  const band = scoreBand(score);
  const weakest = weakestDimension(breakdown);
  const lead = bandMessages[band];

  if (tips.length === 0) {
    return lead;
  }

  const primaryTip = tips[0];
  const dimensionHint =
    weakest === 'relevance'
      ? 'Your answer drifted from the question.'
      : weakest === 'specificity'
        ? 'It lacked concrete details from your experience.'
        : weakest === 'structure'
          ? 'The structure could be clearer.'
          : 'It was too brief to assess fully.';

  return `${lead} ${dimensionHint} *Tip:* ${primaryTip}`;
}

function pickFeedback(
  heuristic: InterviewEvalResult,
  aiFeedback: string,
  mergedScore: number,
): string {
  const ai = aiFeedback.trim();
  if (!ai || isGenericFeedback(ai)) {
    return heuristic.feedback;
  }

  if (Math.abs(mergedScore - heuristic.score) > 20 && heuristic.tips.length > 0) {
    return `${ai} *Tip:* ${heuristic.tips[0]}`;
  }

  return ai;
}

function isGenericFeedback(feedback: string): boolean {
  const lower = feedback.toLowerCase();
  return GENERIC_FEEDBACK.some((phrase) => lower.includes(phrase)) && feedback.length < 160;
}

function weakestDimension(breakdown: InterviewEvalBreakdown): keyof InterviewEvalBreakdown {
  const entries = Object.entries(breakdown) as Array<[keyof InterviewEvalBreakdown, number]>;
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}

const scoreBand = (score: number): 'excellent' | 'good' | 'fair' | 'weak' => {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'weak';
};

const bandMessages: Record<ReturnType<typeof scoreBand>, string> = {
  excellent: 'Excellent answer — specific, relevant, and well structured.',
  good: 'Good answer — solid content with room to sharpen one area.',
  fair: 'Fair attempt — you covered some points but key details are missing.',
  weak: 'Needs improvement — this answer is too vague or off-topic for interview use.',
};

function extractQuestionTopic(question: string): string | null {
  const cleaned = question
    .replace(/\?+$/, '')
    .replace(/^(tell me about|describe|explain|walk me through|how would you|what is|why)\s+/i, '')
    .trim();
  if (!cleaned || cleaned.length > 80) {
    return null;
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizeInterviewType(type: string): CareerInterviewType {
  const t = type.toLowerCase().trim();
  if (t === 'hr' || t === 'behavioral' || t === 'technical' || t === 'managerial') {
    return t;
  }
  if (/behavior/.test(t)) return 'behavioral';
  if (/tech/.test(t)) return 'technical';
  if (/manager/.test(t)) return 'managerial';
  return 'hr';
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s+#/.-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 4).length;
}

function extractStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
