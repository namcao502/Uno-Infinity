import { describe, it, expect } from 'vitest';
import { toArray, normalize, sanitize } from '../src/serde.js';
import { createGame, applyMove, DEFAULT_CONFIG, deckTotal } from '@uno/engine';

describe('serde', () => {
  it('toArray restores a keyed-object array in numeric order', () => {
    expect(toArray({ 0: 'a', 1: 'b', 2: 'c' })).toEqual(['a', 'b', 'c']);
    expect(toArray(undefined)).toEqual([]);
    expect(toArray(['x', 'y'])).toEqual(['x', 'y']);
  });
  it('sanitize strips undefined but keeps null', () => {
    expect(sanitize({ a: undefined, b: null, c: 1 })).toEqual({ b: null, c: 1 });
  });
  it('a game survives an RTDB JSON round-trip (object-coerced) and stays playable', () => {
    const g = createGame(
      [{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }],
      DEFAULT_CONFIG, 'seed-x');
    // Simulate RTDB write+read: JSON strips undefined; arrays may come back as objects.
    const roundTripped = JSON.parse(JSON.stringify(sanitize(g)));
    const restored = normalize(roundTripped);
    expect(Array.isArray(restored.players)).toBe(true);
    expect(Array.isArray(restored.drawPile)).toBe(true);
    expect(restored.players[0].hand.length).toBe(7);
    // Conservation holds and the engine can still apply a move.
    const total = restored.drawPile.length + restored.discardPile.length +
      restored.players.reduce((s, p) => s + p.hand.length, 0);
    expect(total).toBe(deckTotal(DEFAULT_CONFIG.deck)); // Infinity deck (172 by default)
    expect(() => applyMove(restored, { type: 'draw', playerId: 'p1' })).not.toThrow();
  });
});
