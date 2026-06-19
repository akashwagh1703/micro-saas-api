import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResponseMapping,
  extractVaultReferences,
  getByPath,
  resolveTemplateString,
} from '../src/common/template-variables.util';

describe('resolveTemplateString', () => {
  it('substitutes simple variables', async () => {
    const out = await resolveTemplateString('Hello {{name}}', { name: 'Ada' });
    assert.equal(out, 'Hello Ada');
  });

  it('resolves vault references via resolver', async () => {
    const out = await resolveTemplateString('Bearer {{vault:api_key}}', {}, async (name) =>
      name === 'api_key' ? 'secret-123' : null,
    );
    assert.equal(out, 'Bearer secret-123');
  });
});

describe('extractVaultReferences', () => {
  it('finds unique vault placeholders', () => {
    const refs = extractVaultReferences('{{vault:a}} and {{vault:b}} {{vault:a}}');
    assert.deepEqual(refs.sort(), ['a', 'b']);
  });
});

describe('getByPath', () => {
  it('reads nested and indexed paths', () => {
    const data = { items: [{ id: 42 }, { id: 99 }] };
    assert.equal(getByPath(data, 'items.0.id'), 42);
    assert.equal(getByPath(data, 'items[1].id'), 99);
    assert.equal(getByPath(data, 'missing.path'), undefined);
  });
});

describe('applyResponseMapping', () => {
  it('maps response fields to workflow variables', () => {
    const mapped = applyResponseMapping(
      { data: { user: { email: 'a@b.com' } } },
      { email: 'data.user.email', missing: 'data.nope' },
    );
    assert.equal(mapped.email, 'a@b.com');
    assert.equal(mapped.missing, undefined);
  });
});
