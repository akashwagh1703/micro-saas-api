export interface ParsedCareerProfile {
  full_name?: string;
  email?: string;
  phone?: string;
  skills?: string[];
  experience?: Array<{ title?: string; company?: string; years?: string; summary?: string }>;
  education?: Array<{ degree?: string; institution?: string; year?: string }>;
  certifications?: string[];
  projects?: string[];
  languages?: string[];
  current_location?: string;
  preferred_locations?: string[];
  current_salary?: string;
  expected_salary?: string;
  notice_period?: string;
  work_preference?: string;
  preferred_roles?: string[];
}
