import { describe, it, expect } from 'vitest';
import { applyMove } from './moves';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hands: Card[][]): GameState {
  const players: PlayerState[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id, name: id, isBot: false, connected: true, status: 'active',
    hand: hands[i]?.length ? hands[i] : [C({ id: `pad${i}`, color: 'blue', value: 1 }), C({ id: `pq${i}`, color: 'blue', value: 2 })], score: 0,
  }));
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: Array.from({ length: 40 }, (_, i) => C({ id: `d${i}`, color: 'green', value: (i % 9) + 1 })),
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, winnerId: null, seed: 's', log: '', ...over,
  };
}

describe('special effects', () => {
  it('skip advances two active seats', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'red', kind: 'skip', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.turnIndex).toBe(2);
  });
  it('playAgain keeps the turn and sets goAgain', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'red', kind: 'playAgain', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(r.turnIndex).toBe(0);
    expect(r.goAgain).toBe(true);
  });
  it('minus discards all same-color cards when chosen (RD10)', () => {
    const hand = [C({ id: 'm', color: 'red', kind: 'minus', value: null }), C({ id: 'r1', color: 'red', value: 3 }), C({ id: 'b1', color: 'blue', value: 4 })];
    const r = applyMove(mk({}, [hand, [], []]), { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscard: true });
    expect(r.players[0].hand.map(c => c.id)).toEqual(['b1']); // red cards dumped, blue kept
  });
  it('reverseDraw flips direction and the previous player draws value (RD13)', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'black', kind: 'reverseDraw', value: 4 }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'red' });
    expect(r.direction).toBe(-1);
    expect(r.players[2].hand.length).toBe(2 + 4); // p3 (now "previous" after the flip) drew 4
    expect(r.turnIndex).toBe(1);                  // skips the victim -> p2
  });
  it('bomb opens a response phase; accepting draws 4, countering bounces 4 to the bomber (RD12)', () => {
    const s = mk({}, [
      [C({ id: 'a', color: 'black', kind: 'bomb', value: 4 }), C({ id: 'k', value: 3 })],
      [C({ id: 'p2a', value: 1 })],                         // p2 will accept (draw 4)
      [C({ id: 'cn', color: 'black', kind: 'counter', value: null }), C({ id: 'p3a', value: 2 })], // p3 counters
    ]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    expect(entered.phase).toBe('bombResponse');
    expect(entered.bombResponse).toMatchObject({ bomberId: 'p1', pending: ['p2', 'p3'], bomberDraw: 0 });

    const afterP2 = applyMove(entered, { type: 'draw', playerId: 'p2' });   // accept
    expect(afterP2.players[1].hand.length).toBe(1 + 4);
    expect(afterP2.bombResponse!.pending).toEqual(['p3']);

    const done = applyMove(afterP2, { type: 'counter', playerId: 'p3' });   // bounce
    expect(done.phase).toBe('playing');
    expect(done.players[0].hand.length).toBe(1 + 4); // bomber drew 4 (one counter); 'k' remained
    expect(done.players[2].hand.map(c => c.id)).toEqual(['p3a']); // counter consumed, spare card kept
    expect(done.currentColor).toBe('green');
    expect(done.turnIndex).toBe(1); // after bomber p1 -> p2
  });
  it('swap exchanges hands with the target', () => {
    const r = applyMove(mk({}, [[C({ id: 'a', color: 'black', kind: 'swap', value: null }), C({ id: 'k', value: 3 })], [C({ id: 'y', value: 7 })], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2' });
    expect(r.players[0].hand.map(c => c.id)).toEqual(['y']); // p1 took p2's single card
    expect(r.players[1].hand.map(c => c.id)).toEqual(['k']); // p2 took p1's leftover
  });
  it('duel: +4T enters duel; opponent drawing ends it and passes after the challenger', () => {
    const s = mk({}, [[C({ id: 'a', color: 'black', kind: 'duel', value: 4 }), C({ id: 'k', value: 3 })], [], []]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2', chosenColor: 'blue' });
    expect(entered.phase).toBe('duel');
    expect(entered.duel).toMatchObject({ challengerId: 'p1', opponentId: 'p2', activeId: 'p2' });
    expect(entered.pending!.total).toBe(4);
    const ended = applyMove(entered, { type: 'draw', playerId: 'p2' }); // opponent takes the 4
    expect(ended.phase).toBe('playing');
    expect(ended.duel).toBeNull();
    expect(ended.players[1].hand.length).toBe(2 + 4);
    expect(ended.currentColor).toBe('blue');
    expect(ended.turnIndex).toBe(1); // after challenger p1 (idx 0) -> p2 (idx 1), per RD11
  });
  it('duel: the opponent playing /2 also ends the duel (RD11)', () => {
    const s = mk({}, [[C({ id: 'a', color: 'black', kind: 'duel', value: 4 }), C({ id: 'k', value: 3 })],
      [C({ id: 'v', color: 'black', kind: 'div', value: 2 }), C({ id: 'k2', value: 5 })], []]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2', chosenColor: 'red' });
    const ended = applyMove(entered, { type: 'play', playerId: 'p2', cardIds: ['v'] }); // /2: draw 2, stack clears
    expect(ended.phase).toBe('playing');
    expect(ended.duel).toBeNull();
    expect(ended.players[1].hand.length).toBe(1 + 2); // 'k2' kept (div played), drew floor(4/2)=2
    expect(ended.turnIndex).toBe(1); // resumes after challenger -> p2
  });
});
