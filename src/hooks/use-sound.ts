"use client";

import { useEffect, useRef, useCallback, useState } from "react";

import { SFX_FILES } from "@/lib/audio/manifest";

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

// Step 4 (Issue #107): Howler の AudioContext を early unlock するヘルパ。
// Safari 等は autoplay policy で AudioContext が suspended のまま開始される
// ため、ユーザージェスチャ (対局開始ボタン onClick 等) で resume() を明示
// 呼出する必要がある。これを呼ばないと最初の SE が無音になる/遅延する。
//
// 動的 import 経由で Howler 本体をロードした上で Howler.ctx?.resume() を await。
// 既に ロード済みの場合は再 import が cache hit するため軽い。
export async function prepareAudio(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const mod = (await import("howler")) as unknown as {
      Howler: { ctx?: AudioContext | null };
    };
    const ctx = mod.Howler?.ctx;
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }
  } catch {
    // Howler 未対応環境 / 動的 import 失敗時は無視 (SE 自体が動かない)
  }
}

export function useSound() {
  const [isMuted, setIsMuted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const sfxCacheRef = useRef<Map<string, HowlInstance>>(new Map());
  const HowlRef = useRef<HowlConstructor | null>(null);

  // Howlをクライアントサイドのみでロード（全SFXを事前ロードして同時再生のズレを防ぐ）
  useEffect(() => {
    import("howler").then(({ Howl }) => {
      const HowlCtor = Howl as unknown as HowlConstructor;
      HowlRef.current = HowlCtor;

      // 全SFXを事前生成してキャッシュ（初回再生時のロード遅延をなくす）
      Object.entries(SFX_FILES).forEach(([key, src]) => {
        sfxCacheRef.current.set(key, new HowlCtor({ src: [src], volume: 0.7 }));
      });

      setIsReady(true);
    });
  }, []);

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
    setIsMuted((prev) => !prev);
  }, []);

  return { playSfx, toggleMute, isMuted, isReady };
}
