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
//   3. 切替時に旧 Howl を unload() で Web Audio buffer 解放 (メモリ蓄積防止)
//   4. setBgmMuted で SFX mute (toggleMute) と連動可能
//
// Issue #79 派生 (BGM スタートラグ解消):
//   旧実装は明示的な user gesture を window で待ってから BGM 開始していたが、
//   ホーム画面に着地してもクリックするまで BGM が鳴らないラグがあった。
//   現在は Howler 内蔵の autoUnlock (default true) に任せ、マウントと同時に
//   play() を呼ぶ。autoplay policy で blocked される環境でも Howler が次の
//   user interaction で自動的に再生開始してくれる。

import { useEffect, useState } from "react";

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
  onend?: () => void;
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
let currentResolvedPath = ""; // 現在再生中 path (dev override 切替検知用)
let isMuted = false;

// shouldLoop の最新値 (mutable ref)。useBgm 呼出毎に更新。
// onend ハンドラ内でこの値を read して loop 継続判定する。
// Issue #79 派生: 対局画面で「対局中ならループ、対局終了なら現在の loop で
// 自然停止」を実現する。lobby BGM は永続 loop のため default true。
let shouldLoopFlag = true;

async function startBgm(
  key: BgmEventKey | null,
  path: string,
): Promise<void> {
  // path が同一なら audio をリスタートせず key のみ更新する。
  // 例: home (bgm_home) → /play (bgm_match_setup) の遷移で
  // 同一 BGM_FILES 値が割り当てられていれば連続再生になる。
  if (currentResolvedPath === path) {
    currentKey = key;
    return;
  }

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

  if (!path) {
    // key が null または path が空 → BGM 停止
    currentHowl = null;
    currentKey = null;
    currentResolvedPath = "";
    return;
  }

  const HowlCtor = await getHowlCtor();
  // Issue #79: 自前で loop 制御するため Howler の loop は false 固定。
  // onend で shouldLoopFlag を確認して replay or stop を選択する。
  // これにより「対局終了 → 現在の loop は完了させてから停止」の挙動が可能。
  const next = new HowlCtor({
    src: [path],
    volume: 0,
    loop: false,
    html5: true, // BGM はストリーミング (decode 軽量、メモリ常駐少)
    onloaderror: () => {
      if (currentHowl === next) {
        currentHowl = null;
        currentKey = null;
        currentResolvedPath = "";
      }
    },
    onplayerror: () => {
      if (currentHowl === next) {
        currentHowl = null;
        currentKey = null;
        currentResolvedPath = "";
      }
    },
    onend: () => {
      // 既に新しい Howl に交代済 (= startBgm 呼出による fade out 中) なら無視
      if (currentHowl !== next) return;
      if (shouldLoopFlag) {
        // loop 継続: 同じ Howl をもう一度 play (volume はそのまま)
        next.play();
      } else {
        // 自然停止: state クリア + リソース解放
        try {
          next.unload();
        } catch {
          // 既に unload 済等は無視
        }
        if (currentHowl === next) {
          currentHowl = null;
          currentKey = null;
          currentResolvedPath = "";
        }
      }
    },
  });
  next.play();
  const targetVol = isMuted ? 0 : BGM_VOLUME;
  next.fade(0, targetVol, FADE_DURATION_MS);
  currentHowl = next;
  currentKey = key;
  currentResolvedPath = path;
}

/**
 * BGM 解決ルール (eventKey が non-null の場合):
 *   1. dev tool でユーザが override 設定済 → その path (空文字 = 「鳴らさない」)
 *   2. BGM_FILES[eventKey] (manifest 既定) が non-empty → その path
 *   3. いずれもなければ BGM 停止 (無音)
 *
 * eventKey が null/undefined → BGM 停止 (sound preference OFF 等)。
 */

/**
 * useBgm のオプション。
 */
export interface UseBgmOptions {
  /**
   * BGM の再生終了時に loop するかどうか (default: true)。
   * - true: 再生終了時に同じ Howl を再 play (永続 loop)
   * - false: 再生終了時に自然停止 (Howl unload + state クリア)
   *
   * 対局画面で「対局終了したら現在の loop は完了させた上で停止」を
   * 実現する用途で使う。lobby BGM のような永続 loop 用途では省略可。
   */
  shouldLoop?: boolean;
}

/**
 * 各 page で呼ぶ。eventKey が変わると BGM 切替 (クロスフェード)、
 * null なら BGM 停止。
 *
 * 全 page で必ず呼ぶこと。呼ばない page があると前 page の BGM が
 * 鳴り続ける (singleton のため)。dev pages 等 BGM 不要な page では
 * `useBgm(null)` で明示停止する。
 */
export function useBgm(
  eventKey?: BgmEventKey | null,
  options?: UseBgmOptions,
): void {
  // overrides 変化に追従 (dev tool で割当変更時に即座にクロスフェード)
  const overrides = useBgmOverrides();
  const [ready, setReady] = useState(false);
  const shouldLoop = options?.shouldLoop ?? true;

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
    // shouldLoopFlag を最新化 (onend が読む module-level singleton)
    shouldLoopFlag = shouldLoop;
    const key = eventKey ?? null;
    const path = key ? getEffectiveBgmPath(key) : "";
    // Howler の autoUnlock (default true) が autoplay policy を自動ハンドル
    // するため、user gesture を明示的に待たずに即時 play() を試行する。
    // 環境により blocked された場合も Howler が次の interaction で resume する。
    void startBgm(key, path);
    // ★ cleanup なし: ページ遷移時に音を切らない (次の useBgm 呼出で自動切替)
  }, [ready, eventKey, overrides, shouldLoop]);
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
