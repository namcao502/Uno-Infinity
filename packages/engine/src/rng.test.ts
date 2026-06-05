import { describe, it, expect } from 'vitest';
import { createRng, shuffle } from './rng';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('seed-1'); const b = createRng('seed-1');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('shuffle is a permutation and deterministic per seed', () => {
    const arr = [1, 2, 3, 4, 5];
    const s1 = shuffle(arr, createRng('x'));
    const s2 = shuffle(arr, createRng('x'));
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(arr).toEqual([1, 2, 3, 4, 5]); // input not mutated
  });
});
