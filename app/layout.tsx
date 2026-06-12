import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/lib/i18n/context";
import { LOCALE_COOKIE, pickLocale } from "@/lib/i18n";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { GlobalLoadingOverlay } from "@/components/GlobalLoadingOverlay";

// Distinctive display face for headings/wordmark; body keeps the fast system stack.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Last Card",
  description: "Last Card - a fast, real-time multiplayer card game where you race to empty your hand.",
  applicationName: "Last Card",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Last Card" },
};

export const viewport: Viewport = {
  themeColor: "#15161c",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the locale on the server (cookie wins, else browser preference) so SSR and the
  // first client render match - no flash, no hydration mismatch.
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = pickLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${display.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <LanguageProvider initialLocale={locale}>
            <AuthProvider>{children}</AuthProvider>
            <Toaster />
            <GlobalLoadingOverlay />
          </LanguageProvider>
        </ThemeProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
