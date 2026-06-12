'use client';
import type { Card, CardColor, CardKind } from '@last-card/engine';
import { GameCard } from '@/components/game/GameCard';

function card(id: string, color: CardColor, kind: CardKind, value: number | null): Card {
  return { id, color, kind, value };
}

// A colourful spread showcasing the real in-game card design (the same GameCard used in the
// House Rules popup): the four colours plus a black special, mixing numbers, draws and icons.
const FAN: { card: Card; rot: number; x: number }[] = [
  { card: card('fan-red-7', 'red', 'number', 7), rot: -24, x: -180 },
  { card: card('fan-green-again', 'green', 'playAgain', null), rot: -16, x: -120 },
  { card: card('fan-blue-draw-4', 'blue', 'draw', 4), rot: -8, x: -60 },
  { card: card('fan-yellow-skip', 'yellow', 'skip', null), rot: 0, x: 0 },
  { card: card('fan-red-draw-2', 'red', 'draw', 2), rot: 8, x: 60 },
  { card: card('fan-black-duel', 'black', 'duel', 4), rot: 16, x: 120 },
  { card: card('fan-black-bomb', 'black', 'bomb', 4), rot: 24, x: 180 },
];

export function CardFan() {
  return (
    <div aria-hidden className="relative flex h-[300px] items-center justify-center">
      {FAN.map(({ card: c, rot, x }, i) => (
        <div
          key={c.id}
          className="absolute"
          style={{ transform: `rotate(${rot}deg) translateX(${x}px)`, zIndex: i }}
        >
          {/* Nested scale keeps the fan's rotate+translate math intact while enlarging the card.
              1.3 (down from 1.5) narrows the 7-card fan so it fits the column without clipping. */}
          <div className="scale-[1.3]">
            <GameCard card={c} />
          </div>
        </div>
      ))}
    </div>
  );
}
