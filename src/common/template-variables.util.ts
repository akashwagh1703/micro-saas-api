const VAULT_PATTERN = /\{\{vault:([a-zA-Z0-9_-]+)\}\}/g;

export function extractVaultReferences(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(VAULT_PATTERN)) {
    names.add(match[1]);
  }
  return [...names];
}

export async function resolveTemplateString(
  text: string,
  variables: Record<string, unknown>,
  resolveVault?: (name: string) => Promise<string | null>,
): Promise<string> {
  let result = text;

  if (resolveVault) {
    const refs = extractVaultReferences(result);
    for (const name of refs) {
      const secret = await resolveVault(name);
      result = result.split(`{{vault:${name}}}`).join(secret ?? '');
    }
  }

  for (const [key, value] of Object.entries(variables)) {
    result = result.split(`{{${key}}}`).join(String(value ?? ''));
  }

  return result;
}

export async function resolveTemplateObject(
  data: unknown,
  variables: Record<string, unknown>,
  resolveVault?: (name: string) => Promise<string | null>,
): Promise<unknown> {
  try {
    const json = JSON.stringify(data ?? {});
    const replaced = await resolveTemplateString(json, variables, resolveVault);
    return JSON.parse(replaced);
  } catch {
    return data ?? {};
  }
}

/** Read a dot/bracket path from an object (e.g. data.items.0.id). */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path || path === '.') {
    return obj;
  }

  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function applyResponseMapping(
  data: unknown,
  mapping: Record<string, string> | null | undefined,
): Record<string, unknown> {
  if (!mapping || typeof mapping !== 'object') {
    return {};
  }

  const output: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(mapping)) {
    if (!key.trim()) continue;
    output[key] = getByPath(data, String(path ?? '').trim());
  }
  return output;
}
