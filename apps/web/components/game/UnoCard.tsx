'use client';
import { useRef } from 'react';
import type { Card, CardColor, CardKind } from '@uno/engine';
import { cn } from '@/lib/utils';
import { cardInfo } from '@/lib/card-info';

const COLOR_BG: Record<CardColor, string> = {
  red: '#e63946', green: '#2a9d4a', blue: '#2b6cb0', yellow: '#f4c430', black: '#15161c',
};

const GLYPH: Partial<Record<CardKind, string>> = {
  mult: 'x2', div: '÷2', skip: '⊘', playAgain: '↻', minus: '−',
  duel: '⚔', bomb: '\u{1f4a3}', recycle: '♺', eye: '\u{1f441}', swap: '⇄',
  steal: '\u{1f977}', gift: '\u{1f381}', drawUntilColor: '\u{1f3af}', shield: '\u{1f6e1}',
  counter: '\u{1f300}', wild: '★',
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

interface UnoCardProps {
  card: Card;
  selected?: boolean;
  playable?: boolean;
  dimmed?: boolean;
  small?: boolean;
  onClick?: () => void;
  /** Long-press (or tap, when not selectable) opens the card's effect details. */
  onInspect?: () => void;
}

export function UnoCard({ card, selected, playable, dimmed, small, onClick, onInspect }: UnoCardProps) {
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
    selected && '-translate-y-4 outline outline-2 outline-[#f4c430]',
    playable && !selected && '-translate-y-2 ring-2 ring-[#f4c430]/70',
  );
  const style = { backgroundColor: COLOR_BG[card.color], color: card.color === 'yellow' ? '#1a1500' : '#fff' };

  // Long-press to inspect, without interfering with tap-to-select.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = () => {
    if (!onInspect) return;
    longPressed.current = false;
    timer.current = setTimeout(() => { longPressed.current = true; onInspect(); }, 400);
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
        className={cn(base, 'cursor-pointer focus-visible:ring-2 focus-visible:ring-[#f4c430]')}
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
