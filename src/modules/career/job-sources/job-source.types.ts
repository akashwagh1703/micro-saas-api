/** Normalised job listing from any external source. */
export interface NormalizedJobListing {
  externalId: string;
  title: string;
  company: string;
  location?: string | null;
  city?: string | null;
  description?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryText?: string | null;
  jobType?: string | null;
  applyUrl?: string | null;
  postedAt?: Date | null;
  industry?: string | null;
  tags?: string[];
  requiredSkills?: string[];
  minExperience?: number | null;
  experienceMax?: number | null;
}

export interface JobSourceStatus {
  id: string;
  name: string;
  enabled: boolean;
  message: string;
}

export interface CareerJobSource {
  readonly id: string;
  readonly name: string;
  isEnabled(userId: number): Promise<boolean>;
  getStatus(userId: number): Promise<JobSourceStatus>;
  fetchAndStore(
    userId: number,
    keyword: string,
    location: string,
    pages: number,
  ): Promise<number>;
}
