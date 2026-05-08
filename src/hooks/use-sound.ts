"use client";

// Issue #189: SFX を Web Audio API 直接実装に置換。Howler は本番経路から
// 完全に外し、dev/sound-tuner の use-preview-player.ts のみ Howler を維持
// する (seek/duration UI のため)。
//
// 設計の根拠:
// - Howler の autoUnlock タイミングが不透明で、モバイル Safari の初回 SFX が
//   無音/遅延する症状が残っていた (Issue #79 の保留課題)
// - playSfxBuffer / playSfxBufferOnce 内部で `void unlockAudio()` を呼ぶ
//   ことで、SFX 呼出自体が user gesture 同期で AudioContext を resume する
// - useSound 経路と playSfxOnce 経路の Howl キャッシュ分裂と
//   setSfxOnceMuted の二重同期を解消し、audio-engine 1 系統に統合した
//
// 既存呼出 API (playSfx / toggleMute / isMuted / prepareAudio / playSfxOnce /
// useSound の戻り値) は維持しているため、shogi-game / card-shogi-game /
// deck-editor-pane / masked-link / page / match-setup の書換は不要。

import { useCallback, useEffect, useState } from "react";

import { setBgmMuted } from "@/hooks/use-bgm";
import {
  loadSfxBuffer,
  playSfxBuffer,
  playSfxBufferOnce,
  setSfxMuted,
  unlockAudio,
} from "@/lib/audio/audio-engine";
import { SFX_FILES } from "@/lib/audio/manifest";
import {
  getEffectiveSfxPath,
  type SfxEventKey,
} from "@/lib/dev/sound-overrides";

/**
 * AudioContext を unlock する。ボタン onClick 等の user gesture 内で await
 * すれば iOS Safari でも以降の SFX が確実に鳴る。playSfx / playSfxOnce 内部
 * でも fire-and-forget で unlock を試みるため、await が必要なケース
 * (= 対局開始ボタンで遷移直後に SE を確実に鳴らしたい等) のみ明示呼出する。
 */
export async function prepareAudio(): Promise<void> {
  await unlockAudio();
}

/**
 * SFX を 1 度再生する軽量ヘルパ。連打時は同 key の重なりを防ぐ。
 * 画面遷移ボタン (MaskedLink / page.tsx 等) の軽量用途で利用する。
 */
export function playSfxOnce(soundKey: keyof typeof SFX_FILES): void {
  if (typeof window === "undefined") return;
  // dev override (空文字 = 明示 unassign) を解決して empty なら no-op
  const src = getEffectiveSfxPath(soundKey as SfxEventKey);
  if (!src) return;
  playSfxBufferOnce(src);
}

export function useSound() {
  const [isMuted, setIsMutedState] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // mount 時に SFX を AudioBuffer にプリ decode する。useAssetPreloader が
  // ロビーで HTTP fetch までは終わらせている前提で、ここでは cache hit +
  // decode のみで済むケースが多い。失敗したキーは skip するため Promise.allSettled。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tasks = Object.values(SFX_FILES)
        .filter(Boolean)
        .map((p) => loadSfxBuffer(p));
      await Promise.allSettled(tasks);
      if (!cancelled) {
        setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const playSfx = useCallback((sound: keyof typeof SFX_FILES) => {
    const src = getEffectiveSfxPath(sound as SfxEventKey);
    if (!src) return;
    playSfxBuffer(src);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMutedState((prev) => {
      const next = !prev;
      // BGM (use-bgm.ts) と SFX (audio-engine.ts) の singleton にも反映
      setBgmMuted(next);
      setSfxMuted(next);
      return next;
    });
  }, []);

  return { playSfx, toggleMute, isMuted, isReady };
}
