import { z } from 'zod';
import { DEFAULT_DECK, type DeckCounts } from './cards';

const count = z.number().int().min(0).max(40);
export const deckCountsSchema = z.object({
  numberPerColor: count, colorDraw2PerColor: count, colorDraw4PerColor: count,
  playAgainPerColor: count, skipPerColor: count, minusPerColor: count,
  blackDraw2: count, blackDraw4: count, blackDraw6: count, blackDraw8: count, blackDraw10: count,
  mult: count, div: count, duel: count, bomb: count,
  reverseDraw4: count, reverseDraw10: count, recycle: count, wild: count,
  eye: count, swap: count, steal: count, gift: count, drawUntilColor: count,
  shield: count, counter: count,
});

export function deckTotal(d: DeckCounts): number {
  const colored = 4 * (d.numberPerColor * 10 + d.colorDraw2PerColor + d.colorDraw4PerColor +
    d.playAgainPerColor + d.skipPerColor + d.minusPerColor);
  const black = d.blackDraw2 + d.blackDraw4 + d.blackDraw6 + d.blackDraw8 + d.blackDraw10 +
    d.mult + d.div + d.duel + d.bomb + d.reverseDraw4 + d.reverseDraw10 + d.recycle + d.wild +
    d.eye + d.swap + d.steal + d.gift + d.drawUntilColor + d.shield + d.counter;
  return colored + black;
}

export const ruleConfigSchema = z.object({
  version: z.literal(1),
  startingHandSize: z.number().int().min(1).max(15),
  maxPlayers: z.number().int().min(2).max(10),
  win: z.object({ condition: z.enum(['firstToEmpty', 'pointsTarget']), pointsTarget: z.number().int().min(50).max(2000) }),
  deck: deckCountsSchema,
}).refine(
  (c) => c.startingHandSize * c.maxPlayers + 1 <= deckTotal(c.deck),
  { message: 'startingHandSize x maxPlayers must leave room in the deck', path: ['startingHandSize'] },
);

export type RuleConfig = z.infer<typeof ruleConfigSchema>;

export const DEFAULT_CONFIG: RuleConfig = {
  version: 1,
  startingHandSize: 7,
  maxPlayers: 6,
  win: { condition: 'firstToEmpty', pointsTarget: 500 },
  deck: DEFAULT_DECK,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Merge a partial onto defaults and VALIDATE the result (throws on invalid combos). */
export function mergeConfig(patch: DeepPartial<RuleConfig>): RuleConfig {
  const d = DEFAULT_CONFIG;
  const merged = {
    version: 1 as const,
    startingHandSize: patch.startingHandSize ?? d.startingHandSize,
    maxPlayers: patch.maxPlayers ?? d.maxPlayers,
    win: { ...d.win, ...patch.win },
    deck: { ...d.deck, ...patch.deck },
  };
  return ruleConfigSchema.parse(merged);
}
