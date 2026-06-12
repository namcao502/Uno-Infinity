'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  canStackDraw, isPlayable, classifySet, type Card, type CardColor, type CardKind, type Move, type LogEntry,
} from '@last-card/engine';
import { useRoom, type PublicState } from '@/lib/hooks/useRoom';
import { useHand } from '@/lib/hooks/useHand';
import { usePresence } from '@/lib/hooks/usePresence';
import { usePeek } from '@/lib/hooks/usePeek';
import { useServerNow } from '@/lib/hooks/useServerNow';
import { useAuth } from '@/lib/auth';
import { callSubmitMove, callForceTimeout, callPauseGame, callResumeGame } from '@/lib/functions';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GameCard, cardLabel } from './GameCard';
import { cardInfo } from '@/lib/card-info';
import { ChatPanel } from './ChatPanel';
import { GameLog } from './GameLog';
import { RoundTable } from './RoundTable';
import { ConnectionBanner } from './ConnectionBanner';
import { RoundEndDialog } from './RoundEndDialog';
import { LeaveRoomButton } from '@/components/lobby/LeaveRoomButton';
import { CARD_COLORS, TIMING } from '@/lib/constants';
import { useT } from '@/lib/i18n/context';
import { LanguageToggle } from '@/components/LanguageToggle';

const WILD_COLORS: CardColor[] = ['red', 'green', 'blue', 'yellow'];
const TARGETED = new Set<CardKind>(['duel', 'eye', 'swap', 'steal', 'gift']);
const needsColor = (c: Card) => c.kind === 'wild' || c.kind === 'drawUntilColor' || c.kind === 'duel' || c.kind === 'bomb'
  || (c.kind === 'draw' && c.color === 'black');
const ACTIONABLE_PHASES = ['playing', 'duel', 'bombResponse'];
const DISCARD_PILE_MAX = 10;   // how many recently-played cards to keep fanned on the board

/** Hand display order: group by color (red -> green -> blue -> yellow -> black), then value
 *  ascending (value-less specials sort last within a color), with kind as a stable tiebreak. */
const HAND_COLOR_RANK: Record<CardColor, number> = { red: 0, green: 1, blue: 2, yellow: 3, black: 4 };
function compareHand(a: Card, b: Card): number {
  return (HAND_COLOR_RANK[a.color] - HAND_COLOR_RANK[b.color])
    || ((a.value ?? 99) - (b.value ?? 99))
    || a.kind.localeCompare(b.kind);
}

/** Whether a single card is a legal lead/response given the current public state. */
function isCardPlayable(c: Card, pub: PublicState, drawnPlayableCardId: string | null): boolean {
  if (drawnPlayableCardId) return c.id === drawnPlayableCardId; // after a draw, only the drawn card may be played
  if (pub.phase === 'bombResponse') return c.kind === 'shield' || c.kind === 'counter';
  if (pub.pendingUntil) return c.kind === 'drawUntilColor' || c.kind === 'recycle'; // bounce a draw-until-color threat
  if (pub.pending) return canStackDraw(pub.pending, c) || c.kind === 'div' || c.kind === 'mult' || c.kind === 'shield' || c.kind === 'counter';
  return isPlayable(c, pub.discardTop, pub.currentColor, pub.colorLocked);
}

export function GameTable({ roomId }: { roomId: string }) {
  const { meta, seats, pub, presence } = useRoom(roomId);
  const { cards: hand, drawnPlayableCardId } = useHand(roomId);
  const { peek, dismiss } = usePeek(roomId);
  const { user, nickname } = useAuth();
  usePresence(roomId);
  const serverNow = useServerNow();
  const t = useT();
  const router = useRouter();

  const [selected, setSelected] = useState<string[]>([]);
  // a play awaiting extra input (color / target / gift / minus discards). `effective` is the card
  // whose inputs we collect - the copied card for a recycle, otherwise the lead itself.
  const [draft, setDraft] = useState<{ cardIds: string[]; lead: Card; effective: Card; chosenColor?: CardColor; targetId?: string; minusDiscardIds?: string[] } | null>(null);
  // a card whose effect the player is inspecting
  const [inspect, setInspect] = useState<Card | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  // Id of the hand card currently being dragged toward the table (HTML5 drag-and-drop, desktop).
  const [dragId, setDragId] = useState<string | null>(null);

  // Discard pile: keep the last few played cards on the board (newest on top), capped at
  // DISCARD_PILE_MAX. We accumulate each new discardTop client-side as it changes.
  const [pile, setPile] = useState<{ card: Card; fromX: number; fromY: number }[]>([]);
  const lastTopRef = useRef<string | null>(null);
  useEffect(() => {
    const top = pub?.discardTop;
    if (!top || top.id === lastTopRef.current) return;
    lastTopRef.current = top.id;
    // Fly the new top card in from the SEAT of whoever produced it (the last play/shield/counter),
    // mapped onto the same ring RoundTable lays out (me at the bottom). Falls back to bottom.
    const myUid = user?.uid ?? '';
    const log = (Array.isArray(pub?.log) ? pub?.log : Object.values(pub?.log ?? {})) as LogEntry[];
    let actorId = myUid;
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e && (e.kind === 'play' || e.kind === 'shield' || e.kind === 'counter') && e.actorId) { actorId = e.actorId; break; }
    }
    const parts = seats.filter((s) => !s.isAudience);
    const n = Math.max(1, parts.length);
    const mi = parts.findIndex((s) => s.id === myUid);
    const ordered = mi >= 0 ? [...parts.slice(mi), ...parts.slice(0, mi)] : parts;
    const k = ordered.findIndex((s) => s.id === actorId);
    const a = ((k >= 0 ? k : 0) / n) * 2 * Math.PI;   // 0 = bottom (me), matching seatPos in RoundTable
    const D = 230;                                     // px the card travels in from the seat direction
    const fromX = -Math.sin(a) * D;
    const fromY = Math.cos(a) * D;
    setPile((prev) => (prev.some((c) => c.card.id === top.id) ? prev : [...prev, { card: top, fromX, fromY }].slice(-DISCARD_PILE_MAX)));
    // Only discardTop change appends (lastTopRef guards dups); the rest are read for the fly-in origin.
  }, [pub?.discardTop, pub?.log, seats, user?.uid]);

  // Turn-timer enforcement: when the deadline passes and the player on turn is
  // ONLINE, any connected client asks the server to force the safe default. The
  // active player's own client fires immediately; others back it up after 2s.
  // Offline players are handled server-side (skip / forfeit), so we skip them here.
  const firedRef = useRef('');
  useEffect(() => {
    if (!pub?.turnDeadline || !pub.turnId || !meta || meta.paused) return;
    if (!['playing', 'duel', 'bombResponse'].includes(meta.phase)) return;
    if (presence[pub.turnId]?.online === false) return;
    const key = `${pub.turnId}:${pub.turnDeadline}`;
    const isMe = pub.turnId === (user?.uid ?? '');
    if (serverNow >= pub.turnDeadline + (isMe ? 0 : TIMING.timeoutBackupMs) && firedRef.current !== key) {
      firedRef.current = key;
      callForceTimeout({ roomId }).catch(() => {});
    }
  }, [serverNow, pub?.turnDeadline, pub?.turnId, meta, presence, user?.uid, roomId]);

  // Auto-draw for the active player when they have no legal move: there is nothing to
  // decide, so draw (or take the stack / accept the bomb) on their behalf after a short
  // beat. Guarded once per turn. The drawn-playable choice state is excluded.
  const autoDrewRef = useRef('');
  useEffect(() => {
    if (!pub || !meta || meta.paused) return;
    const myId = user?.uid ?? '';
    if (pub.turnId !== myId) return;
    const me = seats.find((s) => s.id === myId);
    if (me?.isAudience || me?.status === 'out') return;
    if (drawnPlayableCardId) return;
    if (!ACTIONABLE_PHASES.includes(pub.phase)) return;
    if (hand.length === 0 || hand.some((c) => isCardPlayable(c, pub, drawnPlayableCardId))) return;
    const key = `${pub.turnId}:${pub.turnDeadline ?? ''}`;
    if (autoDrewRef.current === key) return;
    const timer = setTimeout(() => {
      autoDrewRef.current = key;
      toast.message(t.game.autoDrawing);
      callSubmitMove({ roomId, move: { type: 'draw', playerId: myId } })
        .catch((e) => toast.error((e as { message?: string })?.message ?? t.errors.moveRejected));
    }, 700);
    return () => clearTimeout(timer);
  }, [pub, meta, seats, user?.uid, drawnPlayableCardId, hand, roomId, t]);

  // Alert the player the moment it becomes their turn (rising edge only, so re-renders during
  // the turn don't re-fire). A toast catches the eye even if they looked away; a short vibrate
  // nudges on mobile. The persistent banner + seat glow keep reminding for the rest of the turn.
  const turnAlertRef = useRef(false);
  useEffect(() => {
    const id = user?.uid ?? '';
    const mySeat = seats.find((s) => s.id === id);
    const myActionableTurn =
      !!pub && !!meta && !meta.paused && pub.turnId === id
      && !mySeat?.isAudience && mySeat?.status !== 'out'
      && ACTIONABLE_PHASES.includes(pub.phase);
    if (myActionableTurn && !turnAlertRef.current) {
      toast.success(t.game.yourTurn, { duration: 2500 });
      if (typeof navigator !== 'undefined') navigator.vibrate?.(180);
    }
    turnAlertRef.current = myActionableTurn;
  }, [pub, meta, seats, user?.uid, t]);

  if (!pub || !meta) return <div className="p-10 text-center text-muted-foreground">{t.game.dealing}</div>;

  const timerSecs = pub.turnDeadline && ['playing', 'duel', 'bombResponse'].includes(meta.phase)
    ? Math.max(0, Math.ceil((pub.turnDeadline - serverNow) / 1000)) : null;

  const myId = user?.uid ?? '';
  const myTurn = pub.turnId === myId;
  const me = seats.find((s) => s.id === myId);
  const iAmAudience = me?.isAudience === true;
  const eliminated = me?.status === 'out';
  const isHost = meta.hostId === myId;
  const canPause = ACTIONABLE_PHASES.includes(meta.phase);

  const togglePause = async (pause: boolean) => {
    setPauseBusy(true);
    try { await (pause ? callPauseGame : callResumeGame)({ roomId }); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.pauseError); }
    finally { setPauseBusy(false); }
  };

  const submit = async (move: Move) => {
    setSelected([]); setDraft(null);
    try { await callSubmitMove({ roomId, move }); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t.errors.moveRejected); }
  };

  const clientPlayable = (c: Card): boolean => isCardPlayable(c, pub, drawnPlayableCardId);
  // The card whose extra inputs a play needs: a recycle takes on the card it copies (seen through
  // recycle chains by the server via pub.recycleCopies), otherwise the lead itself.
  const effectiveOf = (lead: Card): Card => lead.kind === 'recycle' ? (pub.recycleCopies ?? lead) : lead;

  // Only let a selection begin with a playable card; once a playable lead is chosen, any
  // card may be added so multi-card combos (pairs / runs) still work. Deselecting is free.
  const toggle = (id: string) => {
    const already = selected.includes(id);
    if (!already && myTurn) {
      const card = hand.find((c) => c.id === id);
      const hasPlayableLead = selected.some((sid) => {
        const c = hand.find((x) => x.id === sid);
        return !!c && clientPlayable(c);
      });
      if (card && !clientPlayable(card) && !hasPlayableLead) {
        toast.message(t.game.notPlayable);
        return;
      }
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  // Play a set of cards (defaults to the click-selected set; drag-to-table passes a single id).
  const tryPlay = (ids: string[] = selected) => {
    const cards = ids.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
    // Shield / counter are played by selecting the card; the engine takes a dedicated move for them.
    const only = cards.length === 1 ? cards[0] : null;
    if (only?.kind === 'shield') { submit({ type: 'shield', playerId: myId }); return; }
    if (only?.kind === 'counter') { submit({ type: 'counter', playerId: myId }); return; }
    const res = classifySet(cards);
    if (!res.ok) { toast.error(res.reason); return; }
    const lead = res.combo.lead;
    const effective = effectiveOf(lead);   // for a recycle, the card it copies (may need color/target/gift/minus)
    if (effective.kind === 'minus') {
      // Let the player pick which same-color cards to dump; skip the prompt if there are none.
      const sameColor = hand.filter((c) => c.color === effective.color && !ids.includes(c.id));
      if (sameColor.length === 0) { submit({ type: 'play', playerId: myId, cardIds: ids }); return; }
      setDraft({ cardIds: ids, lead, effective, minusDiscardIds: [] });
      return;
    }
    if (needsColor(effective) || TARGETED.has(effective.kind) || effective.kind === 'gift') {
      setDraft({ cardIds: ids, lead, effective });
      return;
    }
    submit({ type: 'play', playerId: myId, cardIds: ids });
  };

  // finalize a drafted play once all required inputs are present
  const finalizeDraft = (patch: Partial<NonNullable<typeof draft>>) => {
    const d = { ...draft!, ...patch };
    const needColor = needsColor(d.effective) && !d.chosenColor;
    const needTarget = TARGETED.has(d.effective.kind) && !d.targetId;
    const needGift = d.effective.kind === 'gift' && !(d as { giftCardId?: string }).giftCardId;
    if (needColor || needTarget || needGift) { setDraft(d); return; }
    const move: Move = { type: 'play', playerId: myId, cardIds: d.cardIds, chosenColor: d.chosenColor, targetId: d.targetId } as Move;
    submit(move);
  };

  const activeOpponents = seats.filter((s) => s.id !== myId && s.status === 'active');

  const selectedCards = selected.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
  const describeCard = describedCard(selectedCards);
  const sortedHand = [...hand].sort(compareHand);   // display order only; selection is by id
  // Screen-reader cue: announce when it becomes the player's turn (the moment they must act).
  const liveMessage = !eliminated && myTurn && ACTIONABLE_PHASES.includes(pub.phase) ? t.game.yourTurn : '';

  // RD19: a recycled minus is black, so dumping every remaining card would empty the hand on a black
  // card - illegal. (A direct, colored minus may empty the hand to win, so this only guards recycle.)
  const minusWouldEmpty = (d: NonNullable<typeof draft>): boolean =>
    d.lead.kind === 'recycle'
    && hand.filter((c) => !d.cardIds.includes(c.id) && !(d.minusDiscardIds ?? []).includes(c.id)).length === 0;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div aria-live="polite" aria-atomic="true" className="sr-only">{liveMessage}</div>
        <ConnectionBanner eliminated={!!eliminated} />
        <RoundEndDialog roomId={roomId} meta={meta} seats={seats} winnerId={pub.winnerId} />

        {/* Paused overlay: blocks the table for everyone; only the host can resume. */}
        {meta.paused && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-w-sm rounded-xl border bg-card p-6 text-center">
              <h3 className="text-lg font-bold">{t.game.pausedTitle}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t.game.pausedByHost}</p>
              <div className="mt-4 flex flex-col gap-2">
                {isHost && (
                  <Button size="lg" disabled={pauseBusy} onClick={() => togglePause(false)}>{t.game.resume}</Button>
                )}
                <Button size="lg" variant="outline" onClick={() => router.push('/')}>{t.common.backToHome}</Button>
              </div>
            </div>
          </div>
        )}

        {/* Your-turn banner: a bright, pulsing bar so the active player can't miss it. */}
        {!eliminated && myTurn && !meta.paused && ACTIONABLE_PHASES.includes(pub.phase) && (
          <div className="animate-play-ready rounded-lg bg-lc-yellow px-4 py-2 text-center text-base font-black uppercase tracking-wide text-lc-ink motion-reduce:animate-none">
            {t.game.yourTurn}
          </div>
        )}

        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
          <span className="font-bold">{t.game.room(meta.code)}</span>
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 bg-card px-3 py-1 text-sm font-bold shadow-sm">
              <span className="text-muted-foreground">{t.game.current}:</span>
              <span className="inline-block h-4 w-4 rounded-full border border-black/20" style={{ backgroundColor: colorHex(pub.currentColor) }} aria-hidden />
              <span className="font-black">{t.colors[pub.currentColor]}</span>
            </span>
            {pub.colorLocked && <span className="rounded bg-muted px-2 py-0.5 text-xs">{t.game.colorLocked}</span>}
            {timerSecs !== null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${timerSecs <= TIMING.timerWarnSeconds ? 'bg-lc-red text-white' : 'bg-muted'}`} aria-label={`${timerSecs} seconds left`}>
                {timerSecs}s
              </span>
            )}
            <span aria-label={pub.direction === 1 ? 'clockwise' : 'counter-clockwise'}>{pub.direction === 1 ? '↻' : '↺'}</span>
            {isHost && canPause && !meta.paused && (
              <Button size="sm" variant="outline" disabled={pauseBusy} onClick={() => togglePause(true)}>{t.game.pause}</Button>
            )}
            <LanguageToggle />
            <LeaveRoomButton roomId={roomId} canBecomeAudience={!iAmAudience && !eliminated} />
          </span>
        </div>

        {/* Spectators */}
        {seats.some((s) => s.isAudience) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold">{t.game.spectatorsLabel}</span>
            {seats.filter((s) => s.isAudience).map((s) => (
              <span key={s.id} className="rounded-full border px-2 py-0.5">{s.name}</span>
            ))}
          </div>
        )}

        {/* Center: round table with draw pile + fanned discard pile in the middle */}
        <RoundTable seats={seats} myId={myId} direction={pub.direction} presence={presence} serverNow={serverNow}>
          <div
            className={cn(
              'relative flex items-center justify-center gap-3 rounded-2xl p-1 transition-all',
              dragId && 'ring-2 ring-lc-yellow ring-offset-2 ring-offset-lc-table',
            )}
            onDragOver={(e) => { if (dragId) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || dragId;
              setDragId(null);
              if (id) tryPlay([id]);
            }}
          >
            <button
              type="button"
              disabled={!myTurn || eliminated}
              onClick={() => submit({ type: 'draw', playerId: myId })}
              aria-label={pub.pending ? `draw ${pub.pending.total}` : 'draw a card'}
              className="flex h-28 w-20 items-center justify-center rounded-xl border-4 border-white bg-lc-black font-bold text-white transition-transform duration-150 enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-60"
            >
              {t.game.draw}
            </button>
            <div className="flex flex-col items-center gap-1">
              {/* Fanned discard pile: older cards scattered underneath, newest on top flies in from the hand. */}
              <div className="relative h-28 w-20">
                {pile.map((entry, i) => {
                  const c = entry.card;
                  const isTop = i === pile.length - 1;
                  const { rot, dx, dy } = scatter(c.id);
                  return (
                    <span key={c.id} className="absolute inset-0" style={{ transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, zIndex: i }}>
                      {isTop ? (
                        <FlyIn x={entry.fromX} y={entry.fromY}>
                          <GameCard card={c} onInspect={() => setInspect(c)} />
                        </FlyIn>
                      ) : (
                        <span className="block"><GameCard card={c} /></span>
                      )}
                    </span>
                  );
                })}
              </div>
              <span className="text-xs text-white/80">{pub.drawCount} {t.game.deckSuffix}</span>
            </div>
            {pub.pending && (
              <div className="absolute -right-3 -top-3 rounded-lg bg-black/60 px-2 py-1 text-center text-white shadow-lg">
                {/* Re-key on the total so the number pops each time the stack grows. */}
                <div key={pub.pending.total} className="animate-badge-bump text-lg font-black motion-reduce:animate-none">+{pub.pending.total}</div>
                <div className="text-[10px]">{t.game.incoming}</div>
              </div>
            )}
          </div>
        </RoundTable>

        {/* Duel banner */}
        {pub.phase === 'duel' && pub.duel && (
          <div className="rounded-lg bg-lc-red/15 px-4 py-2 text-center text-sm font-semibold text-lc-red">
            {t.game.duel(seatName(seats, pub.duel.challengerId), seatName(seats, pub.duel.opponentId), seatName(seats, pub.turnId))}
          </div>
        )}
        {pub.phase === 'bombResponse' && (
          <div className="rounded-lg bg-lc-black px-4 py-2 text-center text-sm font-semibold text-white">
            💣 {pub.turnId === myId ? t.game.bombYour : t.game.waitingFor(seatName(seats, pub.turnId))}
          </div>
        )}
        {pub.pendingUntil && (
          <div className="rounded-lg bg-lc-blue/15 px-4 py-2 text-center text-sm font-semibold text-lc-blue">
            🃏 {t.game.drawUntil(t.colors[pub.pendingUntil.color])}! {pub.turnId === myId
              ? t.game.drawUntilBounce : t.game.waitingFor(seatName(seats, pub.turnId))}
          </div>
        )}

        {/* Action bar */}
        {!eliminated && myTurn && (
          <div className="flex flex-wrap items-center gap-2">
            {pub.phase === 'bombResponse' ? (
              <>
                <Button size="lg" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.accept}</Button>
                <PlaySelectedButton count={selected.length} onClick={tryPlay} />
              </>
            ) : pub.pending ? (
              <>
                <Button size="lg" variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.drawAmount(pub.pending.total)}</Button>
                <PlaySelectedButton count={selected.length} onClick={tryPlay} />
              </>
            ) : pub.pendingUntil ? (
              <>
                <Button size="lg" variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.drawUntil(t.colors[pub.pendingUntil.color])}</Button>
                <PlaySelectedButton count={selected.length} onClick={tryPlay} />
              </>
            ) : drawnPlayableCardId ? (
              <>
                <PlaySelectedButton count={selected.length} onClick={tryPlay} />
                <Button size="lg" variant="outline" onClick={() => submit({ type: 'draw', playerId: myId })}>{t.game.keepCard}</Button>
                <span className="text-sm text-muted-foreground">{t.game.drewPlayable}</span>
              </>
            ) : (
              <>
                <PlaySelectedButton count={selected.length} onClick={tryPlay} />
                {selected.length === 0 && <span className="text-sm text-muted-foreground">{t.game.selectHint}</span>}
              </>
            )}
          </div>
        )}
        {!eliminated && !myTurn && (
          <p className="text-sm text-muted-foreground">
            {t.game.waitingToPlayPrefix}<span className="font-semibold text-foreground">{seatName(seats, pub.turnId)}</span>{t.game.waitingToPlaySuffix}
          </p>
        )}
        {eliminated && <p className="text-sm font-semibold text-destructive">{t.game.inAudience}</p>}

        {/* Hand (hidden for spectators) */}
        {iAmAudience ? (
          <p className="rounded-lg border bg-card p-3 text-sm font-semibold text-muted-foreground">{t.game.spectatingHand}</p>
        ) : (
          <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
            {sortedHand.length === 0 && <span className="text-sm text-muted-foreground">{t.game.noCards}</span>}
            {sortedHand.map((c) => {
              const canDrag = myTurn && !eliminated && clientPlayable(c);
              return (
                <div
                  key={c.id}
                  draggable={canDrag}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragId(c.id); }}
                  onDragEnd={() => setDragId(null)}
                  className={cn(dragId === c.id && 'opacity-40', canDrag && 'cursor-grab active:cursor-grabbing')}
                >
                  <GameCard
                    card={c}
                    selected={selected.includes(c.id)}
                    playable={canDrag}
                    dimmed={!eliminated && myTurn && !clientPlayable(c) && !selected.includes(c.id)}
                    onClick={() => toggle(c.id)}
                    onInspect={() => setInspect(c)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Effect of the selected card (or the lead of a selected combo) */}
        {!iAmAudience && describeCard && (
          <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <GameCard card={describeCard} small />
            <div className="min-w-0">
              <div className="text-sm font-bold">{cardInfo(describeCard, t).name}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{cardInfo(describeCard, t).effect}</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <GameLog log={pub.log} seats={seats} />
        <ChatPanel roomId={roomId} nickname={nickname} />
      </div>

      {/* Overlays: color / target / gift / minus pickers - driven by the effective (copied) card */}
      {draft && (
        <Overlay onClose={() => setDraft(null)}>
          {needsColor(draft.effective) && !draft.chosenColor && (
            <Picker title={t.game.chooseColor}>
              <div className="grid grid-cols-2 gap-3">
                {WILD_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={t.colors[c]}
                    onClick={() => finalizeDraft({ chosenColor: c })}
                    className={`flex h-24 w-32 items-center justify-center rounded-2xl border-4 border-white text-lg font-extrabold shadow-lg transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lc-yellow sm:h-28 sm:w-36 ${c === 'yellow' ? 'text-lc-ink' : 'text-white'}`}
                    style={{ backgroundColor: colorHex(c) }}
                  >
                    {t.colors[c]}
                  </button>
                ))}
              </div>
            </Picker>
          )}
          {(!needsColor(draft.effective) || draft.chosenColor) && TARGETED.has(draft.effective.kind) && !draft.targetId && (
            <Picker title={t.game.choosePlayer}>
              {activeOpponents.map((o) => (
                <Button key={o.id} size="lg" variant="outline" onClick={() => finalizeDraft({ targetId: o.id })}>{o.name}</Button>
              ))}
            </Picker>
          )}
          {draft.effective.kind === 'gift' && draft.targetId && (
            <Picker title={t.game.chooseGift}>
              <div className="flex flex-wrap gap-2">
                {hand.filter((c) => !draft.cardIds.includes(c.id)).map((c) => (
                  <button key={c.id} onClick={() => submit({ type: 'play', playerId: myId, cardIds: draft.cardIds, targetId: draft.targetId, giftCardId: c.id })}>
                    <GameCard card={c} />
                  </button>
                ))}
              </div>
            </Picker>
          )}
          {draft.effective.kind === 'minus' && (
            <Picker title={t.game.dumpColor(t.colors[draft.effective.color])}>
              <div className="flex max-w-md flex-wrap gap-2">
                {hand.filter((c) => c.color === draft.effective.color && !draft.cardIds.includes(c.id)).map((c) => {
                  const picked = (draft.minusDiscardIds ?? []).includes(c.id);
                  return (
                    <button
                      key={c.id}
                      aria-pressed={picked}
                      onClick={() => setDraft((d) => {
                        if (!d) return d;
                        const cur = d.minusDiscardIds ?? [];
                        return { ...d, minusDiscardIds: cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id] };
                      })}
                    >
                      <GameCard card={c} selected={picked} />
                    </button>
                  );
                })}
              </div>
              <Button
                size="lg"
                className="mt-3"
                disabled={minusWouldEmpty(draft)}
                onClick={() => submit({ type: 'play', playerId: myId, cardIds: draft.cardIds, minusDiscardIds: draft.minusDiscardIds ?? [] })}
              >
                {(draft.minusDiscardIds?.length ?? 0) > 0 ? t.game.discardN(draft.minusDiscardIds!.length) : t.game.keepAll}
              </Button>
              {minusWouldEmpty(draft) && (
                <span className="mt-2 block text-xs text-lc-red">{t.game.minusKeepOne}</span>
              )}
            </Picker>
          )}
        </Overlay>
      )}

      {/* Card inspect */}
      {inspect && (
        <Overlay onClose={() => setInspect(null)}>
          <div className="max-w-xs rounded-xl border bg-card p-5 text-center">
            <div className="mb-3 flex justify-center"><GameCard card={inspect} /></div>
            <h3 className="font-bold">{cardInfo(inspect, t).name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{cardInfo(inspect, t).effect}</p>
            <Button size="lg" className="mt-4" onClick={() => setInspect(null)}>{t.game.close}</Button>
          </div>
        </Overlay>
      )}

      {/* Eye peek modal */}
      {peek && (
        <Overlay onClose={dismiss}>
          <Picker title={t.game.handOf(seatName(seats, peek.targetId))}>
            <div className="flex max-w-md flex-wrap gap-2">
              {peek.cards.map((c) => <GameCard key={c.id} card={c} small />)}
            </div>
            <Button size="lg" className="mt-3" onClick={dismiss}>{t.game.done}</Button>
          </Picker>
        </Overlay>
      )}
    </div>
  );
}

function colorHex(c: CardColor): string {
  return CARD_COLORS[c];
}
function seatName(seats: { id: string; name: string }[], id: string): string {
  return seats.find((s) => s.id === id)?.name ?? id;
}
/** Deterministic small scatter (rotation + offset) for a discarded card, keyed by its id so the
 *  pile stays put across re-renders. Kept small so the stack reads as a neat pile, not a mess. */
function scatter(id: string): { rot: number; dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return { rot: ((h >>> 0) % 13) - 6, dx: ((h >>> 4) % 7) - 3, dy: ((h >>> 8) % 7) - 3 };
}
/** The card whose effect to describe under the hand: the lone selection, or the lead of a combo. */
function describedCard(cards: Card[]): Card | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return cards[0];
  const res = classifySet(cards);
  return res.ok ? res.combo.lead : cards[cards.length - 1];
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
/** Primary table action: brand-yellow CTA showing the selected-card count, with a ready-glow when
 *  cards are selected and a muted state when nothing is. Replaces the plain "Play selected" button. */
function PlaySelectedButton({ count, onClick }: { count: number; onClick: () => void }) {
  const t = useT();
  const ready = count > 0;
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-base font-bold shadow-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lc-yellow/60',
        ready
          ? 'animate-play-ready bg-lc-yellow text-lc-ink hover:brightness-105 active:scale-95 motion-reduce:animate-none'
          : 'cursor-not-allowed bg-muted text-muted-foreground opacity-70',
      )}
    >
      <Layers className="h-5 w-5" />
      {ready ? t.game.playCount(count) : t.game.playSelected}
    </button>
  );
}
/** Flies its child in from (x, y) px to its resting spot on mount: a card animating from the
 *  player's seat into the center pile. Honors prefers-reduced-motion (no movement). */
function FlyIn({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [landed, setLanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => setLanded(true));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  return (
    <span
      className="block"
      style={{
        transform: landed ? 'none' : `translate(${x}px, ${y}px) scale(0.65) rotate(-12deg)`,
        opacity: landed ? 1 : 0,
        transition: reduce ? undefined : 'transform 600ms cubic-bezier(0.18,0.89,0.32,1.15), opacity 350ms ease-out',
      }}
    >
      {children}
    </span>
  );
}

function Picker({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="mb-4 text-xl font-bold sm:text-2xl">{title}</h3>
      {/* Stack children vertically so any action (choose player / discard) sits BELOW the cards,
          not in line with them. Card collections wrap within their own row (see callers). */}
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

// re-export so consumers can label cards if needed
export { cardLabel };
