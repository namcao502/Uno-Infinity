import { isBlack, isDraw, cardName, type Card, type CardColor } from './cards';
import { topCard, nextActiveIndex, activePlayers, recycleTarget, MAX_HAND, type GameState, type PlayerState, type PlayerSeed, type LogEntry, type PendingDraw } from './state';
import { isPlayable } from './rules';
import { classifySet, type Combo } from './combos';
import { createRng, shuffle } from './rng';
import type { Move } from './types';

export const clone = (s: GameState): GameState => ({
  ...s,
  players: s.players.map(p => ({ ...p, hand: [...p.hand] })),
  drawPile: [...s.drawPile], discardPile: [...s.discardPile],
  pending: s.pending ? { ...s.pending } : null,
  pendingUntil: s.pendingUntil ? { ...s.pendingUntil } : null,
  drawnPlayable: s.drawnPlayable ? { ...s.drawnPlayable } : null,
  duel: s.duel ? { ...s.duel } : null,
  bombResponse: s.bombResponse ? { ...s.bombResponse, pending: [...s.bombResponse.pending] } : null,
  log: [...s.log],
});

/** Keep the game history bounded so the serialized state stays small. Granular per-effect logging
 *  emits several lines per action, so the cap is generous (detail lines carry no card payload). */
const LOG_MAX = 120;

const drawSource = (c: Card): PendingDraw['source'] => isBlack(c) ? 'blackDraw' : 'colorDraw';
const drawActiveColor = (c: Card, move: Extract<Move, { type: 'play' }>): Card['color'] =>
  isBlack(c) ? (move.chosenColor ?? 'red') : c.color;

/** Append a history entry (auto-assigns seq) and drop the oldest past the cap. */
function pushLog(s: GameState, e: Omit<LogEntry, 'seq'>): void {
  s.log.push({ seq: s.eventSeq++, ...e });
  if (s.log.length > LOG_MAX) s.log.shift();
}

/** Push an indented consequence sub-line (rendered under the main action, without actor/glyphs). */
function logDetail(s: GameState, actor: PlayerState, text: string, opts?: { chosenColor?: CardColor; stackId?: number }): void {
  pushLog(s, { actorId: actor.id, actorName: actor.name, kind: 'system', text, detail: true, ...opts });
}

const seatName = (s: GameState, id: string | undefined): string => s.players.find(p => p.id === id)?.name ?? '?';

/** Main play-line text and any color the play chose (for a color chip). */
function describePlay(combo: Combo, move: Extract<Move, { type: 'play' }>): { text: string; chosenColor?: CardColor } {
  const lead = combo.lead;
  const choosesColor = lead.kind === 'wild' || lead.kind === 'drawUntilColor' || lead.kind === 'duel'
    || lead.kind === 'bomb' || (lead.kind === 'draw' && isBlack(lead));
  const chosenColor = choosesColor ? move.chosenColor : undefined;
  if (combo.kind === 'pair') return { text: `played a pair of ${lead.value}s` };
  if (combo.kind === 'run') return { text: `played a run ${combo.cards[0].value}-${combo.cards[combo.cards.length - 1].value}` };
  if (combo.kind === 'pairsRun') return { text: `played ${combo.cards.length / 2} consecutive pairs` };
  if (combo.kind === 'x2') return { text: `played ${cardName(combo.draw!)} with x2`, chosenColor };
  return { text: `played ${cardName(lead)}`, chosenColor };
}

/** Advance to the next ACTIVE seat (skips eliminated players); clears per-turn flags.
 *  Duel-aware: inside a duel it toggles between the two duelists instead. */
export function advance(s: GameState, steps = 1): void {
  s.drawnPlayable = null;                                   // any turn change ends a post-draw decision
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
    pushLog(s, { actorId: p.id, actorName: p.name, kind: 'eliminate', text: `overloaded (${p.hand.length}) and is out` });
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
  if (emptied) {
    s.winnerId = emptied.id; s.phase = 'gameOver';
    pushLog(s, { actorId: emptied.id, actorName: emptied.name, kind: 'win', text: 'wins!' });
    return s;
  }
  const act = activePlayers(s);
  if (act.length === 1) {
    s.winnerId = act[0].id; s.phase = 'gameOver';
    pushLog(s, { actorId: act[0].id, actorName: act[0].name, kind: 'win', text: 'is the last player standing!' });
  }
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

/** Accept a draw-until-color threat: the player on turn draws until the color, then is skipped. */
function resolveDrawUntil(s: GameState): GameState {
  const p = acting(s);
  const color = s.pendingUntil!.color;
  let n = 0;
  for (let i = 0; i < 200; i++) {
    if (s.drawPile.length === 0) reshuffle(s);
    if (s.drawPile.length === 0) break;
    const c = s.drawPile.pop()!; p.hand.push(c); n++;
    if (c.color === color) break;
  }
  eliminateIfOverloaded(s, p);
  pushLog(s, { actorId: p.id, actorName: p.name, kind: 'draw', text: `drew ${n} until ${color}`, drawCount: n });
  s.pendingUntil = null;
  s.currentColor = color;
  advance(s, 1);                                             // turn consumed: the victim is skipped
  return checkEnd(s);
}

function resolveDraw(s: GameState): GameState {
  const p = acting(s);
  if (s.pendingUntil) return resolveDrawUntil(s);            // a plain draw = accept the threat
  if (s.pending) {
    const total = s.pending.total;
    drawCards(s, p, total);
    pushLog(s, { actorId: p.id, actorName: p.name, kind: 'draw', text: `drew ${total}`, drawCount: total, stackId: s.chainId });
    s.pending = null; s.colorLocked = false;
    if (s.phase === 'duel') return endDuel(s);   // drawing ends a duel
    advance(s, 1);
  } else if (s.drawnPlayable && s.drawnPlayable.playerId === p.id) {
    // Second draw this turn = keep the card just drawn and pass (no new card).
    pushLog(s, { actorId: p.id, actorName: p.name, kind: 'draw', text: 'kept the drawn card' });
    advance(s, 1);
  } else {
    const before = p.hand.length;
    drawCards(s, p, 1);
    const drawn = p.hand.length > before ? p.hand[p.hand.length - 1] : undefined;
    pushLog(s, { actorId: p.id, actorName: p.name, kind: 'draw', text: 'drew a card', drawCount: 1 });
    // If the drawn card is playable, keep the turn open so the player may play it (or draw again to keep it).
    if (drawn && p.status === 'active' && isPlayable(drawn, topCard(s), s.currentColor, s.colorLocked))
      s.drawnPlayable = { playerId: p.id, cardId: drawn.id };
    else
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
  pushLog(s, { actorId: p.id, actorName: p.name, kind: 'shield', text: 'shielded', stackId: s.pending ? s.chainId : undefined });
  logDetail(s, p, 'passed the stack to the next player', { stackId: s.pending ? s.chainId : undefined });
  advance(s, 1);                                            // pending preserved, passes to next
  return checkEnd(s);
}
function resolveCounter(s: GameState): GameState {          // bounce pending to previous player
  const p = acting(s); discardKind(s, p, 'counter');
  pushLog(s, { actorId: p.id, actorName: p.name, kind: 'counter', text: 'countered', stackId: s.pending ? s.chainId : undefined });
  logDetail(s, p, 'bounced the stack to the previous player', { stackId: s.pending ? s.chainId : undefined });
  const dir = s.direction; s.direction = (-dir) as 1 | -1;
  advance(s, 1); s.direction = dir;                         // step backward one active seat (toggles in duel)
  return checkEnd(s);
}

function applyPlay(s: GameState, move: Extract<Move, { type: 'play' }>): GameState {
  s.drawnPlayable = null;                                  // committing a play ends any post-draw decision
  const actor = s.players.find(p => p.id === move.playerId)!;
  const cards = move.cardIds.map(id => actor.hand.find(c => c.id === id)!);
  const combo = (classifySet(cards) as { ok: true; combo: Combo }).combo; // legality already validated
  actor.hand = actor.hand.filter(c => !move.cardIds.includes(c.id));
  for (const c of combo.cards) s.discardPile.push(c);
  const stacking = s.pending != null;                      // responding to an existing draw stack
  const opensStack = s.pending == null && isDraw(combo.lead);
  if (opensStack) s.chainId++;                             // a fresh draw chain begins
  const desc = describePlay(combo, move);
  pushLog(s, {
    actorId: actor.id, actorName: actor.name, kind: 'play', text: desc.text,
    cards: combo.cards, chosenColor: desc.chosenColor,
    stackId: stacking || opensStack ? s.chainId : undefined,
  });

  // --- Stack responses (pending exists): draw-extend, x2, div ---
  if (s.pending) {
    if (combo.isX2) {
      s.pending.total += (combo.draw!.value ?? 0) * 2;     // RD4: double the attached draw
      s.pending.topValue = combo.draw!.value ?? 0;
      s.pending.source = drawSource(combo.draw!);
      s.currentColor = drawActiveColor(combo.draw!, move);
      logDetail(s, actor, `x2 - draw stack is now ${s.pending.total}`, { stackId: s.chainId });
      advance(s, 1);
    } else if (combo.lead.kind === 'mult') {               // RD4: x2 alone doubles the current stack top (+= topValue)
      s.pending.total += s.pending.topValue;               // topValue unchanged: no new + card was played
      logDetail(s, actor, `x2 - draw stack is now ${s.pending.total}`, { stackId: s.chainId });
      advance(s, 1);
    } else if (combo.lead.kind === 'div') {                // RD5: halve, then this player draws
      s.pending.total = Math.floor(s.pending.total / 2);
      drawCards(s, actor, s.pending.total);
      logDetail(s, actor, `/2 - drew ${s.pending.total}, stack cleared`, { stackId: s.chainId });
      s.pending = null; s.colorLocked = false;
      if (s.phase === 'duel') return endDuel(s);            // RD11: /2 resolves the stack -> duel ends
      advance(s, 1);
    } else {                                               // single draw extends the stack
      s.pending.total += combo.lead.value ?? 0;
      s.pending.topValue = combo.lead.value ?? 0;
      s.pending.source = drawSource(combo.lead);
      s.currentColor = drawActiveColor(combo.lead, move);
      logDetail(s, actor, `draw stack is now ${s.pending.total}`, { stackId: s.chainId });
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
      source: drawSource(combo.lead) };
    s.currentColor = drawActiveColor(combo.lead, move);
    logDetail(s, actor, `opened a +${combo.lead.value} draw stack`, { stackId: s.chainId });
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
    pushLog(s, { actorId: responder.id, actorName: responder.name, kind: move.type, text: `${move.type === 'shield' ? 'shielded' : 'countered'} the bomb` });
  } else {                                                  // any other move (draw) = accept
    drawCards(s, responder, 4);
    pushLog(s, { actorId: responder.id, actorName: responder.name, kind: 'draw', text: 'took 4 from the bomb', drawCount: 4 });
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
    case 'skip': {
      logDetail(s, actor, `skips ${s.players[nextActiveIndex(s, s.turnIndex, 1)].name}`);
      advance(s, 2); break;
    }
    case 'playAgain': s.goAgain = true; logDetail(s, actor, 'plays again'); break; // same player continues (no advance)
    case 'minus': {
      const ids = new Set(move.minusDiscardIds ?? []);   // discard exactly the chosen same-color cards
      if (ids.size) {
        actor.hand = actor.hand.filter(c => !ids.has(c.id));
        logDetail(s, actor, `dumped ${ids.size} ${lead.color} card${ids.size === 1 ? '' : 's'}`);
      }
      advance(s, 1); break;
    }
    case 'reverseDraw': {                                    // RD13: flip direction, then open a defendable +draw
      s.direction = (-s.direction) as 1 | -1;                // stack is aimed at the previous player (the new "next")
      const target = s.players[nextActiveIndex(s, s.turnIndex, 1)];
      s.pending = { total: lead.value ?? 0, topValue: lead.value ?? 0, source: 'blackDraw' };
      s.chainId++;                                           // a fresh draw chain begins
      logDetail(s, actor, `reversed direction; +${lead.value} stack on ${target.name}`, { stackId: s.chainId });
      advance(s, 1); break;                                  // responding to the stack IS that player's turn
    }
    case 'duel':                                             // RD11: enter 1v1; color chosen upfront
      s.phase = 'duel';
      s.pending = { total: 4, topValue: 4, source: 'blackDraw' };
      s.chainId++;                                           // the +4 duel opens a fresh draw chain
      s.duel = { challengerId: actor.id, opponentId: move.targetId!, activeId: move.targetId! };
      s.currentColor = move.chosenColor ?? s.currentColor;
      logDetail(s, actor, `challenges ${seatName(s, move.targetId)} to a +4 duel`);
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
      logDetail(s, actor, 'bomb! every other player must draw 4 or shield/counter');
      break;                                                 // no advance; the response phase takes over
    }
    case 'drawUntilColor': {                                 // RD17: open OR bounce a draw-until-color threat
      s.pendingUntil = { color: move.chosenColor ?? s.currentColor };
      s.currentColor = move.chosenColor ?? s.currentColor;
      logDetail(s, actor, `${s.players[nextActiveIndex(s, s.turnIndex, 1)].name} must draw until ${s.currentColor}`);
      advance(s, 1); break;                                  // pass the threat to the next player to answer
    }
    case 'swap': {
      const t = s.players.find(p => p.id === move.targetId)!;
      [actor.hand, t.hand] = [t.hand, actor.hand];
      logDetail(s, actor, `swapped hands with ${t.name}`);
      advance(s, 1); break;
    }
    case 'steal': {
      const t = s.players.find(p => p.id === move.targetId)!;
      if (t.hand.length) {
        const j = Math.floor(createRng(s.seed + ':' + s.discardPile.length)() * t.hand.length);
        actor.hand.push(t.hand.splice(j, 1)[0]);
        eliminateIfOverloaded(s, actor);
        logDetail(s, actor, `took a random card from ${t.name}`);
      } else {
        logDetail(s, actor, `tried to steal from ${t.name} (no cards)`);
      }
      advance(s, 1); break;
    }
    case 'gift': {
      const t = s.players.find(p => p.id === move.targetId)!;
      const gi = actor.hand.findIndex(c => c.id === move.giftCardId);
      if (gi >= 0) { t.hand.push(actor.hand.splice(gi, 1)[0]); eliminateIfOverloaded(s, t); }
      logDetail(s, actor, `gave a card to ${t.name}`);
      advance(s, 1); break;
    }
    case 'eye': logDetail(s, actor, `peeked at ${seatName(s, move.targetId)}'s hand`); advance(s, 1); break;
    case 'wild': advance(s, 1); break;                       // color already on the play line's chip
    case 'recycle': applyRecycle(s, move); break;
    default: advance(s, 1);                                  // number / pair / run / pairsRun
  }
}

/** Copy the effect of the card beneath the recycle just played (RD14). By design this
 *  re-applies the effect directly and skips the copied card's normal play preconditions
 *  (e.g. a recycled bomb does not require a number on top); legality already validated the
 *  recycle's own inputs (targetId/giftCardId/color) in isMoveLegal. */
function applyRecycle(s: GameState, move: Extract<Move, { type: 'play' }>): void {
  // See through stacked recycles to the real card beneath (excludes the recycle just played).
  // `copied` is therefore never a recycle, so applyEffect cannot re-enter this function.
  const target = recycleTarget(s.discardPile.slice(0, -1));
  if (!target) { advance(s, 1); return; }                   // nothing to copy (legality guards this)
  const copied = target.card;
  const actor = s.players.find(p => p.id === move.playerId)!;
  logDetail(s, actor, `copied ${cardName(copied)}`);
  if (isDraw(copied)) {
    s.pending = { total: copied.value ?? 0, topValue: copied.value ?? 0, source: drawSource(copied) };
    s.currentColor = isBlack(copied) ? (move.chosenColor ?? s.currentColor) : copied.color;
    s.chainId++;                                            // recycle copying a draw opens a fresh chain
    logDetail(s, actor, `opened a +${copied.value} draw stack`, { stackId: s.chainId });
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
  if (s.pendingUntil) return resolveDrawUntil(s);    // accept a draw-until-color threat
  if (s.pending) return resolveDraw(s);              // absorb the forced stack (ends a duel if mid-duel)
  if (s.phase === 'duel') return endDuel(s);         // no stack: just exit the duel
  const skipped = s.players[s.turnIndex];
  advance(s, 1);
  pushLog(s, { actorId: skipped.id, actorName: skipped.name, kind: 'skip', text: 'was skipped' });
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
  pushLog(s, { actorId: p.id, actorName: p.name, kind: 'system', text: 'left the game' });

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
      pushLog(s, { actorId: existing.id, actorName: existing.name, kind: 'system', text: 'rejoined' });
    }
    return s;
  }
  const p: PlayerState = { id: seed.id, name: seed.name, isBot: seed.isBot, connected: true, status: 'active', hand: [] };
  s.players.push(p);
  drawCards(s, p, s.config.startingHandSize);
  pushLog(s, { actorId: p.id, actorName: p.name, kind: 'system', text: 'joined the game' });
  return s;
}

export { checkEnd, reshuffle };
