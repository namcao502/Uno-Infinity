import { Suspense } from 'react';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Hero } from '@/components/marketing/Hero';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
import { HowToPlaySection } from '@/components/marketing/HowToPlaySection';
import { AboutSection } from '@/components/marketing/AboutSection';
import { RoomDialogsLazy } from '@/components/lobby/RoomDialogsLazy';
import { InstallPrompt } from '@/components/InstallPrompt';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <SiteHeader />
      <Hero />
      <FeatureGrid />
      <HowToPlaySection />
      <AboutSection />
      {/* Create / browse / join popups, opened via ?create / ?browse / ?join. Lazy-loaded so the
          dialog code + Firebase db/functions only load when a dialog is actually requested. */}
      <Suspense fallback={null}>
        <RoomDialogsLazy />
      </Suspense>
      <InstallPrompt />
    </main>
  );
}
