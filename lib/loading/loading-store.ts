'use client';

// A tiny ref-counted store driving the global loading overlay. It is framework-agnostic
// (no React) so plain modules like lib/functions.ts can wrap async work with `withLoading`.
// The overlay component subscribes via useSyncExternalStore.

type Listener = () => void;

let activeCount = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Mark one async task as started. Always pair with `endLoading`. */
export function beginLoading(): void {
  activeCount += 1;
  emit();
}

/** Mark one async task as finished. Clamped at zero so a stray call can't go negative. */
export function endLoading(): void {
  activeCount = Math.max(0, activeCount - 1);
  emit();
}

export function subscribeLoading(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Number of in-flight tasks; >0 means the overlay should be shown. */
export function getLoadingCount(): number {
  return activeCount;
}

/** Run a promise-returning task while the global overlay is active. Returns the task's value. */
export async function withLoading<T>(task: () => Promise<T>): Promise<T> {
  beginLoading();
  try {
    return await task();
  } finally {
    endLoading();
  }
}
