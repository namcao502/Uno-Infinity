import type { Card, CardColor } from './cards';
import type { GameState, GamePhase, PendingDraw, DuelState, BombResponse } from './state';

export interface PublicPlayer {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out'; handCount: number; score: number;
}
export interface PublicView {
  phase: GamePhase;
  players: PublicPlayer[];
  discardTop: Card;
  currentColor: CardColor;
  colorLocked: boolean;
  turnId: string;
  direction: 1 | -1;
  pending: PendingDraw | null;
  duel: DuelState | null;
  bombResponse: BombResponse | null;
  goAgain: boolean;
  drawCount: number;
  winnerId: string | null;
  log: string;
  you: { id: string; hand: Card[] } | null;
}

export function redactFor(state: GameState, viewerId: string | null): PublicView {
  const me = viewerId ? state.players.find(p => p.id === viewerId) ?? null : null;
  const turnId = state.phase === 'bombResponse' && state.bombResponse ? state.bombResponse.pending[0]
    : state.phase === 'duel' && state.duel ? state.duel.activeId
    : state.players[state.turnIndex]?.id ?? '';
  return {
    phase: state.phase,
    players: state.players.map(p => ({
      id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
      status: p.status, handCount: p.hand.length, score: p.score,
    })),
    discardTop: state.discardPile[state.discardPile.length - 1],
    currentColor: state.currentColor,
    colorLocked: state.colorLocked,
    turnId,
    direction: state.direction,
    pending: state.pending,
    duel: state.duel,
    bombResponse: state.bombResponse,
    goAgain: state.goAgain,
    drawCount: state.drawPile.length,
    winnerId: state.winnerId,
    log: state.log,
    you: me ? { id: me.id, hand: me.hand } : null,
  };
}
