import { Injectable } from '@nestjs/common';
import { CareerProfile, Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ParsedCareerProfile } from '../career-parsed-profile.types';

const ONBOARDING_FIELD_ORDER: Array<{
  step: string;
  field: keyof CareerProfile;
}> = [
  { step: 'follow_up_location', field: 'currentLocation' },
  { step: 'follow_up_preferred_location', field: 'preferredLocations' },
  { step: 'follow_up_current_salary', field: 'currentSalary' },
  { step: 'follow_up_expected_salary', field: 'expectedSalary' },
  { step: 'follow_up_notice_period', field: 'noticePeriod' },
  { step: 'follow_up_employment_type', field: 'preferredJobTypes' },
  { step: 'follow_up_job_type', field: 'workPreference' },
  { step: 'follow_up_roles', field: 'preferredRoles' },
];

@Injectable()
export class CareerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: number, contact: Contact): Promise<CareerProfile> {
    const existing = await this.prisma.careerProfile.findUnique({
      where: { contactId: contact.id },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.careerProfile.create({
      data: {
        userId,
        contactId: contact.id,
        phone: contact.phone,
        fullName: contact.name,
        onboardingStep: 'welcome',
      },
    });
  }

  private parsedToPatch(parsed: ParsedCareerProfile): Prisma.CareerProfileUpdateInput {
    return {
      fullName: parsed.full_name ?? undefined,
      email: parsed.email ?? undefined,
      skills: (parsed.skills ?? undefined) as Prisma.InputJsonValue | undefined,
      experience: (parsed.experience ?? undefined) as Prisma.InputJsonValue | undefined,
      education: (parsed.education ?? undefined) as Prisma.InputJsonValue | undefined,
      certifications: (parsed.certifications ?? undefined) as Prisma.InputJsonValue | undefined,
      projects: (parsed.projects ?? undefined) as Prisma.InputJsonValue | undefined,
      languages: (parsed.languages ?? undefined) as Prisma.InputJsonValue | undefined,
      currentLocation: parsed.current_location ?? undefined,
      preferredLocations: parsed.preferred_locations?.length
        ? (parsed.preferred_locations as Prisma.InputJsonValue)
        : undefined,
      currentSalary: parsed.current_salary ?? undefined,
      expectedSalary: parsed.expected_salary ?? undefined,
      noticePeriod: parsed.notice_period ?? undefined,
      workPreference: parsed.work_preference ?? undefined,
      preferredRoles: parsed.preferred_roles?.length
        ? (parsed.preferred_roles as Prisma.InputJsonValue)
        : undefined,
    };
  }

  private isFieldFilled(profile: CareerProfile, field: keyof CareerProfile): boolean {
    const val = profile[field];
    if (val === null || val === undefined || val === '') {
      return false;
    }
    if (Array.isArray(val)) {
      return val.length > 0;
    }
    return true;
  }

  computeNextOnboardingStep(profile: CareerProfile): string {
    for (const { step, field } of ONBOARDING_FIELD_ORDER) {
      if (!this.isFieldFilled(profile, field)) {
        return step;
      }
    }
    return 'complete';
  }

  async applyParsedResume(profileId: number, parsed: ParsedCareerProfile): Promise<CareerProfile> {
    const patch = this.parsedToPatch(parsed);
    const updated = await this.prisma.careerProfile.update({
      where: { id: profileId },
      data: patch,
    });
    const nextStep = this.computeNextOnboardingStep(updated);
    return this.prisma.careerProfile.update({
      where: { id: profileId },
      data: { onboardingStep: nextStep },
    });
  }

  /** Re-parse on UPLOAD RESUME — keeps profile complete, refreshes extracted fields. */
  async applyParsedResumeUpdate(profileId: number, parsed: ParsedCareerProfile): Promise<CareerProfile> {
    const patch = this.parsedToPatch(parsed);
    return this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        ...patch,
        isComplete: true,
        onboardingStep: 'complete',
      },
    });
  }

  async resetProfile(profileId: number, contact: Contact): Promise<CareerProfile> {
    return this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        fullName: contact.name,
        email: null,
        phone: contact.phone,
        experience: Prisma.DbNull,
        skills: Prisma.DbNull,
        education: Prisma.DbNull,
        certifications: Prisma.DbNull,
        projects: Prisma.DbNull,
        languages: Prisma.DbNull,
        currentLocation: null,
        preferredLocations: Prisma.DbNull,
        currentSalary: null,
        expectedSalary: null,
        noticePeriod: null,
        preferredJobTypes: Prisma.DbNull,
        preferredRoles: Prisma.DbNull,
        workPreference: null,
        onboardingStep: 'welcome',
        onboardingData: Prisma.DbNull,
        isComplete: false,
        masterResumeId: null,
      },
    });
  }

  async updateOnboarding(
    profileId: number,
    step: string,
    patch: Prisma.CareerProfileUpdateInput = {},
  ): Promise<CareerProfile> {
    return this.prisma.careerProfile.update({
      where: { id: profileId },
      data: { onboardingStep: step, ...patch },
    });
  }

  async markComplete(profileId: number): Promise<CareerProfile> {
    return this.prisma.careerProfile.update({
      where: { id: profileId },
      data: { isComplete: true, onboardingStep: 'complete' },
    });
  }

  profileSnapshot(profile: CareerProfile): Record<string, unknown> {
    return {
      full_name: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      skills: profile.skills,
      experience: profile.experience,
      education: profile.education,
      certifications: profile.certifications,
      projects: profile.projects,
      languages: profile.languages,
      current_location: profile.currentLocation,
      preferred_locations: profile.preferredLocations,
      current_salary: profile.currentSalary,
      expected_salary: profile.expectedSalary,
      notice_period: profile.noticePeriod,
      preferred_roles: profile.preferredRoles,
      preferred_job_types: profile.preferredJobTypes,
      work_preference: profile.workPreference,
    };
  }
}
