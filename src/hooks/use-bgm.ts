"use client";

// Issue #79 (PR 1.7): BGM 機構。各 page で `useBgm(eventKey)` を呼ぶと
// 該当 BGM がループ再生され、page 遷移時に新 BGM へクロスフェード。
//
// アプリ全体で BGM は 1 つだけ再生 (module-level singleton)。
//
// === 実装方針 (Howler から HTMLAudioElement 直接に移行) ===
//
// 当初は Howler で実装していたが、html5: true モードの autoplay 周りの挙動
// (autoUnlock 完了タイミング、onplayerror の用途複雑性、pool 管理の不透明性、
// HTMLAudioElement.loop 属性が伝播しないバグ等) で安定動作させるのが困難
// だったため、HTMLAudioElement 直接利用に切替えた。
//
// 利点:
//   - audio.play() が Promise を返すため成功/失敗を確実に検知できる
//   - autoplay block 時は明示的に NotAllowedError で reject される
//   - audio.loop = true が native に動作し、ended イベント不要で永続 loop
//   - 状態管理が単純 (audio.paused / audio.currentTime / etc. が直接見える)
//
// 設計:
//   1. play() Promise 成功 → BGM 再生中。fade-in 開始。
//   2. play() Promise reject (autoplay block) → window で user gesture を listen し
//      gesture 後に play() リトライ。リトライ成功で listener 撤去。
//   3. shouldLoop が true→false に変わったら audio.loop=false にし、現在の loop
//      完了時に ended イベント → 自然停止 + state クリア。
//   4. eventKey 変化で path が違えば 旧 audio fade-out + 新 audio fade-in。
//   5. bfcache (pageshow.persisted=true) では既存 audio を破棄して再構築。

import { useEffect } from "react";

import {
  getEffectiveBgmPath,
  useBgmOverrides,
  type BgmEventKey,
} from "@/lib/dev/sound-overrides";

const BGM_VOLUME = 0.3;
const FADE_DURATION_MS = 500;
// Issue #189: バックグラウンド遷移時の fade-out は短め (ページが unload される
// ケースでも完了する時間)。
const HIDE_FADE_MS = 200;

// =====================
// シングルトン state
// =====================
//
// 1 アプリ 1 BGM。currentAudio は再生中の HTMLAudioElement。
let currentAudio: HTMLAudioElement | null = null;
let currentKey: BgmEventKey | null = null;
let currentResolvedPath = "";
let isMuted = false;
let shouldLoopFlag = true;

// 進行中の fade を識別するトークン (新しい fade で旧 fade を中断するため)
let activeFadeId = 0;

// Issue #189: hidden に入る直前に再生中だったかを記録し、visible 復帰で
// 自動的に再開するためのフラグ。pause を能動的に呼んだのか、ユーザー操作で
// 既に止まっていたのかを区別するために必要。
let wasPlayingBeforeHidden = false;

// Issue #189 派生: モバイル Safari で navigation 後に autoplay block されない
// よう、画面遷移ボタンの user gesture 内で「次画面 BGM の audio element を
// 一度 play() して unlock 済み状態にした後 pause しておく」仕組み。
// 遷移後の useBgm が startBgm を呼ぶ時に preparedAudio を再利用すれば、その
// 再 play() は同 audio element の 2 回目以降の呼出のため autoplay block されない。
let preparedAudio: HTMLAudioElement | null = null;
let preparedPath = "";

// =====================
// fade ヘルパ
// =====================

function fadeVolume(
  audio: HTMLAudioElement,
  from: number,
  to: number,
  durationMs: number,
): void {
  // 同 audio に対する旧 fade を中断するため id 採番
  const myId = ++activeFadeId;
  audio.volume = Math.max(0, Math.min(1, from));
  if (durationMs <= 0 || from === to) {
    audio.volume = Math.max(0, Math.min(1, to));
    return;
  }
  const startTs = performance.now();
  const tick = (now: number): void => {
    // 別の fade が始まった、または audio が差し替わった → 中断
    if (myId !== activeFadeId) return;
    const t = Math.min(1, (now - startTs) / durationMs);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) {
      window.requestAnimationFrame(tick);
    }
  };
  window.requestAnimationFrame(tick);
}

// =====================
// 旧 audio の安全な破棄
// =====================

function destroyAudio(audio: HTMLAudioElement): void {
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {
    // 既に解放済等は無視
  }
}

// =====================
// startBgm: メインの遷移ロジック
// =====================

function startBgm(key: BgmEventKey | null, path: string): void {
  if (typeof window === "undefined") return;

  // path が同一なら audio をリスタートせず key/loop のみ更新する。
  // 例: home (bgm_home) → /play (bgm_match_setup) で同一 BGM_FILES 値を
  // 設定していれば、audio をそのまま継続再生する (リスタートなし)。
  if (currentResolvedPath === path) {
    currentKey = key;
    if (currentAudio) {
      try {
        currentAudio.loop = shouldLoopFlag;
      } catch {
        // ignore
      }
    }
    return;
  }

  // 旧 audio を fade out → destroy
  const prev = currentAudio;
  if (prev) {
    fadeVolume(prev, prev.volume, 0, FADE_DURATION_MS);
    window.setTimeout(() => destroyAudio(prev), FADE_DURATION_MS + 50);
  }

  if (!path) {
    // 停止
    currentAudio = null;
    currentKey = null;
    currentResolvedPath = "";
    return;
  }

  // 新 audio 作成 (prepared audio が同 path で残っていれば再利用)
  let audio: HTMLAudioElement;
  if (preparedPath === path && preparedAudio) {
    // user gesture 内で 1 度 play() 経験済みの audio。再 play() は autoplay block
    // されにくい。currentTime は 0 のまま (まだ実音は流れていない)。
    audio = preparedAudio;
    preparedAudio = null;
    preparedPath = "";
    try {
      audio.loop = shouldLoopFlag;
      // Issue #198: prepareBgmForNavigation で iOS Safari 対応のため muted=true で
      // unlock した状態。ここで解除して通常再生に戻す。
      audio.muted = false;
      audio.volume = 0;
      audio.currentTime = 0;
    } catch {
      // ignore
    }
  } else {
    audio = new Audio();
    // preload はネットワーク負荷を抑えるため metadata まで。play() で自動的に full load。
    audio.preload = "auto";
    audio.src = path;
    audio.loop = shouldLoopFlag;
    audio.volume = 0;
  }

  // shouldLoop=false で loop 終了時に自然停止 (state クリア)
  const onEnded = (): void => {
    if (currentAudio !== audio) return;
    if (audio.loop) return; // loop 中は fire しないが念のため
    destroyAudio(audio);
    if (currentAudio === audio) {
      currentAudio = null;
      currentKey = null;
      currentResolvedPath = "";
    }
  };
  audio.addEventListener("ended", onEnded);

  currentAudio = audio;
  currentKey = key;
  currentResolvedPath = path;

  // 再生試行 (Promise 返却で autoplay block を検知できる)
  const playPromise = audio.play();
  const targetVol = isMuted ? 0 : BGM_VOLUME;

  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        // 成功: fade-in
        if (currentAudio === audio) {
          fadeVolume(audio, 0, targetVol, FADE_DURATION_MS);
        }
      })
      .catch(() => {
        // autoplay block (NotAllowedError) や読込みエラー
        // → user gesture リトライハンドラを起動
        if (currentAudio === audio) {
          scheduleRetryOnUserGesture();
        }
      });
  }
}

// =====================
// user gesture でのリトライ
// =====================
//
// audio.play() が autoplay policy で reject された場合、user gesture を待って
// リトライする。リトライが成功するまで listener を attach し続ける。
// 成功した時点で listener 撤去。

let retryListenersAttached = false;

function attemptRetry(): void {
  if (!currentAudio) return;
  // 既に再生中なら何もしない (二重 play 防止)
  if (!currentAudio.paused) {
    detachRetryListeners();
    return;
  }
  const audio = currentAudio;
  const targetVol = isMuted ? 0 : BGM_VOLUME;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        if (currentAudio === audio) {
          fadeVolume(audio, audio.volume, targetVol, FADE_DURATION_MS);
        }
        detachRetryListeners();
      })
      .catch(() => {
        // まだ block されている → listener 保持 (次の gesture で再試行)
      });
  } else {
    // 旧ブラウザ: play が undefined を返す。再生開始したと仮定。
    fadeVolume(audio, audio.volume, targetVol, FADE_DURATION_MS);
    detachRetryListeners();
  }
}

function onUserGesture(): void {
  attemptRetry();
}

function attachRetryListeners(): void {
  if (retryListenersAttached) return;
  retryListenersAttached = true;
  window.addEventListener("click", onUserGesture);
  window.addEventListener("touchstart", onUserGesture);
  window.addEventListener("keydown", onUserGesture);
}

function detachRetryListeners(): void {
  if (!retryListenersAttached) return;
  retryListenersAttached = false;
  window.removeEventListener("click", onUserGesture);
  window.removeEventListener("touchstart", onUserGesture);
  window.removeEventListener("keydown", onUserGesture);
}

function scheduleRetryOnUserGesture(): void {
  attachRetryListeners();
}

// =====================
// ページ可視性: バックグラウンド時 BGM 停止 / 復帰時 自動フェードイン
// =====================
//
// Issue #189: モバイル iPhone Safari で別タブを開いたり、ホーム画面に戻ったり、
// 画面ロックした時に BGM が再生され続けてしまうのを防ぐ。
//
// 設計:
// - visibilitychange (hidden) → 200ms フェードアウト後に pause
// - visibilitychange (visible) → play() → 500ms フェードインで再開 (currentTime 維持)
// - pagehide (persisted=false) → 即時 pause (unload 直前なので fade を待たない)
// - bfcache 復帰 (pageshow.persisted=true) → 既存の audio 再構築経路に任せる
//
// mute=true 状態で hidden に入った場合: audio.paused === false (volume=0 で再生
// 継続中) → 「再生中扱い」と判定して pause、復帰時に fade 0→0 で再生継続する
// (ユーザーが mute を解除したら正しく音が鳴る状態を維持)。

function pauseForHidden(): void {
  if (!currentAudio) return;
  if (currentAudio.paused) return; // 既に停止
  wasPlayingBeforeHidden = true;
  const a = currentAudio;
  fadeVolume(a, a.volume, 0, HIDE_FADE_MS);
  // フェードアウト完了後に pause。途中で visible に戻ったら setTimeout 内で
  // visibilityState を再チェックして no-op にする。
  window.setTimeout(() => {
    if (currentAudio !== a) return;
    if (typeof document !== "undefined" && document.visibilityState !== "hidden") {
      return;
    }
    try {
      a.pause();
    } catch {
      // ignore
    }
  }, HIDE_FADE_MS + 30);
}

function resumeFromVisible(): void {
  if (!wasPlayingBeforeHidden) return;
  wasPlayingBeforeHidden = false;
  if (!currentAudio) return;
  const a = currentAudio;
  const targetVol = isMuted ? 0 : BGM_VOLUME;
  // フェードイン用に音量を 0 から開始 (HIDE_FADE_MS 完了前に visible 復帰した
  // 場合は volume が中途半端なので 0 にリセットして再 fade-in)。
  a.volume = 0;
  const playPromise = a.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        if (currentAudio === a) {
          fadeVolume(a, 0, targetVol, FADE_DURATION_MS);
        }
      })
      .catch(() => {
        // 復帰時 autoplay block (iOS で起こり得る) → user gesture 待ちリトライへ
        if (currentAudio === a) {
          scheduleRetryOnUserGesture();
        }
      });
  } else {
    // 旧ブラウザ: play() が undefined を返す
    fadeVolume(a, 0, targetVol, FADE_DURATION_MS);
  }
}

function handleVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    pauseForHidden();
  } else if (document.visibilityState === "visible") {
    resumeFromVisible();
  }
}

function handlePageHide(e: PageTransitionEvent): void {
  // bfcache に入る経路 (persisted=true) は pageshow.persisted で audio を
  // 完全再構築するので、こちらでは何もしない。
  if (e.persisted) return;
  if (!currentAudio) return;
  if (currentAudio.paused) return;
  wasPlayingBeforeHidden = true;
  // unload 直前なので fade を待たず即時 pause (fade 中に process が落ちると音が残る)
  try {
    currentAudio.pause();
  } catch {
    // ignore
  }
}

// =====================
// bfcache 復帰
// =====================
//
// ページ閉じて戻る (bfcache) で復帰した場合、HTMLAudioElement は autoplay
// 制約で suspended 状態になるケースがある。同 path で再構築して新 audio で
// play 試行 (失敗時は user gesture 待ち) する。

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    // bfcache 復帰経路は audio を完全再構築する。visibilitychange visible との
    // 競合 (二重 play) を避けるため、復帰前のフラグはここでリセットする。
    wasPlayingBeforeHidden = false;
    const restoreKey = currentKey;
    const restorePath = currentResolvedPath;
    if (currentAudio) destroyAudio(currentAudio);
    currentAudio = null;
    currentKey = null;
    currentResolvedPath = "";
    if (restorePath) {
      startBgm(restoreKey, restorePath);
    }
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);
}

// =====================
// useBgm hook
// =====================

export interface UseBgmOptions {
  /**
   * BGM ループするかどうか (default: true)。
   * - true: audio.loop = true (永続 loop)
   * - false: audio.loop = false (1 回再生して ended → 自然停止)
   *
   * 対局画面で「対局終了したら現在の loop 完了で停止」を実現する用途。
   */
  shouldLoop?: boolean;
}

export function useBgm(
  eventKey?: BgmEventKey | null,
  options?: UseBgmOptions,
): void {
  // overrides 変化で audio path 切替えるため購読
  const overrides = useBgmOverrides();
  const shouldLoop = options?.shouldLoop ?? true;

  useEffect(() => {
    if (typeof window === "undefined") return;
    shouldLoopFlag = shouldLoop;
    // 再生中 audio の loop 属性を即時更新 (true→false で現在の loop 完了で
    // ended → 自然停止フローへ)
    if (currentAudio) {
      try {
        currentAudio.loop = shouldLoop;
      } catch {
        // ignore
      }
    }
    const key = eventKey ?? null;
    const path = key ? getEffectiveBgmPath(key) : "";
    startBgm(key, path);
    // ★ cleanup なし: ページ遷移時に音を切らない (次の useBgm 呼出で自動切替)
  }, [eventKey, overrides, shouldLoop]);
}

/**
 * useSound の toggleMute から呼ぶ。SFX/BGM 同時 mute/unmute。
 */
export function setBgmMuted(muted: boolean): void {
  isMuted = muted;
  if (currentAudio) {
    try {
      currentAudio.volume = muted ? 0 : BGM_VOLUME;
    } catch {
      // ignore
    }
  }
}

// =====================
// 画面遷移時の BGM 先行起動 (Issue #189 派生)
// =====================
//
// モバイル Safari は SPA 内 navigation の前後で user gesture 権限を切ることが
// あり、遷移先で改めて useBgm が play() を呼んでも autoplay block で reject
// される現象が報告されていた (PC では引き継がれるが、モバイルだと対局画面で
// 自動再生されない症状)。
//
// これを防ぐため、画面遷移ボタンの onClick (= 確実に user gesture 内) で
// 次画面の BGM key を解決し、即時 startBgm() を呼ぶ。これにより:
//   - 同 path (例: bgm_home → bgm_match_setup は同一ファイル) なら no-op で
//     現在の audio を継続使用 (リスタートしない)
//   - 違う path (例: bgm_match_setup → bgm_game) なら gesture 内で play() が
//     開始され、遷移後の useBgm は早期 return で同 audio を継続再生
//
// なお、初回ホーム着地時の BGM 自動再生はブラウザ仕様 (autoplay policy) 上
// 不可能で、最初の任意操作後に scheduleRetryOnUserGesture 経由で開始される。

function resolveBgmKeyForHref(href: string): BgmEventKey | null {
  // クエリ・ハッシュを除去
  const path = href.split(/[?#]/)[0] ?? "";
  if (path === "/" || path === "") return "bgm_home";
  if (path === "/play" || path === "/classic") return "bgm_match_setup";
  if (path.startsWith("/game/")) return "bgm_game";
  // 履歴 / カード / デッキ / 各 design ページはホーム BGM 継続
  if (
    path === "/history" ||
    path.startsWith("/cards") ||
    path === "/decks" ||
    path === "/card-design" ||
    path === "/board-design"
  ) {
    return "bgm_home";
  }
  // dev tool 等は BGM 切替なし
  return null;
}

/**
 * 画面遷移ボタンの onClick から user gesture 内で呼ぶ。
 *
 * 重要: 現 currentAudio は一切触らない (= ローディング中の BGM 切替防止)。
 * 違う path への遷移の場合、user gesture 内で「次画面 BGM の audio element
 * を muted+0 volume で 1 度 play() してすぐ pause する」処理を行い、その
 * audio を preparedAudio として保持する。遷移後の useBgm 経由で startBgm が
 * 呼ばれた時、preparedAudio を再利用して再生する (autoplay block されない)。
 *
 * 同 path の場合は何もしない (visibility 連動 / 既存の useBgm が対応する)。
 */
export function prepareBgmForNavigation(href: string): void {
  if (typeof window === "undefined") return;
  const nextKey = resolveBgmKeyForHref(href);
  if (!nextKey) return;
  const path = getEffectiveBgmPath(nextKey);
  if (!path) return;
  // 同 path → 何もしない (現 audio を触らない / 既存 BGM 継続)
  if (currentResolvedPath === path) return;
  // 既に prepared 済みの同 path なら no-op
  if (preparedPath === path && preparedAudio) return;
  // 古い prepared を破棄
  if (preparedAudio) {
    destroyAudio(preparedAudio);
    preparedAudio = null;
    preparedPath = "";
  }
  // user gesture 内で audio element を 1 度 play() して unlock 状態にする。
  //
  // Issue #198: iOS Safari では HTMLAudioElement.volume プロパティが無効
  // (read-only / set 無視) で常に 1.0 で再生される (WebKit 仕様)。
  // そのため volume=0 だけでは音量制御できないので muted=true を併用する。
  // muted は iOS Safari でも有効で、play() 開始から pause() までの数百 ms の
  // 間も音が出ない。再利用時 (startBgm 側) で muted=false に戻して通常再生する。
  try {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = path;
    audio.loop = true;
    audio.muted = true;
    audio.volume = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          // 再生は不要なので即 pause。currentTime は 0 のまま保持。
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {
            // ignore
          }
          preparedAudio = audio;
          preparedPath = path;
        })
        .catch(() => {
          // autoplay block 等で失敗。prepared にしない (= 遷移後に通常フローで
          // 再試行される。失敗しても既存挙動と同等)
          destroyAudio(audio);
        });
    } else {
      // 旧ブラウザ: play() が undefined を返す。prepared として扱う。
      preparedAudio = audio;
      preparedPath = path;
    }
  } catch {
    // ignore
  }
}

// =====================
// test-only: 内部 state へのアクセス API
// =====================
//
// Issue #189: useBgm は React hook + module-level singleton で構成されているため
// 単体テストから内部状態を観測しづらい。startBgm を直接呼んで audio を生成し
// 可視性ハンドラの動きを検証するための薄い窓口を提供する。本番コードから
// 使用してはならない (一覧の `__forTest` プロパティ名を grep で見つけたら
// 即座にレビュー指摘する想定)。
export const __forTest = {
  startBgm,
  getCurrentAudio: (): HTMLAudioElement | null => currentAudio,
  getWasPlayingBeforeHidden: (): boolean => wasPlayingBeforeHidden,
  setMutedFlag: (muted: boolean): void => {
    isMuted = muted;
  },
  resetState: (): void => {
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch {
        // ignore
      }
    }
    if (preparedAudio) {
      try {
        preparedAudio.pause();
      } catch {
        // ignore
      }
    }
    currentAudio = null;
    currentKey = null;
    currentResolvedPath = "";
    preparedAudio = null;
    preparedPath = "";
    isMuted = false;
    wasPlayingBeforeHidden = false;
    activeFadeId++;
  },
  getPreparedAudio: (): HTMLAudioElement | null => preparedAudio,
  getPreparedPath: (): string => preparedPath,
};
