import { isBlack, isDraw, type Card, type CardColor } from './cards';
import { topCard, nextActiveIndex, activePlayers, MAX_HAND, type GameState, type PlayerState, type PlayerSeed } from './state';
import { classifySet, type Combo } from './combos';
import { createRng, shuffle } from './rng';
import type { Move } from './types';

export const clone = (s: GameState): GameState => ({
  ...s,
  players: s.players.map(p => ({ ...p, hand: [...p.hand] })),
  drawPile: [...s.drawPile], discardPile: [...s.discardPile],
  pending: s.pending ? { ...s.pending } : null,
  duel: s.duel ? { ...s.duel } : null,
  bombResponse: s.bombResponse ? { ...s.bombResponse, pending: [...s.bombResponse.pending] } : null,
});

/** Advance to the next ACTIVE seat (skips eliminated players); clears per-turn flags.
 *  Duel-aware: inside a duel it toggles between the two duelists instead. */
export function advance(s: GameState, steps = 1): void {
  if (s.phase === 'duel' && s.duel) {                       // in a duel, toggle between the two duelists
    s.duel.activeId = s.duel.activeId === s.duel.challengerId ? s.duel.opponentId : s.duel.challengerId;
    s.goAgain = false; return;
  }
  s.turnIndex = nextActiveIndex(s, s.turnIndex, steps);
  s.goAgain = false;
}

function reshuffle(s: GameState): void {
  if (s.discardPile.length <= 1) return;
  const top = s.discardPile.pop()!;
  s.drawPile = shuffle(s.discardPile, createRng(s.seed + ':' + s.discardPile.length));
  s.discardPile = [top];
}

/** Single elimination chokepoint (RD20): call after ANY hand growth (draws, gift, steal, drawUntilColor). */
export function eliminateIfOverloaded(s: GameState, p: PlayerState): void {
  if (p.hand.length > MAX_HAND && p.status === 'active') {
    p.status = 'out';
    s.log = `${p.name} overloaded (${p.hand.length}) and is out`;
  }
}

export function drawCards(s: GameState, p: PlayerState, count: number): void {
  for (let i = 0; i < count; i++) {
    if (s.drawPile.length === 0) reshuffle(s);
    if (s.drawPile.length === 0) break;
    p.hand.push(s.drawPile.pop()!);
  }
  eliminateIfOverloaded(s, p);
}

/** Win checks: any active player emptied, or only one active player remains (RD18, RD20). */
function checkEnd(s: GameState): GameState {
  const emptied = s.players.find(p => p.status === 'active' && p.hand.length === 0);
  if (emptied) { s.winnerId = emptied.id; s.phase = 'gameOver'; s.log = `${emptied.name} wins!`; return s; }
  const act = activePlayers(s);
  if (act.length === 1) { s.winnerId = act[0].id; s.phase = 'gameOver'; s.log = `${act[0].name} is the last player standing!`; }
  return s;
}

export function applyMove(state: GameState, move: Move): GameState {
  const s = clone(state);
  if (s.phase === 'bombResponse') return resolveBombResponse(s, move); // each hit player responds in turn
  switch (move.type) {
    case 'draw': return resolveDraw(s);
    case 'shield': return resolveShield(s);
    case 'counter': return resolveCounter(s);
    case 'play': return applyPlay(s, move);
  }
}

/** The player whose turn it is, accounting for the duel sub-phase. */
const acting = (s: GameState): PlayerState =>
  s.phase === 'duel' && s.duel ? s.players.find(p => p.id === s.duel!.activeId)! : s.players[s.turnIndex];

function resolveDraw(s: GameState): GameState {
  const p = acting(s);
  if (s.pending) {
    drawCards(s, p, s.pending.total);
    s.log = `${p.name} drew ${s.pending.total}`;
    s.pending = null; s.colorLocked = false;
    if (s.phase === 'duel') return endDuel(s);   // drawing ends a duel
    advance(s, 1);
  } else {
    drawCards(s, p, 1);
    s.log = `${p.name} drew a card`;
    advance(s, 1);
  }
  return checkEnd(s);
}

function discardKind(s: GameState, p: PlayerState, kind: 'shield' | 'counter'): void {
  const i = p.hand.findIndex(c => c.kind === kind);
  if (i >= 0) s.discardPile.push(p.hand.splice(i, 1)[0]);
}
function resolveShield(s: GameState): GameState {           // push pending to next player
  const p = acting(s); discardKind(s, p, 'shield');        // legality forbids this being the last card (RD19)
  s.log = `${p.name} shielded`;
  advance(s, 1);                                            // pending preserved, passes to next
  return checkEnd(s);
}
function resolveCounter(s: GameState): GameState {          // bounce pending to previous player
  const p = acting(s); discardKind(s, p, 'counter');
  s.log = `${p.name} countered`;
  const dir = s.direction; s.direction = (-dir) as 1 | -1;
  advance(s, 1); s.direction = dir;                         // step backward one active seat (toggles in duel)
  return checkEnd(s);
}

function applyPlay(s: GameState, move: Extract<Move, { type: 'play' }>): GameState {
  const actor = s.players.find(p => p.id === move.playerId)!;
  const cards = move.cardIds.map(id => actor.hand.find(c => c.id === id)!);
  const combo = (classifySet(cards) as { ok: true; combo: Combo }).combo; // legality already validated
  actor.hand = actor.hand.filter(c => !move.cardIds.includes(c.id));
  for (const c of combo.cards) s.discardPile.push(c);
  s.log = `${actor.name} played ${combo.kind === 'single' ? combo.lead.kind : combo.kind}`;

  // --- Stack responses (pending exists): draw-extend, x2, div ---
  if (s.pending) {
    if (combo.isX2) {
      s.pending.total += (combo.draw!.value ?? 0) * 2;     // RD4: double the attached draw
      s.pending.topValue = combo.draw!.value ?? 0;
      advance(s, 1);
    } else if (combo.lead.kind === 'div') {                // RD5: halve, then this player draws
      s.pending.total = Math.floor(s.pending.total / 2);
      drawCards(s, actor, s.pending.total);
      s.pending = null; s.colorLocked = false;
      if (s.phase === 'duel') return endDuel(s);            // RD11: /2 resolves the stack -> duel ends
      advance(s, 1);
    } else {                                               // single draw extends the stack
      s.pending.total += combo.lead.value ?? 0;
      s.pending.topValue = combo.lead.value ?? 0;
      advance(s, 1);                                        // duel-aware advance toggles the duelist
    }
    return checkEnd(s);
  }

  // --- Normal play (no pending) ---
  s.currentColor = isBlack(combo.lead)
    ? (move.chosenColor ?? s.currentColor)               // black sets color (RD1)
    : combo.finalTop.color;
  s.colorLocked = combo.locksColor;

  // Draw card with no pending: open a new stack.
  if (isDraw(combo.lead)) {
    s.pending = { total: combo.lead.value ?? 0, topValue: combo.lead.value ?? 0,
      source: isBlack(combo.lead) ? 'blackDraw' : 'colorDraw' };
    advance(s, 1);
    return checkEnd(s);
  }

  // Special effects (skip/playAgain/minus/reverseDraw/recycle/duel/bomb/targeted/drawUntilColor/wild).
  applyEffect(s, combo, move);
  return checkEnd(s);
}

function endDuel(s: GameState): GameState {
  const challengerIdx = s.players.findIndex(p => p.id === s.duel!.challengerId);
  s.phase = 'playing'; s.duel = null; s.pending = null; s.colorLocked = false;
  s.turnIndex = challengerIdx;
  advance(s, 1);                                            // pass to the player after the challenger
  return checkEnd(s);
}

/** RD12: each hit player responds in seat order; shield/counter bounces 4 to the bomber. */
function resolveBombResponse(s: GameState, move: Move): GameState {
  const br = s.bombResponse!;
  const responder = s.players.find(p => p.id === br.pending[0])!;
  if (move.type === 'shield' || move.type === 'counter') {
    discardKind(s, responder, move.type);                  // consume the held card
    br.bomberDraw += 4;                                     // 4 per responder who bounces
    s.log = `${responder.name} ${move.type === 'shield' ? 'shielded' : 'countered'} the bomb`;
  } else {                                                  // any other move (draw) = accept
    drawCards(s, responder, 4);
    s.log = `${responder.name} took 4 from the bomb`;
  }
  br.pending.shift();
  return br.pending.length > 0 ? s : finishBomb(s);
}

function finishBomb(s: GameState): GameState {
  const br = s.bombResponse!;
  const bomber = s.players.find(p => p.id === br.bomberId)!;
  if (br.bomberDraw > 0) drawCards(s, bomber, br.bomberDraw);
  s.currentColor = br.endColor;
  s.phase = 'playing'; s.bombResponse = null;
  s.turnIndex = s.players.findIndex(p => p.id === br.bomberId);
  advance(s, 1);
  return checkEnd(s);
}

function applyEffect(s: GameState, combo: Combo, move: Extract<Move, { type: 'play' }>): void {
  const actor = s.players.find(p => p.id === move.playerId)!;
  const lead = combo.lead;
  switch (lead.kind) {
    case 'skip': advance(s, 2); break;
    case 'playAgain': s.goAgain = true; break;               // same player continues (no advance)
    case 'minus':
      if (move.minusDiscard) actor.hand = actor.hand.filter(c => c.color !== lead.color);
      advance(s, 1); break;
    case 'reverseDraw': {                                    // RD13: flip + previous player draws
      s.direction = (-s.direction) as 1 | -1;
      const victim = s.players[nextActiveIndex(s, s.turnIndex, 1)];
      drawCards(s, victim, lead.value ?? 0);
      advance(s, 2); break;                                  // skip the victim
    }
    case 'duel':                                             // RD11: enter 1v1; color chosen upfront
      s.phase = 'duel';
      s.pending = { total: 4, topValue: 4, source: 'blackDraw' };
      s.duel = { challengerId: actor.id, opponentId: move.targetId!, activeId: move.targetId! };
      s.currentColor = move.chosenColor ?? s.currentColor;
      break;                                                 // no advance; duel takes over
    case 'bomb': {                                           // RD12: open the sequential response phase
      const order: string[] = [];
      let i = s.players.findIndex(p => p.id === actor.id);
      for (let k = 0; k < s.players.length; k++) {
        i = nextActiveIndex(s, i, 1);
        if (s.players[i].id === actor.id) break;            // looped back to the bomber
        order.push(s.players[i].id);
      }
      const endColor = move.chosenColor ?? s.currentColor;
      if (order.length === 0) { s.currentColor = endColor; advance(s, 1); break; } // no one to hit
      s.phase = 'bombResponse';
      s.bombResponse = { bomberId: actor.id, pending: order, bomberDraw: 0, endColor };
      break;                                                 // no advance; the response phase takes over
    }
    case 'drawUntilColor': {                                 // RD17
      const victim = s.players[nextActiveIndex(s, s.turnIndex, 1)];
      for (let i = 0; i < 200; i++) {
        if (s.drawPile.length === 0) reshuffle(s);
        if (s.drawPile.length === 0) break;
        const c = s.drawPile.pop()!; victim.hand.push(c);
        if (c.color === move.chosenColor) break;
      }
      eliminateIfOverloaded(s, victim);
      s.currentColor = move.chosenColor ?? s.currentColor;
      advance(s, 2); break;                                  // victim skipped
    }
    case 'swap': {
      const t = s.players.find(p => p.id === move.targetId)!;
      [actor.hand, t.hand] = [t.hand, actor.hand];
      advance(s, 1); break;
    }
    case 'steal': {
      const t = s.players.find(p => p.id === move.targetId)!;
      if (t.hand.length) {
        const j = Math.floor(createRng(s.seed + ':' + s.discardPile.length)() * t.hand.length);
        actor.hand.push(t.hand.splice(j, 1)[0]);
        eliminateIfOverloaded(s, actor);
      }
      advance(s, 1); break;
    }
    case 'gift': {
      const t = s.players.find(p => p.id === move.targetId)!;
      const gi = actor.hand.findIndex(c => c.id === move.giftCardId);
      if (gi >= 0) { t.hand.push(actor.hand.splice(gi, 1)[0]); eliminateIfOverloaded(s, t); }
      advance(s, 1); break;
    }
    case 'eye': advance(s, 1); break;                        // reveal is delivered server-side (Task 12)
    case 'wild': advance(s, 1); break;                       // color already set in applyPlay
    case 'recycle': applyRecycle(s, move); break;
    default: advance(s, 1);                                  // number / pair / run / pairsRun
  }
}

/** Copy the effect of the card beneath the recycle just played (RD14). By design this
 *  re-applies the effect directly and skips the copied card's normal play preconditions
 *  (e.g. a recycled bomb does not require a number on top); legality already validated the
 *  recycle's own inputs (targetId/giftCardId/color) in isMoveLegal. */
function applyRecycle(s: GameState, move: Extract<Move, { type: 'play' }>): void {
  const copied = s.discardPile[s.discardPile.length - 2];
  if (isDraw(copied)) {
    s.pending = { total: copied.value ?? 0, topValue: copied.value ?? 0, source: isBlack(copied) ? 'blackDraw' : 'colorDraw' };
    s.currentColor = isBlack(copied) ? (move.chosenColor ?? s.currentColor) : copied.color;
    advance(s, 1); return;
  }
  if (!isBlack(copied)) s.currentColor = copied.color;
  else if (move.chosenColor) s.currentColor = move.chosenColor;
  const synthetic: Combo = { kind: 'single', cards: [copied], lead: copied, finalTop: copied, locksColor: false, isX2: false };
  applyEffect(s, synthetic, move);
}

/**
 * Advance past the player on turn WITHOUT a normal draw (disconnect "pass").
 * Forced situations still auto-resolve with the safe default so the state stays
 * valid: a pending draw stack is absorbed, a bomb response is accepted, and a
 * duel is exited. A plain turn is simply skipped with no penalty.
 */
export function skipTurn(state: GameState): GameState {
  const s = clone(state);
  if (s.phase === 'bombResponse' && s.bombResponse)
    return resolveBombResponse(s, { type: 'draw', playerId: s.bombResponse.pending[0] });
  if (s.pending) return resolveDraw(s);              // absorb the forced stack (ends a duel if mid-duel)
  if (s.phase === 'duel') return endDuel(s);         // no stack: just exit the duel
  const skipped = s.players[s.turnIndex];
  advance(s, 1);
  s.log = `${skipped.name} was skipped`;
  return checkEnd(s);
}

/**
 * Remove a player from active play (disconnect timeout): they become audience
 * (status 'out'). If they were mid-action, the turn / duel / bomb resolves
 * around their departure. No-op if they are not currently an active player.
 */
export function forfeit(state: GameState, playerId: string): GameState {
  const s = clone(state);
  const p = s.players.find(x => x.id === playerId);
  if (!p || p.status !== 'active') return s;
  p.status = 'out';
  s.log = `${p.name} left the game`;

  if (s.phase === 'bombResponse' && s.bombResponse) {
    s.bombResponse.pending = s.bombResponse.pending.filter(id => id !== playerId);
    return s.bombResponse.pending.length > 0 ? checkEnd(s) : finishBomb(s);
  }
  if (s.phase === 'duel' && s.duel && (s.duel.challengerId === playerId || s.duel.opponentId === playerId))
    return endDuel(s);                                // a duelist left -> back to normal play
  if (s.players[s.turnIndex]?.id === playerId) {      // it was their normal turn
    s.pending = null; s.colorLocked = false;          // any stack aimed at them dissipates
    advance(s, 1);
  }
  return checkEnd(s);
}

/**
 * Add a player to a live game, or reactivate an out player (reconnect). New
 * players are APPENDED so existing turnIndex stays valid, and are dealt a
 * starting hand. A reactivated player keeps their hand (topped up if empty).
 * Active existing players are a no-op.
 */
export function seatPlayer(state: GameState, seed: PlayerSeed): GameState {
  const s = clone(state);
  const existing = s.players.find(p => p.id === seed.id);
  if (existing) {
    if (existing.status === 'out') {
      existing.status = 'active';
      if (existing.hand.length === 0) drawCards(s, existing, s.config.startingHandSize);
      s.log = `${existing.name} rejoined`;
    }
    return s;
  }
  const p: PlayerState = { id: seed.id, name: seed.name, isBot: seed.isBot, connected: true, status: 'active', hand: [], score: 0 };
  s.players.push(p);
  drawCards(s, p, s.config.startingHandSize);
  s.log = `${seed.name} joined the game`;
  return s;
}

export { checkEnd, reshuffle };
