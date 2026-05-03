// Issue #117: 全ページ共通の入りアニメーション (fade + slide-up) ラッパ。
// SSR 段階で opacity:0 を送って FOUC を起こさないよう、
// mounted フラグを useEffect で立て、ハイドレーション完了後にだけ animate する。
"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface PageMotionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageMotion({ children, className }: PageMotionProps) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <motion.div
      className={className}
      initial={mounted && !reduce ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
