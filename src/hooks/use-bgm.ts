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
  // Issue #79 派生 (BGM プールリーク修正): Howler 標準 loop を使うため
  // 動的 setter として loop(value) を呼べる必要がある。
  loop: (value?: boolean) => boolean | HowlInstance;
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
// 新規 Howl 構築時の loop 初期値として使う。useBgm 内で値が変わったら
// currentHowl.loop(value) を即時呼び出して Howler に反映する。
let shouldLoopFlag = true;

// =====================
// bfcache (browser back-forward cache) 復帰時のハンドリング
// =====================
//
// 旧来挙動: ページを閉じて戻ると JS module state は保持されるが、HTMLAudioElement
// は autoplay policy で suspended/locked になり、play() を呼んでも音が出ない
// ("HTML5 Audio pool exhausted, returning potentially locked audio object" エラー
// が出る場合あり)。
//
// 対策: pageshow イベント (event.persisted=true) を検知して既存 Howl を破棄し、
// useBgm の次回再評価で新規 Howl を作り直すことでロック状態を解消する。
function discardCurrentHowl(): void {
  const cur = currentHowl;
  if (!cur) return;
  try {
    cur.stop();
    cur.unload();
  } catch {
    // 既に解放済等は無視
  }
  currentHowl = null;
  currentKey = null;
  currentResolvedPath = "";
}

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    // bfcache から復帰 → 既存 Howl は autoplay locked の可能性あり。
    // 旧 Howl の key/path を記憶した上で破棄 → 同じ key/path で再構築する。
    // (同 path なら useBgm useEffect は値変化なしで効果再発火しないため、
    //  ここで明示的に startBgm を呼んで再生再開する必要がある)
    const restoreKey = currentKey;
    const restorePath = currentResolvedPath;
    discardCurrentHowl();
    if (restorePath) {
      void startBgm(restoreKey, restorePath);
    }
  });
}

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
  // Issue #79 派生 (BGM プールリーク修正):
  // 旧: loop:false + onend で next.play() 手動 loop → 反復毎に Howler が新規
  //     sound ID + HTMLAudioElement をプールから確保 → 数十周で
  //     "HTML5 Audio pool exhausted" エラーが発生し再生不能に。
  // 新: Howler 標準 loop:true で構築。Howler 内部で seek(0) リセット再生する
  //     ためプール非使用。shouldLoop が false に変わったら currentHowl.loop(false)
  //     を即時呼び、現在の loop 完了で onend 発火 → unload + state クリア。
  const next = new HowlCtor({
    src: [path],
    volume: 0,
    loop: shouldLoopFlag,
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
      // 既に新しい Howl に交代済 (= startBgm 呼出による fade out 中) なら無視。
      // loop:true 中は Howler 内部で自動 loop され、onend は呼ばれない。
      // shouldLoop=false に切替えた後の最終 end でここに到達 → 自然停止。
      if (currentHowl !== next) return;
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
    // shouldLoopFlag を最新化 (新規 Howl 構築時の loop 初期値として使う)
    shouldLoopFlag = shouldLoop;
    // 既に再生中の Howl があれば loop 属性を即時更新する。
    // shouldLoop が true→false に変わると Howler が現在の loop 完了時に
    // onend を発火 → unload + state クリアの自然停止フローに繋がる。
    if (currentHowl) {
      try {
        currentHowl.loop(shouldLoop);
      } catch {
        // 万一 Howl が既に unload 済等は無視
      }
    }
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
