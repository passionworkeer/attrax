import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import SiteHeader from "@/components/SiteHeader";
import PageTransition from "@/components/PageTransition";
import { TranslationProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attrax · Think Before You Expand",
  description: "AI-powered compliance risk scanning for cross-border e-commerce",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className="h-full antialiased dark" data-scroll-behavior="smooth">
      <body className="min-h-full">
        <TranslationProvider>
          <TooltipProvider>
            <SiteHeader />
            <div className="pt-20">
              <PageTransition>{children}</PageTransition>
            </div>
          </TooltipProvider>
        </TranslationProvider>
      </body>
    </html>
  );
}
