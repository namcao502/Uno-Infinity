import { describe, it, expect } from 'vitest';
import { applyMove } from './moves';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState, PendingDraw } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hands: Card[][]): GameState {
  const players: PlayerState[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id, name: id, isBot: false, connected: true, status: 'active',
    hand: hands[i]?.length ? hands[i] : [C({ id: `pad${i}`, color: 'blue', value: 1 })],
  }));
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: Array.from({ length: 40 }, (_, i) => C({ id: `d${i}`, color: 'green', value: (i % 9) + 1 })),
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, drawnPlayable: null, winnerId: null, seed: 's', log: [], chainId: 0, eventSeq: 0, ...over,
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
  it('colored draws can stack across colors when values are equal or increasing', () => {
    const s = mk({}, [
      [C({ id: 'r2', color: 'red', kind: 'draw', value: 2 }), C({ id: 'k1', value: 3 })],
      [C({ id: 'b2', color: 'blue', kind: 'draw', value: 2 }), C({ id: 'k2', value: 3 })],
      [C({ id: 'b4', color: 'blue', kind: 'draw', value: 4 }), C({ id: 'k3', value: 3 })],
    ]);
    const r1 = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['r2'] });
    const r2 = applyMove(r1, { type: 'play', playerId: 'p2', cardIds: ['b2'] });
    const r3 = applyMove(r2, { type: 'play', playerId: 'p3', cardIds: ['b4'] });
    expect(r3.pending).toEqual<PendingDraw>({ total: 8, topValue: 4, source: 'colorDraw' });
    expect(r3.currentColor).toBe('blue');
    expect(r3.turnIndex).toBe(0);
  });
  it('a black draw chooses the color that remains after the stack is drawn', () => {
    const s = mk({}, [[C({ id: 'a', color: 'black', kind: 'draw', value: 4 }), C({ id: 'k', value: 3 })], [], []]);
    const opened = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    expect(opened.currentColor).toBe('green');
    expect(opened.turnIndex).toBe(1);
    const drawn = applyMove(opened, { type: 'draw', playerId: 'p2' });
    expect(drawn.pending).toBeNull();
    expect(drawn.currentColor).toBe('green');
    expect(drawn.turnIndex).toBe(2);
  });
  it('drawing a playable card keeps the turn open; the player may then play it', () => {
    const s = mk({ drawPile: [C({ id: 'dx', color: 'red', value: 8 })] }, [[C({ id: 'k', color: 'blue', value: 2 })], [], []]);
    const drew = applyMove(s, { type: 'draw', playerId: 'p1' }); // top is red 5; red 8 is playable
    expect(drew.drawnPlayable).toMatchObject({ playerId: 'p1', cardId: 'dx' });
    expect(drew.turnIndex).toBe(0);                                // turn stays with p1
    const played = applyMove(drew, { type: 'play', playerId: 'p1', cardIds: ['dx'] });
    expect(played.discardPile.at(-1)!.id).toBe('dx');
    expect(played.drawnPlayable).toBeNull();
    expect(played.turnIndex).toBe(1);
  });
  it('after drawing a playable card, drawing again keeps it and passes the turn (no new card)', () => {
    const s = mk({ drawPile: [C({ id: 'dx', color: 'red', value: 8 })] }, [[C({ id: 'k', color: 'blue', value: 2 })], [], []]);
    const drew = applyMove(s, { type: 'draw', playerId: 'p1' });
    const passed = applyMove(drew, { type: 'draw', playerId: 'p1' });
    expect(passed.drawnPlayable).toBeNull();
    expect(passed.turnIndex).toBe(1);
    expect(passed.players[0].hand.map(c => c.id).sort()).toEqual(['dx', 'k']); // no extra draw
  });
  it('drawing an unplayable card ends the turn (no decision)', () => {
    const s = mk({ drawPile: [C({ id: 'dy', color: 'blue', value: 9 })] }, [[C({ id: 'k', color: 'blue', value: 2 })], [], []]);
    const drew = applyMove(s, { type: 'draw', playerId: 'p1' }); // blue 9 not playable on red 5
    expect(drew.drawnPlayable).toBeNull();
    expect(drew.turnIndex).toBe(1);
  });
  it('x2 doubles the attached draw and extends the stack (RD4: 2+4+8=14)', () => {
    const pending: PendingDraw = { total: 6, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'd', color: 'black', kind: 'draw', value: 4 }), C({ id: 'm', color: 'black', kind: 'mult', value: 2 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['d', 'm'], chosenColor: 'yellow' });
    expect(r.pending!.total).toBe(14);
    expect(r.pending!.source).toBe('blackDraw');
    expect(r.currentColor).toBe('yellow');
    expect(r.turnIndex).toBe(1);
  });
  it('a stacked draw updates the stack source to the newest draw card', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'd', color: 'black', kind: 'draw', value: 4 }), C({ id: 'k', value: 3 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['d'], chosenColor: 'blue' });
    expect(r.pending).toMatchObject({ total: 8, topValue: 4, source: 'blackDraw' });
    expect(r.currentColor).toBe('blue');
  });
  it('x2 alone (no attached draw) adds the current stack top to the total (2+4+4=10)', () => {
    const pending: PendingDraw = { total: 6, topValue: 4, source: 'colorDraw' };
    const s = mk({ pending, turnIndex: 0 }, [[C({ id: 'm', color: 'black', kind: 'mult', value: 2 }), C({ id: 'k', value: 3 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['m'] });
    expect(r.pending!.total).toBe(10);
    expect(r.pending!.topValue).toBe(4); // unchanged: no new + card was played
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

describe('game history log', () => {
  it('records a play entry with the actor and the cards played', () => {
    const s = mk({}, [[C({ id: 'a', color: 'red', value: 9 }), C({ id: 'a2', color: 'blue', value: 3 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'] });
    const last = r.log.at(-1)!;
    expect(last.kind).toBe('play');
    expect(last.actorId).toBe('p1');
    expect(last.cards?.map((c) => c.id)).toEqual(['a']);
    expect(last.stackId).toBeUndefined(); // a plain number play is not a draw chain
  });
  it('records a solo draw with count 1 and no stackId', () => {
    const s = mk({}, [[], [], []]);
    const r = applyMove(s, { type: 'draw', playerId: 'p1' });
    const last = r.log.at(-1)!;
    expect(last.kind).toBe('draw');
    expect(last.drawCount).toBe(1);
    expect(last.stackId).toBeUndefined();
  });
  it('ties a draw chain together under one stackId across players (RD grouping)', () => {
    const s = mk({}, [
      [C({ id: 'a', color: 'red', kind: 'draw', value: 2 }), C({ id: 'a2', color: 'blue', value: 3 })],
      [C({ id: 'b', color: 'red', kind: 'draw', value: 2 }), C({ id: 'b2', color: 'blue', value: 3 })],
      [],
    ]);
    const r1 = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'] });  // opens the stack
    const r2 = applyMove(r1, { type: 'play', playerId: 'p2', cardIds: ['b'] }); // extends it
    const r3 = applyMove(r2, { type: 'draw', playerId: 'p3' });                 // absorbs it
    const chain = r3.log.filter((e) => e.stackId != null);
    expect(chain).toHaveLength(3);
    expect(new Set(chain.map((e) => e.stackId)).size).toBe(1); // all the same chain
    const absorb = chain.find((e) => e.kind === 'draw');
    expect(absorb!.drawCount).toBe(4); // 2 + 2
  });
});
