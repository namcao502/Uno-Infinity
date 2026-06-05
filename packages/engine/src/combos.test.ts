import { describe, it, expect } from 'vitest';
import { classifySet } from './combos';
import type { Card } from './cards';
const num = (id: string, color: Card['color'], v: number): Card => ({ id, color, kind: 'number', value: v });

describe('classifySet', () => {
  it('single card', () => {
    const r = classifySet([num('a', 'red', 5)]);
    expect(r.ok && r.combo.kind).toBe('single');
  });
  it('pair (same color+number)', () => {
    const r = classifySet([num('a', 'red', 6), num('b', 'red', 6)]);
    expect(r.ok && r.combo.kind).toBe('pair');
  });
  it('run 6-7-8 same color, locks color', () => {
    const r = classifySet([num('a', 'red', 6), num('b', 'red', 7), num('c', 'red', 8)]);
    expect(r.ok && r.combo.kind).toBe('run');
    expect(r.ok && r.combo.locksColor).toBe(true);
    expect(r.ok && r.combo.finalTop.value).toBe(8);
  });
  it('three consecutive pairs 6-6-7-7-8-8', () => {
    const r = classifySet([num('a', 'red', 6), num('b', 'red', 6), num('c', 'red', 7), num('d', 'red', 7), num('e', 'red', 8), num('f', 'red', 8)]);
    expect(r.ok && r.combo.kind).toBe('pairsRun');
  });
  it('x2 combo = one draw + one mult', () => {
    const draw: Card = { id: 'd', color: 'black', kind: 'draw', value: 4 };
    const mult: Card = { id: 'm', color: 'black', kind: 'mult', value: 2 };
    const r = classifySet([draw, mult]);
    expect(r.ok && r.combo.isX2).toBe(true);
  });
  it('rejects a non-consecutive multi-number set', () => {
    expect(classifySet([num('a', 'red', 6), num('b', 'red', 8), num('c', 'red', 9)]).ok).toBe(false);
  });
});
