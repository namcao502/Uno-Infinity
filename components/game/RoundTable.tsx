'use client';
import type React from 'react';
import { cn } from '@/lib/utils';
import { TIMING } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';
import type { SeatRow, PresenceInfo } from '@/lib/hooks/useRoom';

interface RoundTableProps {
  seats: SeatRow[];                       // all seats, already sorted by seatIndex
  myId: string;
  direction: number;                      // pub.direction: 1 = clockwise, -1 = counter-clockwise
  presence: Record<string, PresenceInfo>;
  serverNow: number;
  children: React.ReactNode;              // center cluster: draw + discard + pending
}

// Seat ring radius as a percentage of the (square) container.
const SEAT_RADIUS = 40;

/** Position on the ring for seat `k` of `n`, going clockwise from the bottom so
 *  that increasing seatIndex matches direction === 1 (the clockwise glyph). */
function seatPos(k: number, n: number): { left: string; top: string } {
  const a = (k / n) * 2 * Math.PI;
  const left = 50 - SEAT_RADIUS * Math.sin(a);
  const top = 50 + SEAT_RADIUS * Math.cos(a);
  return { left: `${left}%`, top: `${top}%` };
}

export function RoundTable({ seats, myId, direction, presence, serverNow, children }: RoundTableProps) {
  // Eliminated players (status 'out') stay seated but dimmed; true spectators
  // (isAudience) are not at the table. Rotate so I sit at the bottom (k=0).
  const participants = seats.filter((s) => !s.isAudience);
  const mi = participants.findIndex((s) => s.id === myId);
  const ordered = mi >= 0 ? [...participants.slice(mi), ...participants.slice(0, mi)] : participants;
  const n = ordered.length;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
      {/* Felt */}
      <div className="absolute inset-0 rounded-full border bg-lc-table shadow-inner" />

      {/* Direction-of-play arrow (behind the piles) */}
      {n > 1 && <DirectionArrow direction={direction} />}

      {/* Center piles */}
      <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">{children}</div>

      {/* Seats around the ring */}
      {ordered.map((s, k) => {
        const offline = !s.isBot && s.status === 'active' && presence[s.id]?.online === false;
        const lastSeen = presence[s.id]?.lastSeen;
        const reconnectLeft = offline && lastSeen
          ? Math.max(0, TIMING.reconnectSeconds - Math.floor((serverNow - lastSeen) / 1000)) : null;
        const { left, top } = seatPos(k, n);
        return (
          <div key={s.id} className="absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left, top }}>
            <SeatChip seat={s} isMe={s.id === myId} offline={offline} reconnectLeft={reconnectLeft} />
          </div>
        );
      })}
    </div>
  );
}

interface SeatChipProps {
  seat: SeatRow;
  isMe: boolean;
  offline: boolean;
  reconnectLeft: number | null;
}

function SeatChip({ seat, isMe, offline, reconnectLeft }: SeatChipProps) {
  const t = useT();
  const out = seat.status === 'out';
  return (
    <div
      className={cn(
        'w-[92px] rounded-lg border bg-card/95 px-2 py-1.5 text-center shadow-md backdrop-blur-sm',
        seat.turn && 'border-lc-yellow animate-turn-glow motion-reduce:animate-none',
        (offline || out) && 'opacity-60',
      )}
    >
      <div className="truncate text-xs font-semibold">
        {seat.name}{seat.isBot ? ' 🤖' : ''}{isMe ? ` ${t.game.you}` : ''}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {out ? <span className="font-bold text-destructive">{t.game.audience}</span> : t.game.cardsCount(seat.handCount)}
        {!out && seat.status === 'active' && seat.handCount === 1 && ` • ${t.game.oneLeft}`}
      </div>
      {offline && (
        <div className="text-[10px] font-semibold text-lc-red">
          {t.game.offline(reconnectLeft)}
        </div>
      )}
    </div>
  );
}

// Arc radius (in the 0-100 viewBox) for the direction ring: between the piles and seats.
const ARC_RADIUS = 34;

/** Sample points along the ring from startDeg to endDeg (clockwise, increasing
 *  angle measured from the bottom) into an SVG path string. */
function arcPath(startDeg: number, endDeg: number, steps = 48): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI) / 180;
    const x = 50 - ARC_RADIUS * Math.sin(t);
    const y = 50 + ARC_RADIUS * Math.cos(t);
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/** A near-full ring with an arrowhead showing the flow of play. Drawn clockwise;
 *  mirrored to counter-clockwise when direction === -1. Gap sits at the bottom,
 *  under the "You" seat. */
function DirectionArrow({ direction }: { direction: number }) {
  const start = 38;
  const end = 322;
  const d = arcPath(start, end);

  // Arrowhead at the leading (clockwise) end, pointing along the tangent.
  const te = (end * Math.PI) / 180;
  const ex = 50 - ARC_RADIUS * Math.sin(te);
  const ey = 50 + ARC_RADIUS * Math.cos(te);
  const tx = -Math.cos(te);
  const ty = -Math.sin(te);
  const tl = Math.hypot(tx, ty);
  const ux = tx / tl;
  const uy = ty / tl;
  const nx = -uy;
  const ny = ux;
  const tip = `${(ex + ux * 5).toFixed(2)},${(ey + uy * 5).toFixed(2)}`;
  const b1 = `${(ex - ux * 3 + nx * 4).toFixed(2)},${(ey - uy * 3 + ny * 4).toFixed(2)}`;
  const b2 = `${(ex - ux * 3 - nx * 4).toFixed(2)},${(ey - uy * 3 - ny * 4).toFixed(2)}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      style={{ transform: direction === -1 ? 'scaleX(-1)' : undefined }}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="var(--color-lc-yellow)"
        strokeOpacity={0.5}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <polygon points={`${tip} ${b1} ${b2}`} fill="var(--color-lc-yellow)" fillOpacity={0.7} />
    </svg>
  );
}
