import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { BlazeHeader } from "@/components/blaze-hawks/ui";
import { BlazeLocaleProvider } from "@/components/blaze-hawks/locale";
import { TooltipProvider } from "@/components/ui/tooltip";
import PageTransition from "@/components/PageTransition";
import { TranslationProvider } from "@/lib/i18n";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Attrax · Think Before You Expand",
  description: "AI-powered compliance risk scanning for cross-border e-commerce",
};

// NOTE(P1.7): `<html lang>` starts as the default "zh" for SSR; once the
// client mounts, TranslationProvider's useEffect syncs
// `document.documentElement.lang` to the user's resolved locale (zh/en,
// from localStorage / navigator.language). Cookie-based SSR locale is out
// of scope for this pass — see lib/i18n.tsx:detectInitialLocale.
// CSP nonce: no explicit work here. middleware.ts sets `x-nonce` on each
// request; Next.js auto-stamps that nonce onto its own inline hydration
// scripts (no manual <Script nonce> needed because this layout does not emit
// any client-script tags directly).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh"
      data-scroll-behavior="smooth"
      className={`${manrope.variable} ${spaceGrotesk.variable} h-full antialiased dark`}
    >
      <body className="min-h-full">
        <BlazeLocaleProvider>
          <TranslationProvider>
            <TooltipProvider>
              <BlazeHeader variant="site" />
              <div className="pt-20">
                <PageTransition>{children}</PageTransition>
              </div>
            </TooltipProvider>
          </TranslationProvider>
        </BlazeLocaleProvider>
      </body>
    </html>
  );
}
