import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { erasForRange } from './taxonomy.ts';

describe('erasForRange', () => {
  it('returns every decade a production run overlaps, not just the launch one', () => {
    // BMW E24: January 1976 – April 1989.
    assert.deepEqual(erasForRange(1976, 1989), ['1970s', '1980s']);
  });

  it('handles a run inside a single decade', () => {
    assert.deepEqual(erasForRange(1993, 1997), ['1990s']);
  });

  it('handles a single-year run', () => {
    assert.deepEqual(erasForRange(2001, 2001), ['2000s']);
  });

  it('treats a null end as "still in production" and runs to the given year', () => {
    assert.deepEqual(erasForRange(2018, null, 2026), ['2010s', '2020s']);
  });

  it('crosses a decade boundary exactly', () => {
    assert.deepEqual(erasForRange(1989, 1990), ['1980s', '1990s']);
  });

  it('returns nothing for an inverted range rather than throwing', () => {
    assert.deepEqual(erasForRange(2000, 1990), []);
  });

  it('clips to the buckets the vocabulary actually defines', () => {
    // eras.json starts at 1900 and ends at 2029; anything outside is dropped
    // rather than inventing a bucket.
    assert.deepEqual(erasForRange(1890, 1895), []);
  });
});
