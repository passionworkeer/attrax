import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { BlazeLocaleProvider } from "@/components/blaze-hawks/locale";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  title: "规航AI · 先合规，再出海",
  description: "上传真实产品图片，识别目标市场并生成可追溯、可解释的全球合规航线。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      className={`${manrope.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <BlazeLocaleProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </BlazeLocaleProvider>
      </body>
    </html>
  );
}
