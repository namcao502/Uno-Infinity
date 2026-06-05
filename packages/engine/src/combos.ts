import type { Card } from './cards';

export type ComboKind = 'single' | 'x2' | 'pair' | 'run' | 'pairsRun';
export interface Combo {
  kind: ComboKind; cards: Card[];   // play order (runs sorted ascending)
  lead: Card;                       // card matched against the discard top
  finalTop: Card;                   // card left on top after the play
  locksColor: boolean; isX2: boolean;
  draw?: Card; mult?: Card;         // set for x2
}
export type ComboResult = { ok: true; combo: Combo } | { ok: false; reason: string };

const consecutive = (asc: number[]) => asc.every((v, i) => i === 0 || v === asc[i - 1] + 1);

export function classifySet(cards: Card[]): ComboResult {
  if (cards.length === 0) return { ok: false, reason: 'No cards' };
  if (cards.length === 1) {
    const c = cards[0];
    return { ok: true, combo: { kind: 'single', cards, lead: c, finalTop: c, locksColor: false, isX2: false } };
  }
  if (cards.length === 2) {
    const draw = cards.find(c => c.kind === 'draw');
    const mult = cards.find(c => c.kind === 'mult');
    if (draw && mult)
      return { ok: true, combo: { kind: 'x2', cards: [draw, mult], lead: draw, finalTop: mult, locksColor: false, isX2: true, draw, mult } };
    const [a, b] = cards;
    if (a.kind === 'number' && b.kind === 'number' && a.color !== 'black' && a.color === b.color && a.value === b.value)
      return { ok: true, combo: { kind: 'pair', cards, lead: a, finalTop: b, locksColor: false, isX2: false } };
    return { ok: false, reason: 'Two cards must be a matching pair or draw+x2' };
  }
  // 3+ numbers, same non-black color
  if (cards.every(c => c.kind === 'number' && c.color !== 'black' && c.color === cards[0].color)) {
    const sorted = [...cards].sort((a, b) => (a.value! - b.value!));
    const vals = sorted.map(c => c.value!);
    if (new Set(vals).size === vals.length && consecutive(vals))
      return { ok: true, combo: { kind: 'run', cards: sorted, lead: sorted[0], finalTop: sorted[sorted.length - 1], locksColor: true, isX2: false } };
    if (vals.length === 6) {
      const ranks = [...new Set(vals)].sort((a, b) => a - b);
      const eachTwice = ranks.length === 3 && ranks.every(r => vals.filter(v => v === r).length === 2);
      if (eachTwice && consecutive(ranks))
        return { ok: true, combo: { kind: 'pairsRun', cards: sorted, lead: sorted[0], finalTop: sorted[sorted.length - 1], locksColor: true, isX2: false } };
    }
    return { ok: false, reason: 'Not a valid run or three consecutive pairs' };
  }
  return { ok: false, reason: 'Invalid multi-card set' };
}
