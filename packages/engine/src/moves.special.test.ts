import { describe, it, expect } from 'vitest';
import { applyMove } from './moves';
import { isMoveLegal } from './rules';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hands: Card[][]): GameState {
  const players: PlayerState[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id, name: id, isBot: false, connected: true, status: 'active',
    hand: hands[i]?.length ? hands[i] : [C({ id: `pad${i}`, color: 'blue', value: 1 }), C({ id: `pq${i}`, color: 'blue', value: 2 })],
  }));
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: Array.from({ length: 40 }, (_, i) => C({ id: `d${i}`, color: 'green', value: (i % 9) + 1 })),
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, pendingUntil: null, duel: null, bombResponse: null, goAgain: false, drawnPlayable: null, winnerId: null, seed: 's', log: [], chainId: 0, eventSeq: 0, ...over,
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
  it('minus discards exactly the chosen same-color cards (RD10)', () => {
    const hand = [C({ id: 'm', color: 'red', kind: 'minus', value: null }),
      C({ id: 'r1', color: 'red', value: 3 }), C({ id: 'r2', color: 'red', value: 7 }), C({ id: 'b1', color: 'blue', value: 4 })];
    const all = applyMove(mk({}, [hand, [], []]), { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: ['r1', 'r2'] });
    expect(all.players[0].hand.map(c => c.id)).toEqual(['b1']);            // both reds dumped, blue kept
    const partial = applyMove(mk({}, [hand, [], []]), { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: ['r1'] });
    expect(partial.players[0].hand.map(c => c.id)).toEqual(['r2', 'b1']); // only the chosen red dumped
    const none = applyMove(mk({}, [hand, [], []]), { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: [] });
    expect(none.players[0].hand.map(c => c.id)).toEqual(['r1', 'r2', 'b1']); // nothing dumped
  });
  it('minus legality: discard ids must be in hand and the minus color', () => {
    const s = mk({}, [[C({ id: 'm', color: 'red', kind: 'minus', value: null }),
      C({ id: 'r1', color: 'red', value: 3 }), C({ id: 'b1', color: 'blue', value: 4 })], [], []]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: ['r1'] }).ok).toBe(true);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: ['b1'] }).ok).toBe(false); // wrong color
    expect(isMoveLegal(s, { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: ['nope'] }).ok).toBe(false); // not in hand
  });
  it('reverseDraw flips direction and opens a defendable +draw at the previous player (RD13)', () => {
    const opened = applyMove(mk({}, [[C({ id: 'a', color: 'black', kind: 'reverseDraw', value: 4 }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'] });
    expect(opened.direction).toBe(-1);
    expect(opened.pending).toMatchObject({ total: 4, topValue: 4 });
    expect(opened.turnIndex).toBe(2);               // passes to p3 (previous player after the flip), not skipped
    expect(opened.players[2].hand.length).toBe(2);  // not forced to draw - p3 may defend
    const drew = applyMove(opened, { type: 'draw', playerId: 'p3' });
    expect(drew.players[2].hand.length).toBe(2 + 4); // p3 chooses to absorb the 4
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
  it('duel opens a fresh draw chain: its stackId never collides with a prior chain (RD11)', () => {
    // Simulate a previously-resolved draw chain (chainId already 1, e.g. a +draw stack earlier).
    const s = mk({ chainId: 1 }, [[C({ id: 'a', color: 'black', kind: 'duel', value: 4 }), C({ id: 'k', value: 3 })], [], []]);
    const entered = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['a'], targetId: 'p2', chosenColor: 'blue' });
    expect(entered.chainId).toBe(2);                 // a duel is a new +4 chain -> fresh id
    const ended = applyMove(entered, { type: 'draw', playerId: 'p2' });
    const drawEntry = ended.log.find((e) => e.kind === 'draw' && e.stackId != null);
    expect(drawEntry?.stackId).toBe(2);              // tagged with the new chain, not the stale 1
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

const DUC = (id: string) => C({ id, color: 'black', kind: 'drawUntilColor', value: null });
const RECYCLE = (id: string) => C({ id, color: 'black', kind: 'recycle', value: null });

describe('draw-until-color (defendable)', () => {
  it('opens a pendingUntil threat and passes to the next player without drawing yet', () => {
    const opened = applyMove(mk({}, [[DUC('a'), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    expect(opened.pendingUntil).toEqual({ color: 'green' });
    expect(opened.turnIndex).toBe(1);              // p2 must respond
    expect(opened.players[1].hand.length).toBe(2); // p2 drew nothing yet
    expect(opened.currentColor).toBe('green');
  });

  it('accept (draw) makes the target draw until the color, then skips them', () => {
    const opened = applyMove(
      mk({ drawPile: [C({ id: 'g', color: 'green', value: 1 }), C({ id: 'r1', color: 'red', value: 2 }), C({ id: 'r2', color: 'red', value: 3 })] },
        [[DUC('a'), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    const accepted = applyMove(opened, { type: 'draw', playerId: 'p2' });
    expect(accepted.pendingUntil).toBeNull();
    expect(accepted.players[1].hand.length).toBe(2 + 3); // drew red, red, then green (stops on green)
    expect(accepted.turnIndex).toBe(2);                  // p2 skipped, lands on p3
    expect(accepted.currentColor).toBe('green');
  });

  it('bounces with the player own draw-until-color, re-aiming the color at the next player', () => {
    const opened = applyMove(mk({}, [[DUC('a'), C({ id: 'k', value: 3 })], [DUC('b'), C({ id: 's2', color: 'blue', value: 7 })], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    const bounced = applyMove(opened, { type: 'play', playerId: 'p2', cardIds: ['b'], chosenColor: 'blue' });
    expect(bounced.pendingUntil).toEqual({ color: 'blue' });
    expect(bounced.turnIndex).toBe(2);              // re-aimed at p3
    expect(bounced.players[1].hand.length).toBe(1); // p2 drew nothing; played its DUC
    expect(bounced.currentColor).toBe('blue');
  });

  it('bounces with a recycle that copies the draw-until-color on top', () => {
    const opened = applyMove(mk({}, [[DUC('a'), C({ id: 'k', value: 3 })], [RECYCLE('r'), C({ id: 's4', color: 'blue', value: 7 })], []]),
      { type: 'play', playerId: 'p1', cardIds: ['a'], chosenColor: 'green' });
    const bounced = applyMove(opened, { type: 'play', playerId: 'p2', cardIds: ['r'], chosenColor: 'yellow' });
    expect(bounced.pendingUntil).toEqual({ color: 'yellow' });
    expect(bounced.turnIndex).toBe(2);
    expect(bounced.players[1].hand.length).toBe(1); // recycle played, spare kept
    expect(bounced.currentColor).toBe('yellow');
  });

  it('legality: only draw-until-color, recycle, or draw answer a pendingUntil threat', () => {
    const s = mk({ pendingUntil: { color: 'green' }, turnIndex: 1 },
      [[], [C({ id: 'num', color: 'red', value: 4 }), DUC('b')], []]);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p2', cardIds: ['num'] }).ok).toBe(false);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p2', cardIds: ['b'], chosenColor: 'blue' }).ok).toBe(true);
    expect(isMoveLegal(s, { type: 'play', playerId: 'p2', cardIds: ['b'] }).ok).toBe(false); // needs a color
    expect(isMoveLegal(s, { type: 'draw', playerId: 'p2' }).ok).toBe(true);

    // RD19: cannot bounce with your last card (it is black).
    const last = mk({ pendingUntil: { color: 'green' }, turnIndex: 1 }, [[], [DUC('b')], []]);
    expect(isMoveLegal(last, { type: 'play', playerId: 'p2', cardIds: ['b'], chosenColor: 'blue' }).ok).toBe(false);

    // Recycle bounce is legal when the draw-until-color is on top to copy.
    const rec = mk({ pendingUntil: { color: 'green' }, turnIndex: 1, discardPile: [DUC('duc-top')] },
      [[], [RECYCLE('r'), C({ id: 'sp', color: 'red', value: 1 })], []]);
    expect(isMoveLegal(rec, { type: 'play', playerId: 'p2', cardIds: ['r'], chosenColor: 'blue' }).ok).toBe(true);
  });
});

describe('recycle on a recycle (see-through)', () => {
  it('copies the real card beneath a recycle (skip advances two)', () => {
    const s = mk({ discardPile: [C({ id: 'sk', color: 'red', kind: 'skip', value: null }), RECYCLE('rA')] },
      [[RECYCLE('r'), C({ id: 'k', value: 3 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['r'] });
    expect(r.turnIndex).toBe(2); // copied skip advances 2 (p2 skipped)
  });
  it('copies an underlying draw and opens a stack', () => {
    const s = mk({ discardPile: [C({ id: 'd4', color: 'blue', kind: 'draw', value: 4 }), RECYCLE('rA')] },
      [[RECYCLE('r'), C({ id: 'k', value: 3 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['r'] });
    expect(r.pending).toMatchObject({ total: 4, topValue: 4 });
    expect(r.turnIndex).toBe(1);
  });
  it('sees through TWO stacked recycles to the real card', () => {
    const s = mk({ discardPile: [C({ id: 'sk', color: 'red', kind: 'skip', value: null }), RECYCLE('rA'), RECYCLE('rB')] },
      [[RECYCLE('r'), C({ id: 'k', value: 3 })], [], []]);
    const r = applyMove(s, { type: 'play', playerId: 'p1', cardIds: ['r'] });
    expect(r.turnIndex).toBe(2);
  });
  it('legality: recycle is allowed on a recycle, but not on the lone opening card', () => {
    const onRecycle = mk({ discardPile: [C({ id: 'sk', color: 'red', kind: 'skip', value: null }), RECYCLE('rA')] },
      [[RECYCLE('r'), C({ id: 'k', value: 3 })], [], []]);
    expect(isMoveLegal(onRecycle, { type: 'play', playerId: 'p1', cardIds: ['r'] }).ok).toBe(true);
    const loneOpener = mk({ discardPile: [C({ id: 'op', color: 'red', value: 5 })] },
      [[RECYCLE('r'), C({ id: 'k', value: 3 })], [], []]);
    expect(isMoveLegal(loneOpener, { type: 'play', playerId: 'p1', cardIds: ['r'] }).ok).toBe(false);
  });
});

describe('granular history log', () => {
  const detail = (r: GameState, sub: string) => r.log.some((e) => e.detail && e.text.includes(sub));
  it('logs the skipped player as a consequence line', () => {
    const r = applyMove(mk({}, [[C({ id: 'sk', color: 'red', kind: 'skip', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['sk'] });
    expect(detail(r, 'skips p2')).toBe(true);
  });
  it('carries the chosen color on a wild play line', () => {
    const r = applyMove(mk({}, [[C({ id: 'w', color: 'black', kind: 'wild', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['w'], chosenColor: 'blue' });
    expect(r.log.some((e) => e.kind === 'play' && e.chosenColor === 'blue')).toBe(true);
  });
  it('names the target of a steal', () => {
    const r = applyMove(mk({}, [[C({ id: 'st', color: 'black', kind: 'steal', value: null }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['st'], targetId: 'p2' });
    expect(detail(r, 'from p2')).toBe(true);
  });
  it('logs the running total when a draw is stacked', () => {
    const r = applyMove(mk({ pending: { total: 2, topValue: 2, source: 'colorDraw' } },
      [[C({ id: 'd4', color: 'red', kind: 'draw', value: 4 }), C({ id: 'k', value: 3 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['d4'] });
    expect(detail(r, 'draw stack is now 6')).toBe(true);
  });
  it('logs the dumped count for a minus', () => {
    const r = applyMove(mk({}, [[C({ id: 'm', color: 'red', kind: 'minus', value: null }), C({ id: 'r1', color: 'red', value: 3 }), C({ id: 'b1', color: 'blue', value: 4 })], [], []]),
      { type: 'play', playerId: 'p1', cardIds: ['m'], minusDiscardIds: ['r1'] });
    expect(detail(r, 'dumped 1 red card')).toBe(true);
  });
});
