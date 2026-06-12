'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { subscribeLoading, getLoadingCount } from '@/lib/loading/loading-store';
import { useT } from '@/lib/i18n/context';

// Only reveal the overlay once a task has run past this threshold, so quick calls don't
// flash a backdrop. Anything slower (e.g. a Cloud Function cold start) shows it and tells
// the user work is still in progress.
const SHOW_DELAY_MS = 250;

/** Full-screen backdrop + spinner shown while any task wrapped with `withLoading` is in flight. */
export function GlobalLoadingOverlay() {
  const t = useT();
  const active = useSyncExternalStore(subscribeLoading, getLoadingCount, () => 0) > 0;
  const [visible, setVisible] = useState(false);

  // Depend on the boolean (not the count) so overlapping tasks don't retrigger the timer.
  // Show after the grace delay; hide in cleanup the moment loading ends.
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => {
      window.clearTimeout(id);
      setVisible(false);
    };
  }, [active]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm"
    >
      <Loader2 className="h-10 w-10 animate-spin text-lc-yellow" />
      <p className="text-sm font-medium text-white">{t.common.processing}</p>
    </div>
  );
}
