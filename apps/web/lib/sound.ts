'use client';

type Sfx = 'deal' | 'play' | 'draw' | 'special' | 'win';
const FREQ: Record<Sfx, number> = { deal: 330, play: 440, draw: 220, special: 660, win: 880 };

let ctx: AudioContext | null = null;

export function isMuted(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem('muted') === '1';
}
export function setMuted(m: boolean): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem('muted', m ? '1' : '0');
}

/** Tiny synth blip - no external audio assets. Safe no-op on the server / when muted. */
export function play(sfx: Sfx): void {
  if (typeof window === 'undefined' || isMuted()) return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = FREQ[sfx];
    osc.type = 'triangle';
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // ignore audio errors (autoplay policy etc.)
  }
}
