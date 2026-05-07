"use client";

import { useEffect, useRef, useCallback, useState } from "react";

import { SFX_FILES } from "@/lib/audio/manifest";
import { setBgmMuted } from "@/hooks/use-bgm";

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

// =====================
// playSfxOnce: 軽量な module-level SFX プレイヤー
// =====================
//
// Issue #79 派生: useSound は mount 時に SFX_FILES 全件 (~24 個) の Howl を
// 一気に preload するため、対局画面のような頻繁に再生する component には
// 適しているが、画面遷移ボタン (MaskedLink / CardShogiTiles 等) のような
// 「ごくまれに 1 種類だけ鳴らす」軽量用途には Howl 大量生成のオーバーヘッドが
// 重い (page 中の全 link が個別に useSound すると 24 × N の Howl 構築)。
//
// この関数は呼ばれた sound key の Howl だけを lazy-create + 共有 cache に
// 保持する。useSound と独立した singleton で、mute 状態は setSfxOnceMuted
// 経由で同期される (useSound.toggleMute から呼ばれる)。

let sfxOnceMuted = false;
const sfxOnceCache = new Map<string, HowlInstance>();
let sfxOnceCtorPromise: Promise<HowlConstructor> | null = null;

/**
 * useSound の mute 状態を本 singleton にも反映する。useSound.toggleMute から呼ぶ。
 */
export function setSfxOnceMuted(muted: boolean): void {
  sfxOnceMuted = muted;
}

/**
 * 指定 SFX を 1 度再生する軽量ヘルパ。
 * - 未 cache なら lazy-create して再生
 * - mute 中は skip
 * - 連打時は既存再生を stop してから play (重なり防止)
 */
export function playSfxOnce(soundKey: keyof typeof SFX_FILES): void {
  if (typeof window === "undefined") return;
  if (sfxOnceMuted) return;
  const src = SFX_FILES[soundKey];
  if (!src) return;

  if (!sfxOnceCtorPromise) {
    sfxOnceCtorPromise = import("howler").then(
      ({ Howl }) => Howl as unknown as HowlConstructor,
    );
  }
  void sfxOnceCtorPromise.then((HowlCtor) => {
    let howl = sfxOnceCache.get(soundKey);
    if (!howl) {
      howl = new HowlCtor({ src: [src], volume: 0.7 });
      sfxOnceCache.set(soundKey, howl);
    }
    try {
      howl.stop();
      howl.play();
    } catch {
      // Howler 内部エラーは無視
    }
  });
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
      // 空文字 src (未割当 event) は preload skip して 404 を防ぐ。
      Object.entries(SFX_FILES).forEach(([key, src]) => {
        if (!src) return;
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
    setIsMuted((prev) => {
      const next = !prev;
      // Issue #79: BGM / playSfxOnce singleton にも mute 連動
      setBgmMuted(next);
      setSfxOnceMuted(next);
      return next;
    });
  }, []);

  return { playSfx, toggleMute, isMuted, isReady };
}
