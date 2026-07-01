/** Escape a single CSV cell value (RFC 4180). */
export function escapeCsvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Build a CSV string from headers and row arrays. */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.join(',');
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  return [headerLine, body].join('\n');
}
