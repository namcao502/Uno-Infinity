'use client';
import { useRef } from 'react';
import type { Card } from '@last-card/engine';
import { cn } from '@/lib/utils';
import { cardInfo } from '@/lib/card-info';
import { CardIcon, hasCardIcon } from '@/lib/card-icons';
import { CARD_COLORS, COLORS, TIMING } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';
import type { Dict } from '@/lib/i18n';

/** Spoken/aria label for a card, from the active dictionary. */
export function cardLabel(card: Card, t: Dict): string {
  if (card.kind === 'number') return `${t.colors[card.color]} ${card.value}`;
  if (card.kind === 'draw') return t.cards.drawName(card.value ?? 0);
  if (card.kind === 'reverseDraw') return t.cards.reverseName(card.value ?? 0);
  return t.cards[card.kind].name;
}

/** Large text shown on a card that has no icon, or the corner value for draw cards. */
function faceText(card: Card): string {
  if (card.kind === 'number') return String(card.value);
  if (card.kind === 'draw') return `+${card.value}`;
  if (card.kind === 'reverseDraw') return `+${card.value}`; // Undo2 icon conveys "reverse"; corner keeps value
  if (card.kind === 'mult') return 'x2';
  if (card.kind === 'minus') return '-#';
  return '';
}

/** Cards whose value reads in the corners (numbers and draws). */
function hasCorners(card: Card): boolean {
  return card.kind === 'number' || card.kind === 'draw' || card.kind === 'reverseDraw';
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
  const t = useT();
  const info = cardInfo(card, t);
  const showIcon = hasCardIcon(card);
  const value = faceText(card);
  const corner = !small && hasCorners(card) ? value : '';

  const content = (
    <>
      {/* Inner bevel: top highlight + bottom shade for depth (sits under the face). */}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_2px_1px_rgba(255,255,255,0.4),inset_0_-7px_10px_rgba(0,0,0,0.18)]" />
      {corner && (
        <>
          <span className="absolute left-1.5 top-1 text-xs font-black leading-none">{corner}</span>
          <span className="absolute bottom-1 right-1.5 rotate-180 text-xs font-black leading-none">{corner}</span>
        </>
      )}
      <span className="flex flex-col items-center justify-center gap-0.5 leading-none">
        {showIcon ? (
          <CardIcon card={card} className={small ? 'h-5 w-5' : 'h-9 w-9'} />
        ) : (
          <span className={small ? 'text-lg' : 'text-3xl'}>{value}</span>
        )}
        {!small && showIcon && info.short && (
          <span className="px-0.5 text-center text-[9px] font-bold uppercase tracking-tight opacity-90">{info.short}</span>
        )}
      </span>
    </>
  );

  const base = cn(
    'relative flex items-center justify-center rounded-xl border-4 border-white font-extrabold text-white shadow-lg transition-transform duration-150 ease-out',
    small ? 'h-14 w-10 text-sm' : 'h-28 w-20',
    dimmed && 'brightness-50 saturate-50',
    selected && '-translate-y-4 outline outline-2 outline-lc-yellow',
    playable && !selected && '-translate-y-2 ring-2 ring-lc-yellow/70',
  );

  const fill = CARD_COLORS[card.color];
  const style = {
    backgroundColor: fill,
    backgroundImage: `linear-gradient(150deg, color-mix(in oklab, ${fill}, white 14%), ${fill} 52%, color-mix(in oklab, ${fill}, black 20%))`,
    color: card.color === 'yellow' ? COLORS.ink : COLORS.white,
  };

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
        aria-label={cardLabel(card, t)}
        className={cn(base, 'cursor-pointer focus-visible:ring-2 focus-visible:ring-lc-yellow', !selected && 'hover:-translate-y-3')}
        style={style}
      >
        {content}
      </button>
    );
  }
  if (onInspect) {
    return (
      <button type="button" onClick={onInspect} aria-label={`${cardLabel(card, t)} details`} className={cn(base, 'cursor-pointer')} style={style}>
        {content}
      </button>
    );
  }
  return <span aria-hidden className={base} style={style}>{content}</span>;
}
