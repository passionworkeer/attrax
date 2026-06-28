"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

interface PageTransitionProps {
  children: React.ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  // AnimatePresence `mode="wait"` keys on the direct child to decide when to
  // run exit→enter. Without an explicit `key`, every route renders the same
  // motion.div identity, so route changes never trigger the exit animation —
  // the new page just mounts in place. Keying on `pathname` makes each route
  // a distinct node so framer-motion animates the old tree out, then the new
  // one in. (See framer-motion docs: AnimatePresence needs a unique key on
  // each direct child to track mount/unmount.)
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}