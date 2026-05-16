import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import PageTransition from "@/components/PageTransition";
import { TranslationProvider } from "@/lib/i18n";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Blaze Hawks · Think Before You Expand",
  description: "AI-powered compliance risk scanning for cross-border e-commerce",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className={`${inter.variable} h-full antialiased`} data-scroll-behavior="smooth">
      <body className="min-h-full">
        <TranslationProvider>
          <TooltipProvider>
            <div className="fixed top-4 right-4 z-50">
              <LanguageSwitcher />
            </div>
            <PageTransition>{children}</PageTransition>
          </TooltipProvider>
        </TranslationProvider>
      </body>
    </html>
  );
}