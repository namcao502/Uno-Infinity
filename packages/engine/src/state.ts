import { buildDeck, type Card, type CardColor } from './cards';
import type { RuleConfig } from './config';
import { createRng, shuffle } from './rng';

export type GamePhase = 'playing' | 'duel' | 'bombResponse' | 'roundEnd' | 'gameOver';
export const MAX_HAND = 30;                        // hand.length > 30 -> eliminated (RD20)

export interface PlayerSeed { id: string; name: string; isBot: boolean }
export interface PlayerState {
  id: string; name: string; isBot: boolean; connected: boolean;
  status: 'active' | 'out';
  hand: Card[]; score: number;
}
export interface PendingDraw { total: number; topValue: number; source: 'colorDraw' | 'blackDraw' }
export interface DuelState { challengerId: string; opponentId: string; activeId: string }
export interface BombResponse { bomberId: string; pending: string[]; bomberDraw: number; endColor: CardColor }

export interface GameState {
  phase: GamePhase;
  config: RuleConfig;
  players: PlayerState[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor;
  colorLocked: boolean;
  turnIndex: number;
  direction: 1 | -1;
  pending: PendingDraw | null;
  duel: DuelState | null;
  bombResponse: BombResponse | null;
  goAgain: boolean;
  winnerId: string | null;
  seed: string;
  log: string;
}

export function createGame(seeds: PlayerSeed[], config: RuleConfig, seed: string): GameState {
  const rng = createRng(seed);
  const deck = shuffle(buildDeck(config.deck), rng);
  if (seeds.length * config.startingHandSize + 1 > deck.length)
    throw new Error(`Cannot deal ${config.startingHandSize} to ${seeds.length} players from a ${deck.length}-card deck`);

  const players: PlayerState[] = seeds.map(s => ({
    id: s.id, name: s.name, isBot: s.isBot, connected: true, status: 'active', hand: [], score: 0,
  }));
  let idx = 0;
  for (let r = 0; r < config.startingHandSize; r++)
    for (const p of players) p.hand.push(deck[idx++]);

  // Start on the first plain colored NUMBER card (no special on the opening discard).
  let firstIdx = idx;
  while (firstIdx < deck.length && deck[firstIdx].kind !== 'number') firstIdx++;
  if (firstIdx >= deck.length) throw new Error('No number card available to start the discard pile');
  const first = deck[firstIdx];
  const drawPile = deck.slice(idx).filter(c => c.id !== first.id);

  return {
    phase: 'playing', config, players,
    drawPile, discardPile: [first], currentColor: first.color, colorLocked: false,
    turnIndex: 0, direction: 1, pending: null, duel: null, bombResponse: null, goAgain: false,
    winnerId: null, seed, log: 'Game started',
  };
}

export const topCard = (s: GameState): Card => s.discardPile[s.discardPile.length - 1];
export const currentPlayer = (s: GameState): PlayerState => s.players[s.turnIndex];
export const activePlayers = (s: GameState): PlayerState[] => s.players.filter(p => p.status === 'active');

/** Index of the player `steps` active seats from `from`, in s.direction, skipping 'out' players. */
export function nextActiveIndex(s: GameState, from: number, steps: number): number {
  const n = s.players.length;
  let i = from, moved = 0;
  while (moved < steps) {
    i = ((i + s.direction) % n + n) % n;
    if (s.players[i].status === 'active') moved++;
    if (activePlayers(s).length === 0) break; // safety
  }
  return i;
}

/** Begin a fresh round, preserving scores and resetting status. Used only in points mode. */
export function startNextRound(prev: GameState): GameState {
  return nextRoundWith(prev, prev.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })));
}

/** Begin a fresh round from an EXPLICIT seed list (so audience / departed players
 *  are excluded and mid-game joiners carry over), preserving scores by id. */
export function nextRoundWith(prev: GameState, seeds: PlayerSeed[]): GameState {
  const next = createGame(seeds, prev.config, prev.seed + ':r' + prev.discardPile.length);
  next.players.forEach((p) => { p.score = prev.players.find(x => x.id === p.id)?.score ?? 0; });
  return next;
}
