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
//
// Issue #189 Phase 3-1: ミュート設定を localStorage で永続化する。
// 既存 sound-overrides.ts のパターン (useSyncExternalStore + storage event)
// に倣う。SSR では false 固定、Hydration 後に storage 値で更新。
// 同一タブ・別タブいずれの変更も singleton (setBgmMuted / setSfxMuted) に
// 即時反映する。

import { useCallback, useEffect, useSyncExternalStore } from "react";

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

// =====================
// mute 状態の永続化 (Issue #189 Phase 3-1)
// =====================

const MUTED_STORAGE_KEY = "shogi-sound:muted";

let cachedMuted: boolean | null = null;
const mutedListeners = new Set<() => void>();

function readMutedStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getMutedSnapshot(): boolean {
  if (cachedMuted === null) cachedMuted = readMutedStorage();
  return cachedMuted;
}

function getMutedServerSnapshot(): boolean {
  // SSR では mute 状態を持たない (UI 上は音あり扱いで render し、Hydration 後に
  // storage 値で再レンダリングする)
  return false;
}

function subscribeMuted(listener: () => void): () => void {
  mutedListeners.add(listener);
  return () => {
    mutedListeners.delete(listener);
  };
}

function applyMutedToSingletons(muted: boolean): void {
  setBgmMuted(muted);
  setSfxMuted(muted);
}

function persistMutedAndNotify(next: boolean): void {
  cachedMuted = next;
  if (typeof window !== "undefined") {
    try {
      if (next) {
        localStorage.setItem(MUTED_STORAGE_KEY, "true");
      } else {
        // false は明示保存しない (デフォルトと同じため、storage を削減)
        localStorage.removeItem(MUTED_STORAGE_KEY);
      }
    } catch {
      // quota / private mode 等は無視
    }
  }
  applyMutedToSingletons(next);
  mutedListeners.forEach((l) => l());
}

// 別タブからの storage event 購読 (sound-overrides.ts と同じパターン)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== MUTED_STORAGE_KEY && e.key !== null) return;
    const fresh = readMutedStorage();
    cachedMuted = fresh;
    applyMutedToSingletons(fresh);
    mutedListeners.forEach((l) => l());
  });
}

export function useSound() {
  const isMuted = useSyncExternalStore(
    subscribeMuted,
    getMutedSnapshot,
    getMutedServerSnapshot,
  );

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
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 初回 mount で localStorage の mute 値を singleton (audio-engine / use-bgm)
  // に反映する。Hydration 直後に既に mute=true で永続化されていれば、SFX/BGM
  // が即座に消音される。useEffect mount は 1 回だけ。
  useEffect(() => {
    applyMutedToSingletons(getMutedSnapshot());
  }, []);

  const playSfx = useCallback((sound: keyof typeof SFX_FILES) => {
    const src = getEffectiveSfxPath(sound as SfxEventKey);
    if (!src) return;
    playSfxBuffer(src);
  }, []);

  const toggleMute = useCallback(() => {
    persistMutedAndNotify(!getMutedSnapshot());
  }, []);

  // SFX のプリロードは mount 時に走るため、ここでは「ハンドル取得時点で
  // 呼び出せる」ことを示す互換フラグとして常に true を返す (Howler 時代は
  // 動的 import の完了を待っていたが Web Audio 直接実装ではその必要がない)
  const isReady = true;

  return { playSfx, toggleMute, isMuted, isReady };
}

// =====================
// test-only
// =====================

export const __forTest = {
  resetMuted: (): void => {
    cachedMuted = null;
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(MUTED_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  },
  getMutedSnapshot,
  persistMutedAndNotify,
  readMutedStorage,
  MUTED_STORAGE_KEY,
};
