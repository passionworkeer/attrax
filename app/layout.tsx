import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnimatePresence, motion } from "framer-motion";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Blaze Hawks · 想出海？先烧毁！",
  description: "AI 合规风险智能扫描",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} h-full antialiased`} data-scroll-behavior="smooth">
      <body className="min-h-full">
        <TooltipProvider>
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </TooltipProvider>
      </body>
    </html>
  );
}
