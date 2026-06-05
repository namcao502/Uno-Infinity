import { describe, it, expect } from 'vitest';
import { applyMove } from './moves';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState, PendingDraw } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hands: Card[][]): GameState {
  const players: PlayerState[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id, name: id, isBot: false, connected: true, status: 'active',
    hand: hands[i]?.length ? hands[i] : [C({ id: `pad${i}`, color: 'blue', value: 1 })], score: 0,
  }));
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: Array.from({ length: 40 }, (_, i) => C({ id: `d${i}`, color: 'green', value: (i % 9) + 1 })),
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, winnerId: null, seed: 's', log: '', ...over,
  };
}

describe('applyMove - core', () => {
  it('plays a matching number, advances turn, does not mutate input', () => {
    const s = mk({}, [[C({ id: 'a', color: 'red', value: 9 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.discardPile.at(-1)!.id).toBe('a');
    expect(r.players[0].hand).toHaveLength(0);
    expect(r.turnIndex).toBe(1);
    expect(s.players[0].hand).toHaveLength(1);
  });
  it('a run locks the color to the run color', () => {
    const run = [C({ id: 'a', color: 'red', value: 6 }), C({ id: 'b', color: 'red', value: 7 }), C({ id: 'c', color: 'red', value: 8 })];
    const s = mk({ currentColor: 'red' }, [run, [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a', 'b', 'c'] });
    expect(r.colorLocked).toBe(true);
    expect(r.currentColor).toBe('red');
    expect(r.discardPile.at(-1)!.value).toBe(8);
  });
  it('a draw card starts a pending stack and passes to the victim', () => {
    const s = mk({}, [[C({ id: 'a', color: 'red', kind: 'draw', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.pending).toEqual<PendingDraw>({ total: 2, topValue: 2, source: 'colorDraw' });
    expect(r.turnIndex).toBe(1);
  });
  it('x2 doubles the attached draw and extends the stack (RD4: 2+4+8=14)', () => {
    const pending: PendingDraw = { total: 6, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'd', color: 'black', kind: 'draw', value: 4 }), C({ id: 'm', color: 'black', kind: 'mult', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['d', 'm'] });
    expect(r.pending!.total).toBe(14);
    expect(r.turnIndex).toBe(1);
  });
  it('/2 halves the pending; the player draws the result (RD5: 6 -> 3)', () => {
    const pending: PendingDraw = { total: 6, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'v', color: 'black', kind: 'div', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['v'] });
    expect(r.pending).toBeNull();
    expect(r.players[0].hand.length).toBe(3); // drew 3 (the div card left the hand)
    expect(r.turnIndex).toBe(1);
  });
  it('shield pushes the pending to the next player (RD7)', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'a', value: 1 }), C({ id: 'sh', color: 'black', kind: 'shield', value: null })], [], []]);
    const r = applyMove(s, { type: 'shield', playerId: 'p1' });
    expect(r.pending).toEqual(pending);  // stack preserved
    expect(r.turnIndex).toBe(1);         // now p2 faces it
    expect(r.players[0].hand.length).toBe(1); // p1 drew nothing; shield card consumed
  });
  it('drawing the stack draws total and passes (victim skipped)', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const s = mk({ pending, turnIndex: 1 }, [[], [], []]);
    const r = applyMove(s, { type: 'draw', playerId: 'p2' });
    expect(r.players[1].hand.length).toBe(1 + 4); // pad + 4 drawn
    expect(r.pending).toBeNull();
    expect(r.turnIndex).toBe(2);
  });
  it('a player whose hand exceeds 30 is eliminated (RD20) and skipped', () => {
    const big = Array.from({ length: 28 }, (_, i) => C({ id: `h${i}`, color: 'green', value: (i % 9) + 1 }));
    const pending: PendingDraw = { total: 6, topValue: 6, source: 'blackDraw' };
    const s = mk({ pending, turnIndex: 1 }, [[C({ id: 'a', value: 1 })], big, [C({ id: 'b', value: 2 })]]);
    const r = applyMove(s, { type: 'draw', playerId: 'p2' }); // 28 + 6 = 34 > 30
    expect(r.players[1].status).toBe('out');
  });
});
