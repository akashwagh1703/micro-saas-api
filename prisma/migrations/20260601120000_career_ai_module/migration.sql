-- CareerAI Bot module tables

CREATE TABLE "career_profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "experience" JSONB,
    "skills" JSONB,
    "education" JSONB,
    "certifications" JSONB,
    "projects" JSONB,
    "languages" JSONB,
    "current_location" TEXT,
    "preferred_locations" JSONB,
    "current_salary" TEXT,
    "expected_salary" TEXT,
    "notice_period" TEXT,
    "preferred_job_types" JSONB,
    "preferred_roles" JSONB,
    "work_preference" VARCHAR(20),
    "onboarding_step" VARCHAR(40) NOT NULL DEFAULT 'welcome',
    "onboarding_data" JSONB,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "master_resume_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "career_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "career_profiles_contact_id_key" ON "career_profiles"("contact_id");
CREATE INDEX "career_profiles_user_id_is_complete_idx" ON "career_profiles"("user_id", "is_complete");

CREATE TABLE "career_resumes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'upload',
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_path" TEXT,
    "extracted_text" TEXT,
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "career_resumes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_resumes_user_id_profile_id_idx" ON "career_resumes"("user_id", "profile_id");

CREATE TABLE "career_jobs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "salary_text" TEXT,
    "job_type" VARCHAR(30),
    "description" TEXT,
    "required_skills" JSONB,
    "min_experience" INTEGER,
    "source" VARCHAR(50),
    "external_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "career_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_jobs_user_id_is_active_idx" ON "career_jobs"("user_id", "is_active");
CREATE INDEX "career_jobs_user_id_title_idx" ON "career_jobs"("user_id", "title");

CREATE TABLE "career_resume_versions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "resume_id" INTEGER NOT NULL,
    "job_id" INTEGER,
    "title" TEXT,
    "content" TEXT,
    "file_path" TEXT,
    "file_path_pdf" TEXT,
    "file_path_docx" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_resume_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_resume_versions_resume_id_created_at_idx" ON "career_resume_versions"("resume_id", "created_at");

CREATE TABLE "career_job_matches" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "job_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "match_factors" JSONB,
    "missing_skills" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_job_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "career_job_matches_profile_id_job_id_key" ON "career_job_matches"("profile_id", "job_id");
CREATE INDEX "career_job_matches_user_id_profile_id_score_idx" ON "career_job_matches"("user_id", "profile_id", "score");

CREATE TABLE "career_applications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "job_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'saved',
    "timeline" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "career_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "career_applications_profile_id_job_id_key" ON "career_applications"("profile_id", "job_id");
CREATE INDEX "career_applications_user_id_status_idx" ON "career_applications"("user_id", "status");

CREATE TABLE "career_cover_letters" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "job_id" INTEGER,
    "content" TEXT NOT NULL,
    "file_path_pdf" TEXT,
    "file_path_docx" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_cover_letters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_cover_letters_user_id_profile_id_idx" ON "career_cover_letters"("user_id", "profile_id");

CREATE TABLE "career_notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "career_notifications_user_id_type_status_idx" ON "career_notifications"("user_id", "type", "status");
CREATE INDEX "career_notifications_scheduled_at_status_idx" ON "career_notifications"("scheduled_at", "status");

ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "career_resumes" ADD CONSTRAINT "career_resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_resumes" ADD CONSTRAINT "career_resumes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "career_jobs" ADD CONSTRAINT "career_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "career_resume_versions" ADD CONSTRAINT "career_resume_versions_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "career_resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_resume_versions" ADD CONSTRAINT "career_resume_versions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "career_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "career_job_matches" ADD CONSTRAINT "career_job_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_job_matches" ADD CONSTRAINT "career_job_matches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_job_matches" ADD CONSTRAINT "career_job_matches_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "career_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "career_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "career_cover_letters" ADD CONSTRAINT "career_cover_letters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_cover_letters" ADD CONSTRAINT "career_cover_letters_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_cover_letters" ADD CONSTRAINT "career_cover_letters_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "career_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "career_notifications" ADD CONSTRAINT "career_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "career_notifications" ADD CONSTRAINT "career_notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
