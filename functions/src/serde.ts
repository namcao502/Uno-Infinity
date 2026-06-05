import type { GameState, Card, PlayerState } from '@uno/engine';

/** RTDB stores arrays as keyed objects and drops empty ones. Restore a dense array. */
export function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x) => x != null) as T[];
  if (v && typeof v === 'object')
    return Object.keys(v as Record<string, T>)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, T>)[k]);
  return [];
}

/** Re-hydrate a GameState read back from RTDB into proper arrays (players, hands, piles). */
export function normalize(raw: unknown): GameState {
  const s = raw as GameState;
  s.players = toArray<PlayerState>((s as { players: unknown }).players).map((p) => ({
    ...p, hand: toArray<Card>((p as { hand: unknown }).hand),
  }));
  s.drawPile = toArray<Card>((s as { drawPile: unknown }).drawPile);
  s.discardPile = toArray<Card>((s as { discardPile: unknown }).discardPile);
  return s;
}

/** Strip `undefined` (RTDB .set/.transaction reject it). Nulls are preserved. */
export function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
