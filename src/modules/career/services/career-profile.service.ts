import { Injectable } from '@nestjs/common';
import { CareerProfile, Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ParsedCareerProfile } from './career-ai.service';

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

  async applyParsedResume(profileId: number, parsed: ParsedCareerProfile): Promise<CareerProfile> {
    return this.prisma.careerProfile.update({
      where: { id: profileId },
      data: {
        fullName: parsed.full_name ?? undefined,
        email: parsed.email ?? undefined,
        // FIX 4: Do NOT overwrite the phone number from the resume.
        // The contact's phone (from WhatsApp) is already normalized and verified.
        // Resume phone fields are often formatted differently (e.g. '+91-98765-43210')
        // and overwriting causes mismatches in the matching engine.
        skills: (parsed.skills ?? []) as Prisma.InputJsonValue,
        experience: (parsed.experience ?? []) as Prisma.InputJsonValue,
        education: (parsed.education ?? []) as Prisma.InputJsonValue,
        certifications: (parsed.certifications ?? []) as Prisma.InputJsonValue,
        projects: (parsed.projects ?? []) as Prisma.InputJsonValue,
        languages: (parsed.languages ?? []) as Prisma.InputJsonValue,
        onboardingStep: 'follow_up_location',
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
      // FIX 5: certifications, projects and languages were missing from the snapshot.
      // They are now included so AI resume/cover letter generation uses the full profile.
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
