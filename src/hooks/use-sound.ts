"use client";

import { useEffect, useRef, useCallback, useState } from "react";

// Howler.jsのSSR対応（サーバーサイドでは何もしない）
type HowlInstance = {
  play: () => number | undefined;
  stop: () => void;
  volume: (vol?: number) => number | HowlInstance;
  loop: (loop?: boolean) => boolean | HowlInstance;
  fade: (from: number, to: number, duration: number) => HowlInstance;
};

type HowlConstructor = new (options: {
  src: string[];
  volume?: number;
  loop?: boolean;
  html5?: boolean;
}) => HowlInstance;

const SFX_FILES: Record<string, string> = {
  piece_move: "/sounds/piece-move.mp3",
  piece_capture: "/sounds/piece-capture.mp3",
  piece_promote: "/sounds/piece-promote.mp3",
  piece_drop: "/sounds/piece-drop.mp3",
  check: "/sounds/check.mp3",
  game_over: "/sounds/game-over.wav",
};

export function useSound(bgmTrack?: string) {
  const [isMuted, setIsMuted] = useState(false);
  const bgmRef = useRef<HowlInstance | null>(null);
  const sfxCacheRef = useRef<Map<string, HowlInstance>>(new Map());
  const HowlRef = useRef<HowlConstructor | null>(null);

  // Howlをクライアントサイドのみでロード
  useEffect(() => {
    import("howler").then(({ Howl }) => {
      HowlRef.current = Howl as unknown as HowlConstructor;
    });

    return () => {
      bgmRef.current?.stop();
    };
  }, []);

  // BGMの切り替え
  useEffect(() => {
    if (!bgmTrack || !HowlRef.current || typeof window === "undefined") return;

    bgmRef.current?.fade(1, 0, 500);
    const prev = bgmRef.current;
    setTimeout(() => prev?.stop(), 500);

    const newBgm = new HowlRef.current({
      src: [bgmTrack],
      volume: isMuted ? 0 : 0.3,
      loop: true,
      html5: true,
    });

    bgmRef.current = newBgm;
    if (!isMuted) newBgm.play();

    return () => {
      newBgm.stop();
    };
  }, [bgmTrack]);

  const playSfx = useCallback(
    (sound: keyof typeof SFX_FILES) => {
      if (isMuted || !HowlRef.current || typeof window === "undefined") return;

      const src = SFX_FILES[sound];
      if (!src) return;

      let howl = sfxCacheRef.current.get(sound);
      if (!howl) {
        howl = new HowlRef.current({ src: [src], volume: 0.7 });
        sfxCacheRef.current.set(sound, howl);
      }

      howl.play();
    },
    [isMuted]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (bgmRef.current) {
        bgmRef.current.volume(next ? 0 : 0.3);
      }
      return next;
    });
  }, []);

  return { playSfx, toggleMute, isMuted };
}
