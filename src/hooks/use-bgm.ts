"use client";

// Issue #79 (PR 1.7): BGM 再導入。各 page で `useBgm(eventKey)` を呼ぶと
// 該当 BGM が ループ再生され、page 遷移時に新 BGM へ 500ms クロスフェード。
//
// アプリ全体で BGM は 1 つだけ再生 (module-level singleton)。
// 複数 page が同時に呼んでも最後の eventKey が勝つ。
//
// 過去 (issue #79 以前) の BGM 削除は競合バグ (HowlRef.current null +
// useEffect deps 不変で再実行されない) によるものだった。本実装は:
//   1. bgmReady state を useEffect deps に含めて Howler ロード完了を待つ
//   2. module-level Howl Ctor キャッシュで複数 useBgm 間共有
//   3. 初回 user gesture を window で 1 回 listen → AudioContext unlock
//   4. 切替時に旧 Howl を unload() で Web Audio buffer 解放 (メモリ蓄積防止)
//   5. setBgmMuted で SFX mute (toggleMute) と連動可能

import { useEffect, useState } from "react";

import { prepareAudio } from "@/hooks/use-sound";
import {
  getEffectiveBgmPath,
  useBgmOverrides,
  type BgmEventKey,
} from "@/lib/dev/sound-overrides";

const BGM_VOLUME = 0.3;
const FADE_DURATION_MS = 500;

type HowlInstance = {
  play: () => number | undefined;
  stop: () => void;
  unload: () => void;
  volume: (vol?: number) => number | HowlInstance;
  fade: (from: number, to: number, duration: number) => HowlInstance;
};

type HowlConstructor = new (options: {
  src: string[];
  volume?: number;
  loop?: boolean;
  html5?: boolean;
  onloaderror?: () => void;
  onplayerror?: () => void;
}) => HowlInstance;

// モジュールレベルで Howler を 1 度だけロード (複数 useBgm 呼び出しで共有)
let HowlCtorPromise: Promise<HowlConstructor> | null = null;
function getHowlCtor(): Promise<HowlConstructor> {
  if (!HowlCtorPromise) {
    HowlCtorPromise = import("howler").then(
      ({ Howl }) => Howl as unknown as HowlConstructor,
    );
  }
  return HowlCtorPromise;
}

// アプリ全体で BGM は 1 つだけ再生される (singleton)。
let currentHowl: HowlInstance | null = null;
let currentKey: BgmEventKey | null = null;
let isMuted = false;

// 初回 user gesture を待つフラグ (Safari/iOS の autoplay policy 対策)
let userGestureReceived = false;
let pendingKey: BgmEventKey | null = null;

if (typeof window !== "undefined") {
  const onFirstGesture = () => {
    userGestureReceived = true;
    void prepareAudio(); // AudioContext resume
    if (pendingKey !== null) {
      const key = pendingKey;
      pendingKey = null;
      void startBgm(key);
    }
    window.removeEventListener("click", onFirstGesture);
    window.removeEventListener("touchstart", onFirstGesture);
    window.removeEventListener("keydown", onFirstGesture);
  };
  window.addEventListener("click", onFirstGesture, { once: true });
  window.addEventListener("touchstart", onFirstGesture, { once: true });
  window.addEventListener("keydown", onFirstGesture, { once: true });
}

async function startBgm(key: BgmEventKey | null): Promise<void> {
  const desiredPath = key ? getEffectiveBgmPath(key) : "";
  const currentPath = currentKey ? getEffectiveBgmPath(currentKey) : "";

  // 同じ key + 同じ path なら何もしない (Strict Mode 二重 effect でも no-op)
  if (currentKey === key && currentPath === desiredPath) return;

  // 旧 BGM を fade out → stop → unload (メモリ解放)
  const prev = currentHowl;
  if (prev) {
    const currentVol = prev.volume() as number;
    prev.fade(currentVol, 0, FADE_DURATION_MS);
    setTimeout(() => {
      prev.stop();
      prev.unload();
    }, FADE_DURATION_MS + 50);
  }

  if (!desiredPath) {
    // key が null または未割当 (空文字) → BGM 停止
    currentHowl = null;
    currentKey = null;
    return;
  }

  const HowlCtor = await getHowlCtor();
  const next = new HowlCtor({
    src: [desiredPath],
    volume: 0,
    loop: true,
    html5: true, // BGM はストリーミング (decode 軽量、メモリ常駐少)
    onloaderror: () => {
      if (currentHowl === next) {
        currentHowl = null;
        currentKey = null;
      }
    },
    onplayerror: () => {
      if (currentHowl === next) {
        currentHowl = null;
        currentKey = null;
      }
    },
  });
  next.play();
  const targetVol = isMuted ? 0 : BGM_VOLUME;
  next.fade(0, targetVol, FADE_DURATION_MS);
  currentHowl = next;
  currentKey = key;
}

/**
 * 各 page で呼ぶ。eventKey が変わると BGM 切替 (クロスフェード)、
 * null なら BGM 停止。
 *
 * 全 page で必ず呼ぶこと。呼ばない page があると前 page の BGM が
 * 鳴り続ける (singleton のため)。dev pages 等 BGM 不要な page では
 * `useBgm(null)` で明示停止する。
 */
export function useBgm(eventKey?: BgmEventKey | null): void {
  // overrides 変化に追従 (dev tool で割当変更時に即座にクロスフェード)
  const overrides = useBgmOverrides();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getHowlCtor().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const key = eventKey ?? null;
    if (!userGestureReceived) {
      // gesture 前は pending に積んでおく、unlock 時に再生開始
      pendingKey = key;
      return;
    }
    void startBgm(key);
    // ★ cleanup なし: ページ遷移時に音を切らない (次の useBgm 呼出で自動切替)
  }, [ready, eventKey, overrides]);
}

/**
 * useSound の toggleMute から呼ぶ。SFX/BGM 同時 mute/unmute。
 */
export function setBgmMuted(muted: boolean): void {
  isMuted = muted;
  if (currentHowl) {
    currentHowl.volume(muted ? 0 : BGM_VOLUME);
  }
}
