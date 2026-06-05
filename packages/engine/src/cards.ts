export type CardColor = 'red' | 'green' | 'blue' | 'yellow' | 'black';
export type CardKind =
  | 'number' | 'draw' | 'playAgain' | 'skip' | 'minus'
  | 'mult' | 'div' | 'duel' | 'bomb' | 'reverseDraw' | 'recycle'
  | 'eye' | 'swap' | 'steal' | 'gift' | 'drawUntilColor' | 'shield' | 'counter' | 'wild';
// value: number 0-9; draw amount; reverseDraw 4|10; mult/div 2; else null. NEVER undefined.
export interface Card { id: string; color: CardColor; kind: CardKind; value: number | null }

export const COLORS: Exclude<CardColor, 'black'>[] = ['red', 'green', 'blue', 'yellow'];
export const isBlack = (c: Card): boolean => c.color === 'black';
export const isDraw = (c: Card): boolean => c.kind === 'draw';

export interface DeckCounts {
  numberPerColor: number;       // of EACH rank 0-9, per color
  colorDraw2PerColor: number; colorDraw4PerColor: number;
  playAgainPerColor: number; skipPerColor: number; minusPerColor: number;
  blackDraw2: number; blackDraw4: number; blackDraw6: number; blackDraw8: number; blackDraw10: number;
  mult: number; div: number; duel: number; bomb: number;
  reverseDraw4: number; reverseDraw10: number; recycle: number; wild: number;
  eye: number; swap: number; steal: number; gift: number; drawUntilColor: number;
  shield: number; counter: number;
}

export const DEFAULT_DECK: DeckCounts = {
  numberPerColor: 2, colorDraw2PerColor: 2, colorDraw4PerColor: 2,
  playAgainPerColor: 2, skipPerColor: 2, minusPerColor: 1,
  blackDraw2: 2, blackDraw4: 2, blackDraw6: 2, blackDraw8: 2, blackDraw10: 2,
  mult: 4, div: 4, duel: 2, bomb: 2,
  reverseDraw4: 2, reverseDraw10: 2, recycle: 4, wild: 4,
  eye: 3, swap: 2, steal: 3, gift: 3, drawUntilColor: 3, shield: 4, counter: 4,
};

export function buildDeck(counts: DeckCounts): Card[] {
  const cards: Card[] = [];
  let n = 0;
  const push = (c: Omit<Card, 'id'>, times = 1) => { for (let i = 0; i < times; i++) cards.push({ ...c, id: `c${n++}` }); };
  for (const color of COLORS) {
    for (let v = 0; v <= 9; v++) push({ color, kind: 'number', value: v }, counts.numberPerColor);
    push({ color, kind: 'draw', value: 2 }, counts.colorDraw2PerColor);
    push({ color, kind: 'draw', value: 4 }, counts.colorDraw4PerColor);
    push({ color, kind: 'playAgain', value: null }, counts.playAgainPerColor);
    push({ color, kind: 'skip', value: null }, counts.skipPerColor);
    push({ color, kind: 'minus', value: null }, counts.minusPerColor);
  }
  const B = 'black' as const;
  push({ color: B, kind: 'draw', value: 2 }, counts.blackDraw2);
  push({ color: B, kind: 'draw', value: 4 }, counts.blackDraw4);
  push({ color: B, kind: 'draw', value: 6 }, counts.blackDraw6);
  push({ color: B, kind: 'draw', value: 8 }, counts.blackDraw8);
  push({ color: B, kind: 'draw', value: 10 }, counts.blackDraw10);
  push({ color: B, kind: 'mult', value: 2 }, counts.mult);
  push({ color: B, kind: 'div', value: 2 }, counts.div);
  push({ color: B, kind: 'duel', value: 4 }, counts.duel);
  push({ color: B, kind: 'bomb', value: 4 }, counts.bomb);
  push({ color: B, kind: 'reverseDraw', value: 4 }, counts.reverseDraw4);
  push({ color: B, kind: 'reverseDraw', value: 10 }, counts.reverseDraw10);
  push({ color: B, kind: 'recycle', value: null }, counts.recycle);
  push({ color: B, kind: 'wild', value: null }, counts.wild);
  push({ color: B, kind: 'eye', value: null }, counts.eye);
  push({ color: B, kind: 'swap', value: null }, counts.swap);
  push({ color: B, kind: 'steal', value: null }, counts.steal);
  push({ color: B, kind: 'gift', value: null }, counts.gift);
  push({ color: B, kind: 'drawUntilColor', value: null }, counts.drawUntilColor);
  push({ color: B, kind: 'shield', value: null }, counts.shield);
  push({ color: B, kind: 'counter', value: null }, counts.counter);
  return cards;
}

export function cardPoints(card: Card): number {
  if (card.kind === 'number') return card.value ?? 0;
  if (card.kind === 'draw' || card.kind === 'reverseDraw') return card.value ?? 0;
  if (['duel', 'bomb', 'wild', 'recycle', 'swap', 'eye', 'steal', 'gift', 'drawUntilColor'].includes(card.kind)) return 50;
  return 20; // skip / playAgain / minus / mult / div / shield / counter
}
