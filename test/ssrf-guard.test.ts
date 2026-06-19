import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedUrl, isBlockedIp } from '../src/common/net/ssrf-guard';

describe('isBlockedIp', () => {
  it('blocks loopback and private IPv4', () => {
    assert.equal(isBlockedIp('127.0.0.1'), true);
    assert.equal(isBlockedIp('10.0.0.1'), true);
    assert.equal(isBlockedIp('192.168.1.1'), true);
    assert.equal(isBlockedIp('169.254.169.254'), true);
  });

  it('allows public IPv4', () => {
    assert.equal(isBlockedIp('8.8.8.8'), false);
    assert.equal(isBlockedIp('1.1.1.1'), false);
  });
});

describe('assertAllowedUrl', () => {
  it('allows https public URLs', () => {
    const url = assertAllowedUrl('https://api.example.com/v1/data');
    assert.equal(url.hostname, 'api.example.com');
  });

  it('rejects non-http protocols', () => {
    assert.throws(() => assertAllowedUrl('file:///etc/passwd'), /unsupported protocol/);
    assert.throws(() => assertAllowedUrl('ftp://example.com'), /unsupported protocol/);
  });

  it('rejects localhost and private literals', () => {
    assert.throws(() => assertAllowedUrl('http://localhost/admin'), /local host/);
    assert.throws(() => assertAllowedUrl('http://127.0.0.1/admin'), /private address/);
    assert.throws(() => assertAllowedUrl('http://192.168.0.5/internal'), /private address/);
  });
});
