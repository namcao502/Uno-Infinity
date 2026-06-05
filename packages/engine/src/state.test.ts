import { describe, it, expect } from 'vitest';
import { createGame, nextActiveIndex, type PlayerSeed } from './state';
import { DEFAULT_CONFIG, deckTotal } from './config';

const seeds: PlayerSeed[] = [
  { id: 'p1', name: 'Nam', isBot: false },
  { id: 'p2', name: 'Linh', isBot: false },
  { id: 'b1', name: 'Bot', isBot: true },
];

describe('createGame', () => {
  it('deals the configured hand size and starts everyone active', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 'seed-1');
    expect(g.players).toHaveLength(3);
    for (const p of g.players) { expect(p.hand).toHaveLength(7); expect(p.status).toBe('active'); }
  });
  it('conserves the whole deck across piles and hands', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 'seed-1');
    const total = g.drawPile.length + g.discardPile.length + g.players.reduce((s, p) => s + p.hand.length, 0);
    expect(total).toBe(deckTotal(DEFAULT_CONFIG.deck));
  });
  it('starts on a colored NUMBER card, color not black, with clean flags', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 'seed-1');
    const top = g.discardPile.at(-1)!;
    expect(top.kind).toBe('number');
    expect(top.color).not.toBe('black');
    expect(g.currentColor).toBe(top.color);
    expect(g.phase).toBe('playing');
    expect(g.pending).toBeNull();
    expect(g.colorLocked).toBe(false);
    expect(g.goAgain).toBe(false);
  });
  it('is deterministic for the same seed', () => {
    const a = createGame(seeds, DEFAULT_CONFIG, 's');
    const b = createGame(seeds, DEFAULT_CONFIG, 's');
    expect(a.players[0].hand.map(c => c.id)).toEqual(b.players[0].hand.map(c => c.id));
  });
});

describe('nextActiveIndex', () => {
  it('skips eliminated (out) players', () => {
    const g = createGame(seeds, DEFAULT_CONFIG, 's');
    g.players[1].status = 'out';                 // p2 eliminated
    expect(nextActiveIndex(g, 0, 1)).toBe(2);    // 0 -> skip 1 -> 2
    g.direction = -1;
    expect(nextActiveIndex(g, 0, 1)).toBe(2);    // backward also skips 1 -> wraps to 2
  });
});
