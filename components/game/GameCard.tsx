'use client';
import { useRef } from 'react';
import type { Card, CardKind } from '@last-card/engine';
import { cn } from '@/lib/utils';
import { cardInfo } from '@/lib/card-info';
import { CARD_COLORS, COLORS, TIMING } from '@/lib/constants';

const GLYPH: Partial<Record<CardKind, string>> = {
  mult: 'x2', div: '/2', skip: 'SK', playAgain: 'AG', minus: '-',
  duel: 'DU', bomb: 'BM', recycle: 'RC', eye: 'EY', swap: 'SW',
  steal: 'ST', gift: 'GF', drawUntilColor: 'COL', shield: 'SH',
  counter: 'CT', wild: '*',
};

export function cardLabel(card: Card): string {
  const color = card.color === 'black' ? 'Black' : card.color.charAt(0).toUpperCase() + card.color.slice(1);
  if (card.kind === 'number') return `${color} ${card.value}`;
  if (card.kind === 'draw') return `${color} plus ${card.value}`;
  if (card.kind === 'reverseDraw') return `Reverse plus ${card.value}`;
  const names: Partial<Record<CardKind, string>> = {
    mult: 'times two', div: 'divide by two', skip: 'skip', playAgain: 'play again', minus: 'minus',
    duel: 'duel', bomb: 'bomb', recycle: 'recycle', eye: 'eye peek', swap: 'swap hands',
    steal: 'steal', gift: 'gift', drawUntilColor: 'draw until color', shield: 'shield', counter: 'counter', wild: 'wild',
  };
  return names[card.kind] ?? card.kind;
}

function face(card: Card): string {
  if (card.kind === 'number') return String(card.value);
  if (card.kind === 'draw') return `+${card.value}`;
  if (card.kind === 'reverseDraw') return `R+${card.value}`;
  return GLYPH[card.kind] ?? '?';
}

interface GameCardProps {
  card: Card;
  selected?: boolean;
  playable?: boolean;
  dimmed?: boolean;
  small?: boolean;
  onClick?: () => void;
  /** Long-press (or tap, when not selectable) opens the card's effect details. */
  onInspect?: () => void;
}

export function GameCard({ card, selected, playable, dimmed, small, onClick, onInspect }: GameCardProps) {
  const info = cardInfo(card);
  const content = (
    <span className="flex flex-col items-center justify-center leading-none">
      <span className={small ? 'text-lg' : 'text-2xl'}>{face(card)}</span>
      {!small && info.short && (
        <span className="mt-0.5 px-0.5 text-center text-[8px] font-bold uppercase leading-none tracking-tight opacity-90">
          {info.short}
        </span>
      )}
    </span>
  );
  const base = cn(
    'relative flex items-center justify-center rounded-xl border-4 border-white font-extrabold text-white shadow-lg transition-transform',
    small ? 'h-14 w-10 text-sm' : 'h-24 w-16',
    dimmed && 'brightness-50 saturate-50',
    selected && '-translate-y-4 outline outline-2 outline-lc-yellow',
    playable && !selected && '-translate-y-2 ring-2 ring-lc-yellow/70',
  );
  const style = { backgroundColor: CARD_COLORS[card.color], color: card.color === 'yellow' ? COLORS.ink : COLORS.white };

  // Long-press to inspect, without interfering with tap-to-select.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = () => {
    if (!onInspect) return;
    longPressed.current = false;
    timer.current = setTimeout(() => { longPressed.current = true; onInspect(); }, TIMING.longPressMs);
  };
  const endPress = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onClick(); }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onContextMenu={(e) => { if (onInspect) { e.preventDefault(); onInspect(); } }}
        aria-label={cardLabel(card)}
        className={cn(base, 'cursor-pointer focus-visible:ring-2 focus-visible:ring-lc-yellow')}
        style={style}
      >
        {content}
      </button>
    );
  }
  if (onInspect) {
    return (
      <button type="button" onClick={onInspect} aria-label={`${cardLabel(card)} details`} className={cn(base, 'cursor-pointer')} style={style}>
        {content}
      </button>
    );
  }
  return <span aria-hidden className={base} style={style}>{content}</span>;
}
