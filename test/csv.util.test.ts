import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, escapeCsvCell } from '../src/common/export/csv.util';

describe('csv.util', () => {
  it('escapeCsvCell wraps values and escapes quotes', () => {
    assert.equal(escapeCsvCell('hello'), '"hello"');
    assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  });

  it('buildCsv joins headers and rows', () => {
    const csv = buildCsv(['a', 'b'], [[1, 'x'], [2, 'y']]);
    assert.equal(csv, 'a,b\n"1","x"\n"2","y"');
  });
});
