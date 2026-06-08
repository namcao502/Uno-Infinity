import { describe, it, expect } from 'vitest';
import { botChooseMove } from './bot';
import { isMoveLegal } from './rules';
import { DEFAULT_CONFIG } from './config';
import type { GameState, PlayerState, PendingDraw } from './state';
import type { Card } from './cards';

const C = (over: Partial<Card>): Card => ({ id: 'x', color: 'red', kind: 'number', value: 1, ...over });
function mk(over: Partial<GameState>, hand: Card[]): GameState {
  const players: PlayerState[] = [
    { id: 'b1', name: 'Bot', isBot: true, connected: true, status: 'active', hand },
    { id: 'p2', name: 'Human', isBot: false, connected: true, status: 'active', hand: [C({ id: 'h', value: 1 }), C({ id: 'h2', value: 2 })] },
  ];
  return {
    phase: 'playing', config: DEFAULT_CONFIG, players,
    drawPile: [C({ id: 'd', color: 'blue', value: 1 })],
    discardPile: [C({ id: 'top', color: 'red', value: 5 })],
    currentColor: 'red', colorLocked: false, turnIndex: 0, direction: 1,
    pending: null, duel: null, bombResponse: null, goAgain: false, drawnPlayable: null, winnerId: null, seed: 's', log: [], chainId: 0, eventSeq: 0, ...over,
  };
}

describe('botChooseMove', () => {
  it('plays a legal card when one exists', () => {
    const s = mk({}, [C({ id: 'a', color: 'red', value: 9 }), C({ id: 'k', value: 3 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type).toBe('play');
    expect(isMoveLegal(s, m).ok).toBe(true);
  });
  it('draws when nothing is playable', () => {
    const s = mk({}, [C({ id: 'a', color: 'blue', value: 9 })]);
    expect(botChooseMove(s, 'b1').type).toBe('draw');
  });
  it('supplies a color for a wild', () => {
    // spare is unplayable (blue on a red top) so the wild is the bot's only playable card.
    const s = mk({}, [C({ id: 'a', color: 'black', kind: 'wild', value: null }), C({ id: 'k', color: 'blue', value: 9 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type === 'play' && m.chosenColor).toBeTruthy();
  });
  it('supplies a target for a targeted card', () => {
    // spare card is unplayable (blue on a red top) so the swap is the bot's only playable card.
    const s = mk({}, [C({ id: 'a', color: 'black', kind: 'swap', value: null }), C({ id: 'k', color: 'blue', value: 9 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type === 'play' && m.targetId).toBe('p2');
  });
  it('stacks a big-enough draw against a pending stack, else draws', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const withDraw = mk({ pending }, [C({ id: 'd6', color: 'black', kind: 'draw', value: 6 })]);
    const m = botChooseMove(withDraw, 'b1');
    expect(m.type === 'play' && m.cardIds).toEqual(['d6']);
    expect(m.type === 'play' && m.chosenColor).toBeTruthy();
    const noDraw = mk({ pending }, [C({ id: 'n', color: 'green', value: 9 })]);
    expect(botChooseMove(noDraw, 'b1').type).toBe('draw');
  });
  it('does not stack a colored draw onto a black draw', () => {
    const pending: PendingDraw = { total: 4, topValue: 4, source: 'blackDraw' };
    const s = mk({ pending }, [C({ id: 'color4', color: 'red', kind: 'draw', value: 4 })]);
    expect(botChooseMove(s, 'b1').type).toBe('draw');
  });
  it('plays x2 alone against a stack when no draw qualifies (RD4)', () => {
    const pending: PendingDraw = { total: 6, topValue: 6, source: 'blackDraw' };
    // no draw >= 6, but holds a mult plus a spare so x2 is not the last card (RD19)
    const s = mk({ pending }, [C({ id: 'm', color: 'black', kind: 'mult', value: 2 }), C({ id: 'k', value: 3 })]);
    const m = botChooseMove(s, 'b1');
    expect(m.type === 'play' && m.cardIds).toEqual(['m']);
    expect(isMoveLegal(s, m).ok).toBe(true);
  });
  it('will not play x2 as its last card against a stack (RD19) - draws instead', () => {
    const pending: PendingDraw = { total: 6, topValue: 6, source: 'blackDraw' };
    const s = mk({ pending }, [C({ id: 'm', color: 'black', kind: 'mult', value: 2 })]); // mult only
    expect(botChooseMove(s, 'b1').type).toBe('draw');
  });
  it('plays the card it just drew when it is playable', () => {
    const s = mk({ drawnPlayable: { playerId: 'b1', cardId: 'dx' } },
      [C({ id: 'dx', color: 'red', value: 8 }), C({ id: 'k', color: 'blue', value: 2 })]); // top is red 5
    const m = botChooseMove(s, 'b1');
    expect(m.type === 'play' && m.cardIds).toEqual(['dx']);
  });
});
