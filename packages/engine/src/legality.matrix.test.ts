import { describe, it, expect } from 'vitest';
import { isPlayable, isMoveLegal } from './rules';
import { DEFAULT_CONFIG } from './config';
import { createGame, type GameState, type PlayerState } from './state';
import { COLORS, type Card, type CardColor } from './cards';
import type { Move } from './types';

const top: Card = { id: 't', color: 'red', kind: 'number', value: 5 };
const cardOf = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });

function mk(over: Partial<GameState>, hand: Card[]): GameState {
  const players: PlayerState[] = [
    { id: 'p1', name: 'A', isBot: false, connected: true, status: 'active', hand },
    { id: 'p2', name: 'B', isBot: false, connected: true, status: 'active', hand: [cardOf({ id: 'z' })] },
  ];
  return {
    ...createGame([{ id: 'p1', name: 'A', isBot: false }, { id: 'p2', name: 'B', isBot: false }], DEFAULT_CONFIG, 's'),
    players, discardPile: [top], currentColor: 'red', pending: null, ...over,
  };
}

// ---------------------------------------------------------------------------
// 1) Exhaustive isPlayable guard: every distinct card type on every other, for
//    both colorLocked states and each active color, must agree with an independent
//    restatement of the matching rule (RD1/RD3). This is a golden regression lock -
//    any change to isPlayable that shifts a single pair fails here.
// ---------------------------------------------------------------------------

/** Every distinct card TYPE in the deck (kind + color + value), one of each. */
const ALL_CARDS: Card[] = (() => {
  const out: Card[] = [];
  let n = 0;
  const add = (c: Omit<Card, 'id'>) => out.push({ id: `c${n++}`, ...c });
  for (const color of COLORS) {
    for (let v = 0; v <= 10; v++) add({ color, kind: 'number', value: v });
    add({ color, kind: 'draw', value: 2 });
    add({ color, kind: 'draw', value: 4 });
    add({ color, kind: 'playAgain', value: null });
    add({ color, kind: 'skip', value: null });
    add({ color, kind: 'minus', value: null });
  }
  for (const v of [2, 4, 6, 8, 10]) add({ color: 'black', kind: 'draw', value: v });
  add({ color: 'black', kind: 'mult', value: 2 });
  add({ color: 'black', kind: 'div', value: 2 });
  add({ color: 'black', kind: 'duel', value: 4 });
  add({ color: 'black', kind: 'bomb', value: 4 });
  add({ color: 'black', kind: 'reverseDraw', value: 4 });
  add({ color: 'black', kind: 'reverseDraw', value: 10 });
  add({ color: 'black', kind: 'recycle', value: null });
  add({ color: 'black', kind: 'wild', value: null });
  add({ color: 'black', kind: 'eye', value: null });
  add({ color: 'black', kind: 'swap', value: null });
  add({ color: 'black', kind: 'steal', value: null });
  add({ color: 'black', kind: 'gift', value: null });
  add({ color: 'black', kind: 'drawUntilColor', value: null });
  add({ color: 'black', kind: 'shield', value: null });
  add({ color: 'black', kind: 'counter', value: null });
  return out;
})();

/** Independent restatement of the matching rule, structured as explicit cases to cross-check
 *  isPlayable rather than mirror its control flow. Black plays on anything (RD1); a run/3-pairs
 *  lock forces the active color; otherwise a colored card matches by color, by number value, or by
 *  special kind. */
function refPlayable(card: Card, pile: Card, active: CardColor, locked: boolean): boolean {
  if (card.kind === 'shield' || card.kind === 'counter' || card.kind === 'mult' || card.kind === 'div') return false; // stack-response-only
  if (card.kind === 'bomb') return pile.kind === 'number'; // RD12: bomb plays only onto a number top
  const sameColor = card.color === active;
  if (card.color === 'black') return true;
  if (locked) return sameColor;
  if (sameColor) return true;
  if (card.kind === 'number') return pile.kind === 'number' && card.value === pile.value;
  return card.kind === pile.kind;
}

describe('isPlayable matrix (exhaustive)', () => {
  it('agrees with the spec for every card-on-card pair, color, and lock state', () => {
    const mismatches: string[] = [];
    for (const played of ALL_CARDS) {
      for (const pile of ALL_CARDS) {
        for (const active of COLORS) {
          for (const locked of [false, true]) {
            const got = isPlayable(played, pile, active, locked);
            const want = refPlayable(played, pile, active, locked);
            if (got !== want) {
              mismatches.push(`${played.kind}/${played.color}/${played.value} on ${pile.kind}/${pile.color}/${pile.value} active=${active} locked=${locked}: got ${got}, want ${want}`);
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('covers all 19 card kinds', () => {
    expect(new Set(ALL_CARDS.map((c) => c.kind)).size).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// 2) isMoveLegal equivalence-class matrix. One row per meaningful legality class
//    (matching, draw stacks, draw-until-color threat, preconditions, RD19, turn).
// ---------------------------------------------------------------------------

interface Case { name: string; over?: Partial<GameState>; hand: Card[]; move: Move; ok: boolean }

const num = (id: string, color: CardColor, value: number): Card => ({ id, color, kind: 'number', value });
const spare = cardOf({ id: 'spare', color: 'red', value: 2 }); // a colored filler so a black play is not the last card (RD19)
const play = (cardIds: string[], extra: Partial<Extract<Move, { type: 'play' }>> = {}): Move =>
  ({ type: 'play', playerId: 'p1', cardIds, ...extra });

const CASES: Case[] = [
  // --- basic matching (no pending), top = red 5 ---
  { name: 'same-color number is playable', hand: [num('a', 'red', 9)], move: play(['a']), ok: true },
  { name: 'cross-color number with matching value is playable', hand: [num('a', 'blue', 5)], move: play(['a']), ok: true },
  { name: 'cross-color number with different value is illegal', hand: [num('a', 'blue', 9)], move: play(['a']), ok: false },
  { name: 'wild requires a chosen color', hand: [cardOf({ id: 'a', color: 'black', kind: 'wild', value: null }), spare], move: play(['a']), ok: false },
  { name: 'wild with a chosen color (not last card) is playable', hand: [cardOf({ id: 'a', color: 'black', kind: 'wild', value: null }), spare], move: play(['a'], { chosenColor: 'red' }), ok: true },
  { name: 'colorLocked rejects an off-color card', over: { colorLocked: true }, hand: [num('a', 'blue', 5)], move: play(['a']), ok: false },
  { name: 'colorLocked allows a same-color card', over: { colorLocked: true }, hand: [num('a', 'red', 9)], move: play(['a']), ok: true },
  { name: 'special matches across color by kind', over: { discardPile: [cardOf({ id: 'topskip', color: 'red', kind: 'skip', value: null })] }, hand: [cardOf({ id: 'a', color: 'blue', kind: 'skip', value: null })], move: play(['a']), ok: true },
  { name: 'special with a different kind across color is illegal', over: { discardPile: [cardOf({ id: 'topskip', color: 'red', kind: 'skip', value: null })] }, hand: [cardOf({ id: 'a', color: 'blue', kind: 'playAgain', value: null })], move: play(['a']), ok: false },

  // --- pending draw stack ---
  { name: 'draw stacks when value >= top (colored)', over: { pending: { total: 4, topValue: 4, source: 'colorDraw' } }, hand: [cardOf({ id: 'a', color: 'red', kind: 'draw', value: 4 })], move: play(['a']), ok: true },
  { name: 'draw too low to stack is illegal', over: { pending: { total: 4, topValue: 4, source: 'colorDraw' } }, hand: [cardOf({ id: 'a', color: 'red', kind: 'draw', value: 2 })], move: play(['a']), ok: false },
  { name: 'colored draw cannot stack on a black draw', over: { pending: { total: 4, topValue: 4, source: 'blackDraw' } }, hand: [cardOf({ id: 'a', color: 'red', kind: 'draw', value: 4 }), spare], move: play(['a']), ok: false },
  { name: 'black draw stacks on a black draw (with color)', over: { pending: { total: 4, topValue: 4, source: 'blackDraw' } }, hand: [cardOf({ id: 'a', color: 'black', kind: 'draw', value: 4 }), spare], move: play(['a'], { chosenColor: 'green' }), ok: true },
  { name: 'x2 alone is legal on a stack', over: { pending: { total: 6, topValue: 4, source: 'colorDraw' } }, hand: [cardOf({ id: 'a', color: 'black', kind: 'mult', value: 2 }), spare], move: play(['a']), ok: true },
  { name: 'draw + x2 is legal on a stack', over: { pending: { total: 4, topValue: 4, source: 'colorDraw' } }, hand: [cardOf({ id: 'd', color: 'red', kind: 'draw', value: 4 }), cardOf({ id: 'm', color: 'black', kind: 'mult', value: 2 }), spare], move: play(['d', 'm']), ok: true },
  { name: '/2 is legal on a stack', over: { pending: { total: 6, topValue: 4, source: 'colorDraw' } }, hand: [cardOf({ id: 'a', color: 'black', kind: 'div', value: 2 }), spare], move: play(['a']), ok: true },
  { name: 'shield needs a pending and a held shield', over: { pending: { total: 4, topValue: 4, source: 'blackDraw' } }, hand: [cardOf({ id: 's', color: 'black', kind: 'shield', value: null }), spare], move: { type: 'shield', playerId: 'p1' }, ok: true },
  { name: 'counter needs a pending and a held counter', over: { pending: { total: 4, topValue: 4, source: 'blackDraw' } }, hand: [cardOf({ id: 'c', color: 'black', kind: 'counter', value: null }), spare], move: { type: 'counter', playerId: 'p1' }, ok: true },
  { name: 'a normal card cannot be played on a stack', over: { pending: { total: 4, topValue: 4, source: 'colorDraw' } }, hand: [num('a', 'red', 9)], move: play(['a']), ok: false },

  // --- draw-until-color threat ---
  { name: 'draw-until-color bounces a draw-until-color threat', over: { pendingUntil: { color: 'red' } }, hand: [cardOf({ id: 'a', color: 'black', kind: 'drawUntilColor', value: null }), spare], move: play(['a'], { chosenColor: 'green' }), ok: true },
  { name: 'recycle (with a real target) may answer the threat', over: { pendingUntil: { color: 'red' }, discardPile: [num('beneath', 'red', 3), top] }, hand: [cardOf({ id: 'a', color: 'black', kind: 'recycle', value: null }), spare], move: play(['a']), ok: true },
  { name: 'a normal card must draw to accept the threat', over: { pendingUntil: { color: 'red' } }, hand: [num('a', 'red', 5)], move: play(['a']), ok: false },

  // --- preconditions ---
  { name: 'bomb plays on a number', hand: [cardOf({ id: 'a', color: 'black', kind: 'bomb', value: 4 }), spare], move: play(['a'], { chosenColor: 'red' }), ok: true },
  { name: 'bomb does not play on a non-number', over: { discardPile: [cardOf({ id: 'topskip', color: 'red', kind: 'skip', value: null })] }, hand: [cardOf({ id: 'a', color: 'black', kind: 'bomb', value: 4 }), spare], move: play(['a'], { chosenColor: 'red' }), ok: false },
  { name: 'a targeted card needs an opponent', hand: [cardOf({ id: 'a', color: 'black', kind: 'swap', value: null }), spare], move: play(['a']), ok: false },
  { name: 'a targeted card with a valid opponent is legal', hand: [cardOf({ id: 'a', color: 'black', kind: 'swap', value: null }), spare], move: play(['a'], { targetId: 'p2' }), ok: true },

  // --- RD19 + turn ---
  { name: 'cannot finish on a black card (RD19)', hand: [cardOf({ id: 'a', color: 'black', kind: 'wild', value: null })], move: play(['a'], { chosenColor: 'red' }), ok: false },
  { name: 'can finish on a colored card', hand: [num('a', 'red', 5)], move: play(['a']), ok: true },
  { name: 'a move out of turn is illegal', hand: [num('a', 'red', 9)], move: { type: 'draw', playerId: 'p2' }, ok: false },
  { name: 'drawing on your turn is always legal', hand: [num('a', 'blue', 9)], move: { type: 'draw', playerId: 'p1' }, ok: true },
];

describe('isMoveLegal matrix (equivalence classes)', () => {
  for (const c of CASES) {
    it(`${c.ok ? 'allows' : 'rejects'}: ${c.name}`, () => {
      expect(isMoveLegal(mk(c.over ?? {}, c.hand), c.move).ok).toBe(c.ok);
    });
  }
});
