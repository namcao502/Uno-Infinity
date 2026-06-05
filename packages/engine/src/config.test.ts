import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, ruleConfigSchema, mergeConfig, deckTotal } from './config';
import { DEFAULT_DECK } from './cards';

describe('Infinity config', () => {
  it('default config is valid', () => {
    expect(ruleConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
  it('deckTotal counts the default deck', () => {
    expect(deckTotal(DEFAULT_DECK)).toBe(172); // 116 colored + 56 black
  });
  it('mergeConfig fills missing fields (incl. deck) from defaults', () => {
    const merged = mergeConfig({ startingHandSize: 8 });
    expect(merged.startingHandSize).toBe(8);
    expect(merged.deck.duel).toBe(DEFAULT_DECK.duel);
    expect(merged.win.condition).toBe('firstToEmpty');
  });
  it('rejects out-of-range hand size', () => {
    expect(ruleConfigSchema.safeParse({ ...DEFAULT_CONFIG, startingHandSize: 99 }).success).toBe(false);
  });
  it('rejects a deal that cannot fit the configured deck', () => {
    const tiny = { ...DEFAULT_CONFIG, startingHandSize: 15, maxPlayers: 10,
      deck: { ...DEFAULT_DECK, numberPerColor: 0 } }; // far fewer cards now
    expect(ruleConfigSchema.safeParse(tiny).success).toBe(false);
  });
});
