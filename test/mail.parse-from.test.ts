import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFromAddress } from '../src/modules/mail/mail.service';

describe('parseFromAddress', () => {
  it('parses bare email', () => {
    assert.deepEqual(parseFromAddress('noreply@autowave.in'), {
      email: 'noreply@autowave.in',
    });
  });

  it('parses Name <email> form', () => {
    assert.deepEqual(parseFromAddress('AutoWave <noreply@autowave.in>'), {
      email: 'noreply@autowave.in',
      name: 'AutoWave',
    });
  });

  it('parses quoted name', () => {
    assert.deepEqual(parseFromAddress('"Auto Wave" <noreply@autowave.in>'), {
      email: 'noreply@autowave.in',
      name: 'Auto Wave',
    });
  });
});
