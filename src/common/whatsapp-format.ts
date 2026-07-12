/** Split WhatsApp-formatted text into plain segments for UI rendering. */
export type WhatsAppTextSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
};

const TOKEN_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;

function parseInlineSegment(chunk: string): WhatsAppTextSegment[] {
  const parts = chunk.split(TOKEN_RE).filter((p) => p.length > 0);
  if (parts.length === 0) return [{ text: chunk }];

  const segments: WhatsAppTextSegment[] = [];
  for (const part of parts) {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      segments.push({ text: part.slice(1, -1), bold: true });
    } else if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      segments.push({ text: part.slice(1, -1), italic: true });
    } else if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
      segments.push({ text: part.slice(1, -1), strike: true });
    } else if (part.startsWith('```') && part.endsWith('```') && part.length > 6) {
      segments.push({ text: part.slice(3, -3), mono: true });
    } else {
      segments.push({ text: part });
    }
  }
  return segments;
}

/** Parse a full message into lines of formatted segments (preserves newlines). */
export function parseWhatsAppFormattedText(content: string): WhatsAppTextSegment[][] {
  const lines = String(content ?? '').split('\n');
  return lines.map((line) => parseInlineSegment(line));
}

/** Plain-text preview — strips WhatsApp markers. */
export function stripWhatsAppFormatting(content: string): string {
  return String(content ?? '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~([^~\n]+)~/g, '$1')
    .replace(/```([^`]+)```/g, '$1');
}
