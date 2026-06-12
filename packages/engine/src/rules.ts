import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { topCard, recycleTarget, type GameState, type PendingDraw } from './state';
import { classifySet } from './combos';
import type { Move, LegalityResult } from './types';

const TARGETED = new Set<Card['kind']>(['duel', 'eye', 'swap', 'steal', 'gift']);
/** Black cards that require the player to choose the active color (RD1). */
function needsColor(card: Card): boolean {
  return card.kind === 'wild' || card.kind === 'drawUntilColor' || card.kind === 'duel' || card.kind === 'bomb'
    || (card.kind === 'draw' && isBlack(card));
}

export function canStackDraw(pending: PendingDraw, card: Card): boolean {
  return isDraw(card)
    && (card.value ?? 0) >= pending.topValue
    && (pending.source !== 'blackDraw' || isBlack(card));
}

function stackDrawReason(pending: PendingDraw, card: Card): string {
  if ((card.value ?? 0) < pending.topValue) return 'Draw value too low to stack';
  if (pending.source === 'blackDraw' && !isBlack(card)) return 'Only black draw cards can stack on a black draw';
  return 'Draw card cannot stack';
}

/** Pure matching (no pending logic). Pending rules are enforced in isMoveLegal. */
export function isPlayable(card: Card, top: Card, currentColor: CardColor, colorLocked: boolean): boolean {
  // Stack-response-only cards are never a normal lead play: shield/counter are played via their
  // dedicated moves, and x2//2 only act on a pending draw stack (all enforced in isMoveLegal /
  // surfaced by the pending branches of the client + getPlayableCards).
  if (card.kind === 'shield' || card.kind === 'counter' || card.kind === 'mult' || card.kind === 'div') return false;
  if (card.kind === 'bomb') return top.kind === 'number'; // RD12: bomb plays only onto a number top
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
  if (state.drawnPlayable && state.drawnPlayable.playerId === playerId) {
    const c = p.hand.find(x => x.id === state.drawnPlayable!.cardId);
    return c && isPlayable(c, top, state.currentColor, state.colorLocked) ? [c] : [];
  }
  if (state.pendingUntil)
    return p.hand.filter(c => c.kind === 'drawUntilColor' || c.kind === 'recycle');
  if (state.pending)
    return p.hand.filter(c => canStackDraw(state.pending!, c) || c.kind === 'div' || c.kind === 'mult');
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

  // After drawing a playable card this turn, the only options are to play THAT card or draw again to keep it.
  if (state.drawnPlayable && state.drawnPlayable.playerId === me.id && move.type !== 'draw'
      && !(move.type === 'play' && move.cardIds.length === 1 && move.cardIds[0] === state.drawnPlayable.cardId))
    return { ok: false, reason: 'You may only play the card you just drew, or draw to keep it' };

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
    if (c.isX2) {
      if (!canStackDraw(state.pending, c.draw!)) return { ok: false, reason: stackDrawReason(state.pending, c.draw!) };
      return needsColor(c.draw!) && !move.chosenColor ? { ok: false, reason: 'Choose a color' } : { ok: true };
    }
    if (c.kind === 'single' && c.lead.kind === 'mult') return { ok: true }; // x2 alone: doubles the current stack top
    if (c.kind === 'single' && isDraw(c.lead)) {
      if (!canStackDraw(state.pending, c.lead)) return { ok: false, reason: stackDrawReason(state.pending, c.lead) };
      return needsColor(c.lead) && !move.chosenColor ? { ok: false, reason: 'Choose a color' } : { ok: true };
    }
    if (c.kind === 'single' && c.lead.kind === 'div') return { ok: true };
    return { ok: false, reason: 'Only a draw, x2, or /2 may be played on a stack' };
  }

  // A draw-until-color threat may only be bounced with a draw-until-color or a recycle
  // (which copies the threat on top). Anything else must draw to accept it. The color and
  // recycle-input checks below still apply to the two allowed plays.
  if (state.pendingUntil && c.lead.kind !== 'drawUntilColor' && c.lead.kind !== 'recycle')
    return { ok: false, reason: 'Respond with draw-until-color, recycle, or draw' };

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
  if (c.lead.kind === 'minus' && move.minusDiscardIds?.length) {
    for (const id of move.minusDiscardIds) {
      if (move.cardIds.includes(id)) return { ok: false, reason: 'Invalid card to discard' };
      const card = me.hand.find(x => x.id === id);
      if (!card) return { ok: false, reason: 'Card not in hand' };
      if (card.color !== c.lead.color) return { ok: false, reason: 'Can only discard cards of the minus color' };
    }
  }
  if (c.lead.kind === 'bomb' && top.kind !== 'number') return { ok: false, reason: 'Bomb plays only on a number' };
  if (c.lead.kind === 'recycle') {
    // See through stacked recycles to the real card the play would copy (RD14): a recycle on a
    // recycle copies what that recycle pointed at, so it can do nothing a direct recycle couldn't.
    const tgt = recycleTarget(state.discardPile);
    if (!tgt) return { ok: false, reason: 'Nothing to recycle' };
    const copied = tgt.card;
    if (tgt.index === 0 && copied.kind === 'number' && state.discardPile.length === 1)
      return { ok: false, reason: 'Nothing to recycle (opening card)' }; // RD14
    if (needsColor(copied) && !move.chosenColor) return { ok: false, reason: 'Choose a color for the recycled card' };
    if (TARGETED.has(copied.kind)) {                       // recycling a targeted card needs the same target/gift inputs
      const t = state.players.find(p => p.id === move.targetId);
      if (!t || t.status !== 'active' || t.id === me.id) return { ok: false, reason: 'Choose a valid opponent for the recycled card' };
      if (copied.kind === 'gift') {
        if (!move.giftCardId || !me.hand.find(x => x.id === move.giftCardId)) return { ok: false, reason: 'Choose a card to gift' };
        // RD19: recycle is black; a recycled gift also sheds the gifted card -> mustn't empty the hand.
        if (me.hand.length === c.cards.length + 1) return { ok: false, reason: 'Cannot finish on a recycled gift' };
      }
    }
    // A recycled minus only dumps cards of the copied minus's color; RD19: recycle is black, so the
    // play (recycle + chosen dumps) must not empty your hand.
    if (copied.kind === 'minus' && move.minusDiscardIds?.length) {
      for (const id of move.minusDiscardIds) {
        if (move.cardIds.includes(id)) return { ok: false, reason: 'Invalid card to discard' };
        const card = me.hand.find(x => x.id === id);
        if (!card) return { ok: false, reason: 'Card not in hand' };
        if (card.color !== copied.color) return { ok: false, reason: 'Can only discard cards of the minus color' };
      }
      const after = me.hand.filter(x => !move.cardIds.includes(x.id) && !move.minusDiscardIds!.includes(x.id));
      if (after.length === 0) return { ok: false, reason: 'Cannot empty your hand on a recycled minus' };
    }
  }
  return { ok: true };
}
