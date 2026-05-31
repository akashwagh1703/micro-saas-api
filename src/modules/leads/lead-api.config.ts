export interface SaveLeadApiConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeout: number;
  retries: number;
  use_fallback: boolean;
}

export interface BuildSaveLeadApiOptions {
  apiBaseUrl: string;
  bearerToken: string;
  collectedFields?: string[];
  notes?: string;
}

/** Builds the HTTP config matching POST /api/leads/save (workflow variable placeholders). */
export function buildSaveLeadApiConfig(options: BuildSaveLeadApiOptions): SaveLeadApiConfig {
  const base = options.apiBaseUrl.replace(/\/$/, '');
  const collected: Record<string, string> = {};
  for (const field of options.collectedFields ?? []) {
    collected[field] = `{{${field}}}`;
  }

  const body: Record<string, unknown> = {
    contact_name: '{{contact_name}}',
    contact_phone: '{{contact_phone}}',
    message: '{{message}}',
    channel: 'whatsapp',
  };

  if (Object.keys(collected).length > 0) {
    body.__collected = collected;
  }

  if (options.notes?.trim()) {
    body.notes = options.notes.trim();
  }

  return {
    url: `${base}/api/leads/save`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.bearerToken}`,
    },
    body,
    timeout: 15,
    retries: 1,
    use_fallback: true,
  };
}

/** Template placeholder — replaced with real URL + token when a workflow is generated/cloned. */
export function buildSaveLeadApiPlaceholder(
  collectedFields?: string[],
  notes?: string,
): SaveLeadApiConfig {
  return buildSaveLeadApiConfig({
    apiBaseUrl: '{{APP_URL}}',
    bearerToken: '{{LEAD_API_TOKEN}}',
    collectedFields,
    notes,
  });
}

export function buildSaveLeadCurl(config: SaveLeadApiConfig): string {
  const headers = Object.entries(config.headers)
    .map(([k, v]) => `-H "${k}: ${v}"`)
    .join(' \\\n  ');
  return [
    `curl -X ${config.method} "${config.url}" \\`,
    `  ${headers} \\`,
    `  -d '${JSON.stringify(config.body, null, 2)}'`,
  ].join('\n');
}
