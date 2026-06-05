import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { topCard, type GameState } from './state';
import { classifySet } from './combos';
import type { Move, LegalityResult } from './types';

const TARGETED = new Set<Card['kind']>(['duel', 'eye', 'swap', 'steal', 'gift']);
/** Black cards that require the player to choose the active color (RD1). */
function needsColor(card: Card): boolean {
  return card.kind === 'wild' || card.kind === 'drawUntilColor' || card.kind === 'duel' || card.kind === 'bomb';
}

/** Pure matching (no pending logic). Pending rules are enforced in isMoveLegal. */
export function isPlayable(card: Card, top: Card, currentColor: CardColor, colorLocked: boolean): boolean {
  if (isBlack(card)) return true;                       // colorless plays on anything, bypasses lock
  if (colorLocked) return card.color === currentColor;
  if (card.color === currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number') return card.value === top.value;
  if (card.kind !== 'number') return card.kind === top.kind;
  return false;
}

export function getPlayableCards(state: GameState, playerId: string): Card[] {
  const p = state.players.find(x => x.id === playerId);
  if (!p) return [];
  const top = topCard(state);
  if (state.pending)
    return p.hand.filter(c => (isDraw(c) && (c.value ?? 0) >= state.pending!.topValue) || c.kind === 'div');
  return p.hand.filter(c => isPlayable(c, top, state.currentColor, state.colorLocked));
}

export function isMoveLegal(state: GameState, move: Move): LegalityResult {
  if (!['playing', 'duel', 'bombResponse'].includes(state.phase)) return { ok: false, reason: 'Game not in progress' };
  const turnId = state.phase === 'bombResponse' ? state.bombResponse!.pending[0]
    : state.phase === 'duel' ? state.duel!.activeId
    : state.players[state.turnIndex].id;
  if (move.playerId !== turnId) return { ok: false, reason: 'Not your turn' };
  const me = state.players.find(p => p.id === move.playerId);
  if (!me || me.status !== 'active') return { ok: false, reason: 'You are not in the game' };

  // Bomb response: each hit player may only accept (draw 4), shield, or counter.
  if (state.phase === 'bombResponse') {
    if (move.type === 'draw') return { ok: true };
    if (move.type === 'shield' || move.type === 'counter') {
      if (!me.hand.some(c => c.kind === move.type)) return { ok: false, reason: `You have no ${move.type} card` };
      if (me.hand.length === 1) return { ok: false, reason: 'Cannot use your last card as shield/counter (RD19) - you must accept' };
      return { ok: true };
    }
    return { ok: false, reason: 'Respond to the bomb: draw, shield, or counter' };
  }

  if (move.type === 'draw') return { ok: true };
  if (move.type === 'shield' || move.type === 'counter') {
    if (!state.pending) return { ok: false, reason: 'Nothing to shield/counter' };
    if (!me.hand.some(c => c.kind === move.type)) return { ok: false, reason: `You have no ${move.type} card` };
    if (me.hand.length === 1) return { ok: false, reason: 'Cannot play your last card as shield/counter (RD19)' };
    return { ok: true };
  }

  // play
  const cards = move.cardIds.map(id => me.hand.find(c => c.id === id)).filter(Boolean) as Card[];
  if (cards.length !== move.cardIds.length) return { ok: false, reason: 'Card not in hand' };
  const res = classifySet(cards);
  if (!res.ok) return res;
  const c = res.combo;
  const top = topCard(state);

  // RD19: cannot empty your hand on a black final card.
  if (me.hand.length === c.cards.length && isBlack(c.finalTop))
    return { ok: false, reason: 'You cannot finish on a black card' };

  if (state.pending) {
    if (c.isX2) return (c.draw!.value ?? 0) >= state.pending.topValue
      ? { ok: true } : { ok: false, reason: 'Draw value too low to stack' };
    if (c.kind === 'single' && isDraw(c.lead)) return (c.lead.value ?? 0) >= state.pending.topValue
      ? { ok: true } : { ok: false, reason: 'Draw value too low to stack' };
    if (c.kind === 'single' && c.lead.kind === 'div') return { ok: true };
    return { ok: false, reason: 'Only a draw, x2, or /2 may be played on a stack' };
  }

  if (c.isX2 || c.lead.kind === 'div' || c.lead.kind === 'mult')
    return { ok: false, reason: 'x2 and /2 only play on a draw stack' };
  if (c.lead.kind === 'shield' || c.lead.kind === 'counter')
    return { ok: false, reason: 'Use the shield/counter action' };
  if (!isPlayable(c.lead, top, state.currentColor, state.colorLocked))
    return { ok: false, reason: 'Card is not playable on the pile' };
  if (state.goAgain && !isBlack(c.lead) && c.lead.color !== state.currentColor && c.lead.kind !== 'playAgain')
    return { ok: false, reason: 'Must continue with the play-again color' };
  if (needsColor(c.lead) && !move.chosenColor) return { ok: false, reason: 'Choose a color' };
  if (TARGETED.has(c.lead.kind)) {
    const t = state.players.find(p => p.id === move.targetId);
    if (!t || t.status !== 'active' || t.id === me.id) return { ok: false, reason: 'Choose a valid opponent' };
  }
  if (c.lead.kind === 'gift') {
    if (!move.giftCardId || !me.hand.find(x => x.id === move.giftCardId)) return { ok: false, reason: 'Choose a card to gift' };
    // RD19: gift also sheds the gifted card; you cannot empty your hand finishing on a (black) gift.
    if (me.hand.length === c.cards.length + 1) return { ok: false, reason: 'Cannot finish on a gift' };
  }
  if (c.lead.kind === 'bomb' && top.kind !== 'number') return { ok: false, reason: 'Bomb plays only on a number' };
  if (c.lead.kind === 'recycle') {
    if (top.kind === 'recycle') return { ok: false, reason: 'Nothing to recycle' };
    if (top.kind === 'number' && state.discardPile.length === 1) return { ok: false, reason: 'Nothing to recycle (opening card)' }; // RD14
    if (needsColor(top) && !move.chosenColor) return { ok: false, reason: 'Choose a color for the recycled card' };
    if (TARGETED.has(top.kind)) {                          // recycling a targeted card needs the same target/gift inputs
      const t = state.players.find(p => p.id === move.targetId);
      if (!t || t.status !== 'active' || t.id === me.id) return { ok: false, reason: 'Choose a valid opponent for the recycled card' };
      if (top.kind === 'gift') {
        if (!move.giftCardId || !me.hand.find(x => x.id === move.giftCardId)) return { ok: false, reason: 'Choose a card to gift' };
        // RD19: recycle is black; a recycled gift also sheds the gifted card -> mustn't empty the hand.
        if (me.hand.length === c.cards.length + 1) return { ok: false, reason: 'Cannot finish on a recycled gift' };
      }
    }
    // RD19: a recycled minus that dumps every remaining card would empty the hand on a (black) recycle.
    if (top.kind === 'minus' && move.minusDiscard) {
      const after = me.hand.filter(x => !move.cardIds.includes(x.id)); // hand after the recycle leaves
      if (after.length > 0 && after.every(x => x.color === top.color))
        return { ok: false, reason: 'Cannot empty your hand on a recycled minus' };
    }
  }
  return { ok: true };
}
