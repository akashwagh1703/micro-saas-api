export type LeadApiChannel = 'whatsapp' | 'instagram' | 'both';

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
  channel?: LeadApiChannel;
}

function buildSaveLeadBody(
  channel: LeadApiChannel,
  collected: Record<string, string>,
  notes?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contact_name: '{{contact_name}}',
    message: '{{message}}',
  };

  if (channel === 'instagram') {
    body.username = '{{contact_username}}';
    body.channel = 'instagram';
  } else if (channel === 'whatsapp') {
    body.contact_phone = '{{contact_phone}}';
    body.channel = 'whatsapp';
  } else {
    body.contact_phone = '{{contact_phone}}';
    body.username = '{{contact_username}}';
    body.channel = '{{channel}}';
  }

  if (Object.keys(collected).length > 0) {
    body.__collected = collected;
  }

  if (notes?.trim()) {
    body.notes = notes.trim();
  }

  return body;
}

function resolveSaveLeadUrl(base: string, channel: LeadApiChannel): string {
  if (channel === 'instagram') {
    return `${base}/api/leads/instagram`;
  }
  return `${base}/api/leads/save`;
}

/** Builds the HTTP config matching POST /api/leads/save or /api/leads/instagram. */
export function buildSaveLeadApiConfig(options: BuildSaveLeadApiOptions): SaveLeadApiConfig {
  const base = options.apiBaseUrl.replace(/\/$/, '');
  const channel = options.channel ?? 'whatsapp';
  const collected: Record<string, string> = {};
  for (const field of options.collectedFields ?? []) {
    collected[field] = `{{${field}}}`;
  }

  return {
    url: resolveSaveLeadUrl(base, channel),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.bearerToken}`,
    },
    body: buildSaveLeadBody(channel, collected, options.notes),
    timeout: 15,
    retries: 1,
    use_fallback: true,
  };
}

/** Template placeholder — replaced with real URL + token when a workflow is generated/cloned. */
export function buildSaveLeadApiPlaceholder(
  collectedFields?: string[],
  notes?: string,
  channel: LeadApiChannel = 'whatsapp',
): SaveLeadApiConfig {
  return buildSaveLeadApiConfig({
    apiBaseUrl: '{{APP_URL}}',
    bearerToken: '{{LEAD_API_TOKEN}}',
    collectedFields,
    notes,
    channel,
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
