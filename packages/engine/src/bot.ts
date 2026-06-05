import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { getPlayableCards } from './rules';
import { type GameState, type PlayerState } from './state';
import type { Move } from './types';

const NON_WILD: Exclude<CardColor, 'black'>[] = ['red', 'green', 'blue', 'yellow'];
const TARGETED = new Set<Card['kind']>(['duel', 'eye', 'swap', 'steal', 'gift']);
const needsColor = (c: Card) => c.kind === 'wild' || c.kind === 'drawUntilColor' || c.kind === 'duel' || c.kind === 'bomb';

function bestColor(hand: Card[]): CardColor {
  const counts: Record<string, number> = { red: 0, green: 0, blue: 0, yellow: 0 };
  for (const c of hand) if (c.color !== 'black') counts[c.color]++;
  return NON_WILD.slice().sort((a, b) => counts[b] - counts[a])[0] ?? 'red';
}
function weakest(s: GameState, botId: string): PlayerState | undefined {
  return s.players.filter(p => p.id !== botId && p.status === 'active').sort((a, b) => a.hand.length - b.hand.length)[0];
}
const rank = (c: Card) => c.kind === 'number' ? 0 : isBlack(c) ? (c.kind === 'wild' ? 3 : 2) : 1;

export function botChooseMove(state: GameState, botId: string): Move {
  const me = state.players.find(p => p.id === botId)!;

  // Responding to a bomb: bounce it with counter/shield if held, else accept the 4.
  if (state.phase === 'bombResponse') {
    if (me.hand.some(c => c.kind === 'counter')) return { type: 'counter', playerId: botId };
    if (me.hand.some(c => c.kind === 'shield')) return { type: 'shield', playerId: botId };
    return { type: 'draw', playerId: botId };
  }

  // Facing a draw stack: stack a draw (smallest that qualifies), else shield/counter, else draw.
  if (state.pending) {
    const stackable = me.hand.filter(c => isDraw(c) && (c.value ?? 0) >= state.pending!.topValue)
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
    if (stackable) {
      const m: Extract<Move, { type: 'play' }> = { type: 'play', playerId: botId, cardIds: [stackable.id] };
      if (isBlack(stackable)) m.chosenColor = bestColor(me.hand);
      return m;
    }
    if (me.hand.some(c => c.kind === 'shield')) return { type: 'shield', playerId: botId };
    if (me.hand.some(c => c.kind === 'counter')) return { type: 'counter', playerId: botId };
    const div = me.hand.find(c => c.kind === 'div');
    if (div) return { type: 'play', playerId: botId, cardIds: [div.id] };
    return { type: 'draw', playerId: botId };
  }

  // Normal turn: pick the simplest legal single card. RD19: never go out on a black card
  // (incl. gift, which also sheds the gifted card -> would empty a 2-card hand).
  const playable = getPlayableCards(state, botId)
    .filter(c => !(me.hand.length === 1 && isBlack(c)) && !(c.kind === 'gift' && me.hand.length <= 2)
      && c.kind !== 'mult' && c.kind !== 'div');
  if (playable.length === 0) return { type: 'draw', playerId: botId };
  const card = [...playable].sort((a, b) => rank(a) - rank(b))[0];

  const m: Extract<Move, { type: 'play' }> = { type: 'play', playerId: botId, cardIds: [card.id] };
  if (needsColor(card)) m.chosenColor = bestColor(me.hand);
  if (TARGETED.has(card.kind)) m.targetId = weakest(state, botId)?.id;
  if (card.kind === 'gift') m.giftCardId = me.hand.find(c => c.id !== card.id)?.id;
  if (card.kind === 'minus') m.minusDiscard = true;
  return m;
}
