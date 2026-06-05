import { describe, it, expect } from 'vitest';
import { buildDeck, cardPoints, DEFAULT_DECK, isBlack, isDraw } from './cards';

describe('buildDeck (Infinity, config-driven)', () => {
  const deck = buildDeck(DEFAULT_DECK);
  it('produces the expected colored counts', () => {
    // numberPerColor=2 over 10 ranks over 4 colors = 80
    expect(deck.filter(c => c.kind === 'number').length).toBe(80);
    expect(deck.filter(c => c.kind === 'skip').length).toBe(8);     // 2/color
    expect(deck.filter(c => c.kind === 'minus').length).toBe(4);    // 1/color
    expect(deck.filter(c => c.kind === 'playAgain').length).toBe(8);
  });
  it('produces the expected black/special counts', () => {
    expect(deck.filter(c => c.kind === 'duel').length).toBe(2);
    expect(deck.filter(c => c.kind === 'bomb').length).toBe(2);
    expect(deck.filter(c => c.kind === 'shield').length).toBe(4);
    expect(deck.filter(c => c.kind === 'counter').length).toBe(4);
    expect(deck.filter(c => c.kind === 'mult').length).toBe(4);
    expect(deck.filter(c => c.kind === 'div').length).toBe(4);
  });
  it('every card has a unique id and an explicit value (number|null, never undefined)', () => {
    expect(new Set(deck.map(c => c.id)).size).toBe(deck.length);
    for (const c of deck) expect(c.value === null || typeof c.value === 'number').toBe(true);
    expect(deck.some(c => c.value === undefined)).toBe(false);
  });
  it('black draws carry their amount; colored draws too', () => {
    const blackDraws = deck.filter(c => c.kind === 'draw' && isBlack(c)).map(c => c.value).sort((a, b) => (a! - b!));
    expect(blackDraws).toContain(6);
    expect(blackDraws).toContain(10);
    expect(deck.filter(c => isDraw(c) && !isBlack(c)).every(c => c.value === 2 || c.value === 4)).toBe(true);
  });
  it('scores cards', () => {
    expect(cardPoints({ id: 'a', color: 'red', kind: 'number', value: 7 })).toBe(7);
    expect(cardPoints({ id: 'b', color: 'black', kind: 'bomb', value: null })).toBe(50);
    expect(cardPoints({ id: 'c', color: 'red', kind: 'draw', value: 4 })).toBe(4);
  });
});
