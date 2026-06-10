import type { Card } from '@last-card/engine';
import type { Dict } from '@/lib/i18n';

export interface CardInfo {
  /** Tiny label shown under the glyph on the card face ('' = none). */
  short: string;
  /** Full card name for the inspect popover. */
  name: string;
  /** What the card does, for the inspect popover. Wording mirrors the rules section. */
  effect: string;
}

/** Localized name/effect/short for a card. Text comes from the active dictionary (`t.cards`). */
export function cardInfo(card: Card, t: Dict): CardInfo {
  const c = t.cards;
  if (card.kind === 'number')
    return { short: '', name: `${t.colors[card.color]} ${card.value}`, effect: c.numberEffect };
  if (card.kind === 'draw')
    return { short: c.drawShort(card.value ?? 0), name: c.drawName(card.value ?? 0), effect: c.drawEffect };
  if (card.kind === 'reverseDraw')
    return { short: c.reverseShort(card.value ?? 0), name: c.reverseName(card.value ?? 0), effect: c.reverseEffect };
  return c[card.kind];
}
