import { describe, it, expect } from 'vitest';
import { redactFor } from './view';
import { createGame } from './state';
import { DEFAULT_CONFIG } from './config';

describe('redactFor', () => {
  const g = createGame(
    [{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }],
    DEFAULT_CONFIG, 'seed-1');
  it('reveals only the viewer hand; others are counts + status', () => {
    const v = redactFor(g, 'p1');
    expect(v.you?.hand).toHaveLength(7);
    const other = v.players.find(p => p.id === 'p2')!;
    expect(other.handCount).toBe(7);
    expect(other.status).toBe('active');
    expect((other as unknown as Record<string, unknown>).hand).toBeUndefined();
  });
  it('never leaks the draw pile, only its size', () => {
    const v = redactFor(g, 'p1');
    expect(v.drawCount).toBe(g.drawPile.length);
    expect((v as unknown as Record<string, unknown>).drawPile).toBeUndefined();
  });
});
