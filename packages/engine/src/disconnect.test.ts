import { describe, it, expect } from 'vitest';
import { createGame, nextRoundWith } from './state';
import { skipTurn, forfeit, seatPlayer } from './moves';
import { DEFAULT_CONFIG } from './config';

const seeds = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));

describe('skipTurn', () => {
  it('advances to the next active player with no draw on a plain turn', () => {
    const g = createGame(seeds(3), DEFAULT_CONFIG, 'seed-skip');
    const handBefore = g.players[0].hand.length;
    const next = skipTurn(g);
    expect(next.turnIndex).toBe(1);
    expect(next.players[0].hand.length).toBe(handBefore); // skipped, not drawn
    expect(g.turnIndex).toBe(0);                          // input unchanged (immutability)
  });

  it('absorbs a pending draw stack as the safe default', () => {
    const g = { ...createGame(seeds(3), DEFAULT_CONFIG, 'seed-pending'),
      pending: { total: 2, topValue: 2, source: 'colorDraw' as const } };
    const before = g.players[0].hand.length;
    const next = skipTurn(g);
    expect(next.players[0].hand.length).toBe(before + 2);
    expect(next.pending).toBeNull();
    expect(next.turnIndex).toBe(1);
  });
});

describe('forfeit', () => {
  it('moves the player to the audience and advances if it was their turn', () => {
    const g = createGame(seeds(3), DEFAULT_CONFIG, 'seed-forfeit');
    const next = forfeit(g, 'p0');
    expect(next.players[0].status).toBe('out');
    expect(next.turnIndex).toBe(1);
    expect(g.players[0].status).toBe('active');           // input unchanged
  });

  it('ends a 2-player game when one player forfeits', () => {
    const g = createGame(seeds(2), DEFAULT_CONFIG, 'seed-2p');
    const next = forfeit(g, 'p0');
    expect(next.phase).toBe('gameOver');
    expect(next.winnerId).toBe('p1');
  });

  it('keeps the current turn when a non-active-turn player forfeits', () => {
    const g = createGame(seeds(3), DEFAULT_CONFIG, 'seed-other');
    const next = forfeit(g, 'p2');
    expect(next.players[2].status).toBe('out');
    expect(next.turnIndex).toBe(0);
    expect(next.winnerId).toBeNull();
  });

  it('is a no-op for an already-out player', () => {
    const g = createGame(seeds(3), DEFAULT_CONFIG, 'seed-noop');
    const once = forfeit(g, 'p2');
    const twice = forfeit(once, 'p2');
    expect(twice.players[2].status).toBe('out');
    expect(twice.turnIndex).toBe(once.turnIndex);
  });
});

describe('seatPlayer', () => {
  it('appends a new active player and deals a starting hand', () => {
    const g = createGame(seeds(2), DEFAULT_CONFIG, 'seed-add');
    const next = seatPlayer(g, { id: 'newbie', name: 'New', isBot: false });
    expect(next.players).toHaveLength(3);
    const added = next.players.find((p) => p.id === 'newbie')!;
    expect(added.status).toBe('active');
    expect(added.hand.length).toBe(DEFAULT_CONFIG.startingHandSize);
    expect(next.turnIndex).toBe(g.turnIndex); // append keeps the current turn valid
  });

  it('reactivates an out player (reconnect)', () => {
    const g = createGame(seeds(3), DEFAULT_CONFIG, 'seed-react');
    const out = forfeit(g, 'p1');
    expect(out.players[1].status).toBe('out');
    const back = seatPlayer(out, { id: 'p1', name: 'P1', isBot: false });
    expect(back.players[1].status).toBe('active');
  });
});

describe('nextRoundWith', () => {
  it('seeds only the given players and carries scores by id', () => {
    const g = createGame(seeds(3), DEFAULT_CONFIG, 'seed-nr');
    g.players[0].score = 12; g.players[2].score = 7;
    const next = nextRoundWith(g, [
      { id: 'p0', name: 'P0', isBot: false },
      { id: 'p2', name: 'P2', isBot: false },
    ]);
    expect(next.players.map((p) => p.id)).toEqual(['p0', 'p2']); // p1 dropped (e.g. audience)
    expect(next.players.find((p) => p.id === 'p0')!.score).toBe(12);
    expect(next.players.find((p) => p.id === 'p2')!.score).toBe(7);
  });
});
