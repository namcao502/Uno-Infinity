import { Suspense } from 'react';
import { PlayClient } from '@/components/lobby/PlayClient';

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted-foreground">Loading...</div>}>
      <PlayClient />
    </Suspense>
  );
}
