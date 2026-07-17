"use client";

import Link from "next/link";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { getBlazeCopy } from "@/lib/mock/blaze-copy";

export function BlazeFooter() {
  const { locale } = useBlazeLocale();
  const copy = getBlazeCopy(locale);

  return (
    <footer className="mt-16 border-t border-white/6 bg-[rgba(5,10,19,0.92)]">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-10 px-6 py-12 md:grid-cols-4">
        <div className="col-span-2 md:col-span-4">
          <div className="text-xl font-black italic text-white">Blaze Hawks</div>
        </div>
        <div className="flex flex-col gap-4 text-sm text-white/48">
          {copy.footer.links1.map((item) => (
            <Link key={item} href="/" className="transition hover:text-[var(--blaze-orange)]">
              {item}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-4 text-sm text-white/48">
          {copy.footer.links2.map((item) => (
            <Link key={item} href="/" className="transition hover:text-[var(--blaze-orange)]">
              {item}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-4 text-sm text-white/48">
          {copy.footer.links3.map((item) => (
            <Link key={item} href="/" className="transition hover:text-[var(--blaze-orange)]">
              {item}
            </Link>
          ))}
        </div>
        <div className="col-span-2 border-t border-white/8 pt-8 md:col-span-4">
          <p className="text-sm text-white/38">{copy.footer.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
