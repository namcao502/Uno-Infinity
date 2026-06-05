import type { CardColor } from './cards';

export type Move =
  | { type: 'play'; playerId: string; cardIds: string[];
      chosenColor?: CardColor; targetId?: string; giftCardId?: string; minusDiscard?: boolean }
  | { type: 'draw'; playerId: string }
  | { type: 'shield'; playerId: string }
  | { type: 'counter'; playerId: string };

export type LegalityResult = { ok: true } | { ok: false; reason: string };
