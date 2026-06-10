export type ExtractMethod =
  | 'pdf-parse'
  | 'pdfjs-ordered'
  | 'pdf-ocr'
  | 'docx-raw'
  | 'docx-html'
  | 'ocr-image'
  | 'plain-text';

export type ExtractQualityBand = 'high' | 'medium' | 'low';

export interface ExtractQualityReport {
  score: number;
  band: ExtractQualityBand;
  warnings: string[];
}

export interface ResumeExtractMeta {
  method: ExtractMethod;
  quality: ExtractQualityBand;
  qualityScore: number;
  pageCount?: number;
  ocrUsed: boolean;
  warnings?: string[];
}

export function scoreExtractQuality(text: string): ExtractQualityReport {
  const warnings: string[] = [];
  const trimmed = text.trim();

  if (trimmed.length < 40) {
    return { score: 0, band: 'low', warnings: ['too_short'] };
  }

  let score = 40;

  if (trimmed.length >= 120) score += 10;
  if (trimmed.length >= 300) score += 10;
  if (trimmed.length >= 600) score += 5;

  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) {
    score += 12;
  } else {
    warnings.push('no_email');
  }

  if (/(?:\+91[\s-]?)?[6-9]\d{9}/.test(trimmed) || /\(\d{3}\)\s*\d{3}-\d{4}/.test(trimmed)) {
    score += 8;
  } else {
    warnings.push('no_phone');
  }

  if (
    /\b(experience|employment|work history|professional experience|skills|education|summary)\b/i.test(
      trimmed,
    )
  ) {
    score += 12;
  } else {
    warnings.push('no_sections');
  }

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 10) {
    score += 8;
  } else if (lines.length < 4) {
    score -= 10;
    warnings.push('few_lines');
  }

  const avgLineLen = trimmed.length / Math.max(lines.length, 1);
  if (avgLineLen > 100 && lines.length < 20) {
    score -= 12;
    warnings.push('possible_layout_jumble');
  }

  const alphaRatio = (trimmed.match(/[a-zA-Z]/g)?.length ?? 0) / trimmed.length;
  if (alphaRatio < 0.35) {
    score -= 15;
    warnings.push('low_alpha_ratio');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band: ExtractQualityBand = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score, band, warnings };
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

/** Read PDF text in visual order (helps multi-column layouts). */
export async function extractPdfTextOrdered(
  buffer: Buffer,
): Promise<{ text: string; pageCount: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.js',
  );

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = (content.items as PdfTextItem[]).filter((item) => item.str?.trim());

    items.sort((a, b) => {
      const yA = a.transform?.[5] ?? 0;
      const yB = b.transform?.[5] ?? 0;
      if (Math.abs(yA - yB) > 4) {
        return yB - yA;
      }
      return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0);
    });

    const lines: string[] = [];
    let lineY: number | null = null;
    let parts: string[] = [];

    for (const item of items) {
      const y = item.transform?.[5] ?? 0;
      if (lineY === null || Math.abs(y - lineY) <= 4) {
        parts.push(item.str!.trim());
        lineY = lineY ?? y;
      } else {
        lines.push(parts.join(' ').replace(/\s+/g, ' ').trim());
        parts = [item.str!.trim()];
        lineY = y;
      }
    }
    if (parts.length > 0) {
      lines.push(parts.join(' ').replace(/\s+/g, ' ').trim());
    }

    pageTexts.push(lines.filter(Boolean).join('\n'));
  }

  const pageCount = doc.numPages;
  await doc.destroy();

  return {
    text: normalizeExtractedText(pageTexts.filter(Boolean).join('\n\n')),
    pageCount,
  };
}

export function buildExtractMeta(
  method: ExtractMethod,
  text: string,
  options: { pageCount?: number; ocrUsed?: boolean; extraWarnings?: string[] } = {},
): ResumeExtractMeta {
  const quality = scoreExtractQuality(text);
  const warnings = [...new Set([...(options.extraWarnings ?? []), ...quality.warnings])];
  return {
    method,
    quality: quality.band,
    qualityScore: quality.score,
    pageCount: options.pageCount,
    ocrUsed: options.ocrUsed ?? false,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function lowQualityUserHint(meta?: ResumeExtractMeta): string | null {
  if (!meta || meta.quality !== 'low') {
    return null;
  }
  return (
    '⚠️ I could only read part of your resume clearly. Please double-check your details in the next questions.'
  );
}
