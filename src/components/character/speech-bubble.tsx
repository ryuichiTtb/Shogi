"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SpeechBubbleProps {
  text: string;
  isVisible: boolean;
  className?: string;
}

export function SpeechBubble({ text, isVisible, className }: SpeechBubbleProps) {
  const [displayText, setDisplayText] = useState("");
  const [charIndex, setCharIndex] = useState(0);

  // タイプライター効果
  useEffect(() => {
    if (!isVisible || !text) {
      setDisplayText("");
      setCharIndex(0);
      return;
    }

    setDisplayText("");
    setCharIndex(0);
  }, [text, isVisible]);

  useEffect(() => {
    if (!isVisible || charIndex >= text.length) return;

    const timer = setTimeout(() => {
      setDisplayText(text.slice(0, charIndex + 1));
      setCharIndex(charIndex + 1);
    }, 30);

    return () => clearTimeout(timer);
  }, [charIndex, text, isVisible]);

  if (!isVisible || !text) return null;

  return (
    <div
      className={cn(
        "relative bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2",
        "shadow-md text-sm max-w-48",
        "before:content-[''] before:absolute before:top-4 before:-left-3",
        "before:border-8 before:border-transparent before:border-r-gray-300 dark:before:border-r-gray-600",
        "after:content-[''] after:absolute after:top-4 after:-left-2",
        "after:border-8 after:border-transparent after:border-r-white dark:after:border-r-gray-800",
        className
      )}
    >
      <p className="text-gray-800 dark:text-gray-200 min-h-4 line-clamp-3">{displayText}</p>
    </div>
  );
}
