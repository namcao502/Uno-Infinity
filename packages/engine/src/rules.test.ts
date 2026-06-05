import { describe, it, expect } from 'vitest';
import { isPlayable, isMoveLegal } from './rules';
import { DEFAULT_CONFIG } from './config';
import { createGame, type GameState, type PlayerState } from './state';
import type { Card } from './cards';

const top: Card = { id: 't', color: 'red', kind: 'number', value: 5 };
const cardOf = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });

describe('isPlayable', () => {
  it('matches color / number; black always; colorLocked forces color', () => {
    expect(isPlayable(cardOf({ color: 'red', value: 9 }), top, 'red', false)).toBe(true);
    expect(isPlayable(cardOf({ color: 'blue', value: 5 }), top, 'red', false)).toBe(true);
    expect(isPlayable(cardOf({ color: 'blue', value: 9 }), top, 'red', false)).toBe(false);
    expect(isPlayable(cardOf({ color: 'black', kind: 'wild', value: null }), top, 'red', false)).toBe(true);
    expect(isPlayable(cardOf({ color: 'blue', value: 5 }), top, 'red', true)).toBe(false); // locked to red
  });
});

function mk(over: Partial<GameState>, hand: Card[]): GameState {
  const players: PlayerState[] = [
    { id: 'p1', name: 'A', isBot: false, connected: true, status: 'active', hand, score: 0 },
    { id: 'p2', name: 'B', isBot: false, connected: true, status: 'active', hand: [cardOf({ id: 'z' })], score: 0 },
  ];
  return { ...createGame([{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }], DEFAULT_CONFIG, 's'),
    players, discardPile: [top], currentColor: 'red', pending: null, ...over };
}

describe('isMoveLegal (Infinity)', () => {
  it('rejects out of turn', () => {
    const s = mk({}, [cardOf({ id: 'a', value: 9 })]);
    expect(isMoveLegal(s, { type: 'draw', playerId: 'p2' }).ok).toBe(false);
  });
  it('cannot finish on a black card (RD19)', () => {
    const s = mk({}, [cardOf({ id: 'a', color: 'black', kind: 'wild', value: null })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'red' }).ok).toBe(false);
  });
  it('x2 / div require a pending stack', () => {
    const s = mk({}, [cardOf({ id: 'a', value: 5 }), cardOf({ id: 'm', color: 'black', kind: 'mult', value: 2 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a', 'm'] }).ok).toBe(false);
  });
  it('a draw stacks only if value >= pending top (RD6)', () => {
    const s = mk({ pending: { total: 6, topValue: 6, source: 'blackDraw' } },
      [cardOf({ id: 'd', color: 'black', kind: 'draw', value: 4 }), cardOf({ id: 'd2', color: 'black', kind: 'draw', value: 8 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['d'] }).ok).toBe(false); // 4 < 6
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['d2'] }).ok).toBe(true);  // 8 >= 6
  });
  it('shield/counter need a pending and a held shield card (not the last card)', () => {
    const noShield = mk({ pending: { total: 4, topValue: 4, source: 'blackDraw' } }, [cardOf({ id: 'a', value: 5 })]);
    expect(isMoveLegal(noShield, { type: 'shield', playerId: 'p1' }).ok).toBe(false); // holds no shield
    const noPending = mk({}, [cardOf({ id: 's', color: 'black', kind: 'shield', value: null }), cardOf({ id: 'k', value: 2 })]);
    expect(isMoveLegal(noPending, { type: 'shield', playerId: 'p1' }).ok).toBe(false); // nothing to shield
    const ok = mk({ pending: { total: 4, topValue: 4, source: 'blackDraw' } },
      [cardOf({ id: 's', color: 'black', kind: 'shield', value: null }), cardOf({ id: 'k', value: 2 })]);
    expect(isMoveLegal(ok, { type: 'shield', playerId: 'p1' }).ok).toBe(true);
  });
  it('targeted cards need a valid active opponent', () => {
    // give p1 a spare card so the (black) swap is not the last card (RD19).
    const s = mk({}, [cardOf({ id: 'a', color: 'black', kind: 'swap', value: null }), cardOf({ id: 'k', value: 2 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a'] }).ok).toBe(false);          // no target
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2' }).ok).toBe(true);
  });
  it('cannot finish on a gift - it sheds the gifted card too (RD19)', () => {
    // hand = [gift, X]: playing gift + gifting X would empty the hand -> illegal.
    const s = mk({}, [cardOf({ id: 'g', color: 'black', kind: 'gift', value: null }), cardOf({ id: 'x', value: 4 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['g'], targetId: 'p2', giftCardId: 'x' }).ok).toBe(false);
  });
  it('cannot recycle a gift to empty the hand (RD19)', () => {
    const giftTop = cardOf({ id: 'gt', color: 'black', kind: 'gift', value: null });
    const s = mk({ discardPile: [giftTop] }, [cardOf({ id: 'r', color: 'black', kind: 'recycle', value: null }), cardOf({ id: 'x', value: 4 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['r'], targetId: 'p2', giftCardId: 'x' }).ok).toBe(false);
  });
  it('cannot recycle a minus to dump the whole hand (RD19)', () => {
    const minusTop = cardOf({ id: 'mt', color: 'red', kind: 'minus', value: null });
    const s = mk({ discardPile: [minusTop], currentColor: 'red' }, [cardOf({ id: 'r', color: 'black', kind: 'recycle', value: null }), cardOf({ id: 'r3', color: 'red', value: 3 })]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['r'], minusDiscard: true }).ok).toBe(false);
  });
});
