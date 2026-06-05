import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Hero } from '@/components/marketing/Hero';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <SiteHeader />
      <Hero />
      <FeatureGrid />
    </main>
  );
}
