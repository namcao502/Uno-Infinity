import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Hero } from '@/components/marketing/Hero';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
import { HowToPlaySection } from '@/components/marketing/HowToPlaySection';
import { RulesSection } from '@/components/marketing/RulesSection';
import { AboutSection } from '@/components/marketing/AboutSection';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <SiteHeader />
      <Hero />
      <FeatureGrid />
      <HowToPlaySection />
      <RulesSection />
      <AboutSection />
    </main>
  );
}
