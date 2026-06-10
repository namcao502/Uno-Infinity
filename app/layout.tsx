import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/lib/i18n/context";
import { LOCALE_COOKIE, pickLocale } from "@/lib/i18n";

// Distinctive display face for headings/wordmark; body keeps the fast system stack.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Last Card",
  description: "Last Card - a fast, real-time multiplayer card game where you race to empty your hand.",
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
      className={`${display.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <LanguageProvider initialLocale={locale}>
            <AuthProvider>{children}</AuthProvider>
            <Toaster />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
