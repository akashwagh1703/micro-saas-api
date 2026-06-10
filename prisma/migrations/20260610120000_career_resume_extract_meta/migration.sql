-- R1: resume extraction metadata (method, quality, OCR, page count)
ALTER TABLE "career_resumes" ADD COLUMN "extract_meta" JSONB;
