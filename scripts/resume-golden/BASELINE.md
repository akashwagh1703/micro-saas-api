# Resume parse baseline (R0)

Captured: **2026-06-10** · 8 synthetic golden cases · text fixtures only

Run locally: `npm run resume:eval` and `npm run resume:eval:merged`

## Summary

| Pipeline | Overall | Notes |
|----------|---------|--------|
| **Heuristic only** (AI unavailable) | **87%** | Production fallback path |
| **Merged** (AI + heuristics + R2 validation) | **87%** | Post-R2 re-measured; case 08 improved to 98% |

These scores are on a **small** golden set. They are directionally useful, not proof of 100% production accuracy. Add 30–50 real resumes (with manual truth labels) before treating targets as binding.

## Per-field averages (heuristic)

| Field | Score | Weakness |
|-------|-------|----------|
| email | 100% | — |
| current_location | 100% | — |
| phone | 88% | Spacing/format normalization |
| experience | 86% | Date-range layouts |
| preferred_roles | 83% | Headline noise |
| skills | 82% | Fixed keyword list misses non-IT terms |
| **full_name** | **75%** | Job title on line 1; single-word names |

## Known weak cases (by design)

| Case | Heuristic | Issue |
|------|-----------|--------|
| `06-jumbled-columns` | 71% | Simulates two-column PDF text jumble |
| `02-headline-not-name` | 81% | Title before name |
| `07-ai-merge-boost` | 63% heuristic / **97% merged** | Needs AI for sparse text |
| `08-ai-hallucination-trap` | **98% merged** (was 96%) | R2 strips Kafka + FakeGoogle; junk lines filtered |

## Bug found during R0

`pickBestName()` could call `cleanName(undefined)` and crash when no name candidate exists (e.g. minimal resumes). Fixed in `career-resume-parse.util.ts`.

## Suggested targets (after expanding golden set)

| Segment | Heuristic | Merged |
|---------|-----------|--------|
| IT standard layouts | ≥ 85% | ≥ 90% |
| Name-trap / layout | ≥ 70% | ≥ 75% |
| Non-IT (optional skills) | document baseline | — |

## Next step

**R1** — extraction hardening — **shipped**  
**R2** — field validation against source text — **shipped** (`career-resume-validate.util.ts`)  
**R3** — WhatsApp confirm before save/matching — **shipped** (`career-parse-review.util.ts`, step `parse_review`)
