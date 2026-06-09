import { Injectable } from '@nestjs/common';
import { CareerProfile } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildGuidanceDataPatch,
  CareerRoadmapData,
  CertificationRecData,
  GuidanceHistoryEntry,
  GuidanceType,
  readGuidanceHistory,
  SalaryInsightData,
  SkillGapPlanData,
} from '../career-guidance-state.util';
import { CareerAiService } from './career-ai.service';
import { CareerProfileService } from './career-profile.service';

const WA_MAX_CHARS = 3800;

@Injectable()
export class CareerGuidanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly careerAi: CareerAiService,
    private readonly profiles: CareerProfileService,
  ) {}

  readHistory(onboardingData: unknown): GuidanceHistoryEntry[] {
    return readGuidanceHistory(onboardingData);
  }

  async aggregateMissingSkills(userId: number, profileId: number): Promise<string[]> {
    const matches = await this.prisma.careerJobMatch.findMany({
      where: { userId, profileId },
      orderBy: { score: 'desc' },
      take: 15,
      select: { missingSkills: true, score: true },
    });

    const counts = new Map<string, number>();
    for (const match of matches) {
      const skills = Array.isArray(match.missingSkills)
        ? (match.missingSkills as string[]).map((s) => String(s).trim()).filter(Boolean)
        : [];
      const weight = Math.max(1, Math.round(match.score / 20));
      for (const skill of skills) {
        const key = skill.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + weight);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([skill]) => skill.replace(/\b\w/g, (c) => c.toUpperCase()))
      .slice(0, 12);
  }

  async generateRoadmap(userId: number, profile: CareerProfile): Promise<GuidanceHistoryEntry> {
    const snapshot = this.profiles.profileSnapshot(profile);
    const roadmap = await this.careerAi.generateCareerRoadmap(userId, snapshot);
    const whatsappSummary = this.formatRoadmapWhatsApp(roadmap);
    return this.saveEntry(profile, 'roadmap', { roadmap, whatsappSummary });
  }

  async generateSkillGap(userId: number, profile: CareerProfile): Promise<GuidanceHistoryEntry> {
    const snapshot = this.profiles.profileSnapshot(profile);
    const missingSkills = await this.aggregateMissingSkills(userId, profile.id);
    const skillGap = await this.careerAi.generateSkillGapPlan(userId, snapshot, missingSkills);
    const whatsappSummary = this.formatSkillGapWhatsApp(skillGap);
    return this.saveEntry(profile, 'skill_gap', { skillGap, whatsappSummary });
  }

  async generateCertifications(userId: number, profile: CareerProfile): Promise<GuidanceHistoryEntry> {
    const snapshot = this.profiles.profileSnapshot(profile);
    const missingSkills = await this.aggregateMissingSkills(userId, profile.id);
    const certifications = await this.careerAi.generateCertificationRecommendations(
      userId,
      snapshot,
      missingSkills,
    );
    const whatsappSummary = this.formatCertificationsWhatsApp(certifications);
    return this.saveEntry(profile, 'certifications', { certifications, whatsappSummary });
  }

  async generateSalary(userId: number, profile: CareerProfile): Promise<GuidanceHistoryEntry> {
    const snapshot = this.profiles.profileSnapshot(profile);
    const salary = await this.careerAi.generateSalaryInsight(userId, snapshot);
    const whatsappSummary = this.formatSalaryWhatsApp(salary);
    return this.saveEntry(profile, 'salary', { salary, whatsappSummary });
  }

  async generateFullSummary(userId: number, profile: CareerProfile): Promise<string[]> {
    const snapshot = this.profiles.profileSnapshot(profile);
    const missingSkills = await this.aggregateMissingSkills(userId, profile.id);

    const [roadmap, skillGap, certifications] = await Promise.all([
      this.careerAi.generateCareerRoadmap(userId, snapshot),
      this.careerAi.generateSkillGapPlan(userId, snapshot, missingSkills),
      this.careerAi.generateCertificationRecommendations(userId, snapshot, missingSkills),
    ]);

    const whatsappParts = [
      '*Your Career Guidance Pack* 📈',
      '',
      this.formatRoadmapWhatsApp(roadmap),
      '',
      this.formatSkillGapWhatsApp(skillGap),
      '',
      this.formatCertificationsWhatsApp(certifications),
      '',
      'Also try: *SALARY BENCHMARK* · *CAREER ADVICE <question>*',
    ];

    const entry: GuidanceHistoryEntry = {
      id: `full_${Date.now()}`,
      type: 'full',
      generatedAt: new Date().toISOString(),
      roadmap,
      skillGap,
      certifications,
      whatsappSummary: whatsappParts.join('\n'),
    };

    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: { onboardingData: buildGuidanceDataPatch(profile.onboardingData, entry) },
    });

    return this.splitForWhatsApp(entry.whatsappSummary ?? '');
  }

  formatRoadmapWhatsApp(roadmap: CareerRoadmapData): string {
    const lines = [
      '*Career Roadmap* 🗺️',
      '',
      `*Current:* ${roadmap.currentRole}`,
      '',
      '*Recommended path:*',
    ];

    roadmap.steps.forEach((step, i) => {
      const arrow = i < roadmap.steps.length - 1 ? '\n↓' : '';
      const meta = [step.timeframe, step.focus].filter(Boolean).join(' · ');
      lines.push(`${step.role}${meta ? `\n   _${meta}_` : ''}${arrow}`);
    });

    if (roadmap.summary) {
      lines.push('', roadmap.summary);
    }

    return lines.join('\n');
  }

  formatSkillGapWhatsApp(plan: SkillGapPlanData): string {
    const lines = ['*Skill Gap Plan* 🎯', ''];

    if (plan.missingSkills.length > 0) {
      lines.push(`*Top gaps from your matches:* ${plan.missingSkills.slice(0, 6).join(', ')}`, '');
    }

    plan.priorities.slice(0, 5).forEach((p, i) => {
      lines.push(`*${i + 1}. ${p.skill}*`);
      if (p.why) lines.push(p.why);
      p.actions.slice(0, 2).forEach((a) => lines.push(`• ${a}`));
      if (p.timeline) lines.push(`_${p.timeline}_`);
      lines.push('');
    });

    if (plan.summary) {
      lines.push(plan.summary);
    }

    return lines.join('\n').trim();
  }

  formatCertificationsWhatsApp(data: CertificationRecData): string {
    const lines = ['*Certification Recommendations* 🏅', ''];

    data.recommendations.slice(0, 4).forEach((rec, i) => {
      lines.push(`*${i + 1}. ${rec.name}*${rec.provider ? ` (${rec.provider})` : ''}`);
      if (rec.reason) lines.push(rec.reason);
      if (rec.skills.length > 0) {
        lines.push(`Skills: ${rec.skills.slice(0, 4).join(', ')}`);
      }
      lines.push('');
    });

    if (data.summary) {
      lines.push(data.summary);
    }

    return lines.join('\n').trim();
  }

  formatSalaryWhatsApp(data: SalaryInsightData): string {
    const lines = ['*Salary Growth Insights* 💰', '', `*Roles:* ${data.roles}`, `*Market:* ${data.location}`, ''];

    if (data.juniorRange) lines.push(`Junior: ${data.juniorRange}`);
    if (data.midRange) lines.push(`Mid: ${data.midRange}`);
    if (data.seniorRange) lines.push(`Senior: ${data.seniorRange}`);

    lines.push('', data.insight);

    if (data.growthTips?.length) {
      lines.push('', '*Growth tips:*');
      data.growthTips.slice(0, 3).forEach((tip) => lines.push(`• ${tip}`));
    }

    return lines.join('\n');
  }

  splitForWhatsApp(text: string): string[] {
    if (text.length <= WA_MAX_CHARS) {
      return [text];
    }

    const parts: string[] = [];
    let remaining = text;
    while (remaining.length > WA_MAX_CHARS) {
      let cut = remaining.lastIndexOf('\n\n', WA_MAX_CHARS);
      if (cut < WA_MAX_CHARS / 2) {
        cut = WA_MAX_CHARS;
      }
      parts.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) {
      parts.push(remaining);
    }
    return parts;
  }

  private async saveEntry(
    profile: CareerProfile,
    type: GuidanceType,
    payload: Partial<GuidanceHistoryEntry>,
  ): Promise<GuidanceHistoryEntry> {
    const entry: GuidanceHistoryEntry = {
      id: `${type}_${Date.now()}`,
      type,
      generatedAt: new Date().toISOString(),
      ...payload,
    };

    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: {
        onboardingData: buildGuidanceDataPatch(profile.onboardingData, entry),
      },
    });

    return entry;
  }
}
