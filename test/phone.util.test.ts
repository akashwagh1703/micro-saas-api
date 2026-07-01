import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDigits,
  isValidIndianMobile,
  normalizeIndianMobile,
  toE164Indian,
} from '../src/common/phone.util';

describe('phone.util', () => {
  it('normalizeIndianMobile strips country code and leading zero', () => {
    assert.equal(normalizeIndianMobile('+919876543210'), '9876543210');
    assert.equal(normalizeIndianMobile('09876543210'), '9876543210');
  });

  it('isValidIndianMobile validates Indian mobiles', () => {
    assert.equal(isValidIndianMobile('+919876543210'), true);
    assert.equal(isValidIndianMobile('1234567890'), false);
  });

  it('toE164Indian formats E.164', () => {
    assert.equal(toE164Indian('9876543210'), '+919876543210');
  });

  it('extractDigits removes non-digits', () => {
    assert.equal(extractDigits('+91 98765-43210'), '919876543210');
  });
});
