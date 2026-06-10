# Resume parsing golden set (R0)

Baseline measurement for CareerAI resume parsing **before** changing parse logic.

## What this measures

Each case file contains:

- `extracted_text` — simulates output from PDF/DOCX extraction (what `CareerResumeParserService` produces)
- `expected` — manually verified ground truth
- optional `mock_ai` — simulates AI JSON without calling OpenAI

The evaluator runs the **same merge pipeline** as production (`mergeParsedProfiles` + `extractBasicFieldsFromResume`) and scores field-level accuracy.

## Run baseline

From `micro-saas-api/`:

```bash
# Heuristic-only (AI unavailable / fallback path)
npm run resume:eval

# Heuristic + mock AI fixtures (cases that define mock_ai)
npm run resume:eval:merged

# AI-only from mock_ai (no heuristics)
npm run resume:eval:ai
```

Options:

- `--json` — print full JSON report to stdout
- `--strict` — exit code 1 if overall score &lt; 75% (for CI later)
- `--pipeline=heuristic|merged|ai-only`

Reports are written to `scripts/resume-golden/reports/baseline-*.json`.

## Add a new case

1. Create `cases/NN-short-name.json`
2. Paste realistic `extracted_text` (from a real resume run through the parser, or hand-crafted)
3. Fill `expected` with verified truth
4. Tag with `known-gap` if the case documents a **known** weakness (not a regression)
5. Re-run `npm run resume:eval` and commit the updated baseline report

## Scoring

| Field | Rule |
|-------|------|
| Name | Exact or strong token overlap |
| Email / phone | Exact (phone last 10 digits) |
| Location | Substring match |
| Skills | 70% recall + 30% precision on normalized tokens |
| Experience | % of expected jobs matched by title + company |
| Salary / notice | Fuzzy substring |

Overall case score = weighted average (skills & experience weighted 2×).

## Pipelines

| Mode | Production equivalent |
|------|------------------------|
| `heuristic` | AI failed or token limit hit |
| `merged` | Normal path: AI + heuristics + section merge |
| `ai-only` | AI output in isolation |

## Next phases (after R0)

- **R1** — extraction hardening (scanned PDF OCR, pdfjs column order, DOCX HTML fallback) — **shipped**
- **R2** — field validation against source text (case `08-ai-hallucination-trap` should score higher after anti-hallucination)
- **R3** — WhatsApp confirm step (not measured here)

### R1 extraction pipeline (production)

PDF: `pdf-parse` → `pdfjs-ordered` (if low quality) → `pdf-ocr` (Tesseract on rendered pages, max 3 pages)

DOCX: `mammoth` raw text → HTML fallback for tables/text boxes

Legacy `.doc` → clear error asking for PDF/DOCX

Quality stored on `career_resumes.extract_meta` (`method`, `quality`, `qualityScore`, `ocrUsed`, `warnings`).

## Target metrics (suggested)

| Segment | Target overall |
|---------|----------------|
| `happy-path` / `standard` IT cases | ≥ 85% heuristic, ≥ 90% merged |
| `known-gap` cases | Document baseline; improve in R1/R2 |

Add real PDF fixtures later by storing files under `cases/files/` and a pre-step that runs `extractText()` — R0 uses text fixtures only for speed and CI stability.
