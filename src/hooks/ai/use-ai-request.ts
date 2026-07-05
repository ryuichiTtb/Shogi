// Issue #176 Phase 1 Stage B: AI 思考リクエストの共通 fetch helper。
//
// 設計:
// - AbortController + request id で stale 応答 (待った / 終局 / unmount 後の
//   遅延応答) を捨てる
// - 同期的 in-flight ref で、useEffect の StrictMode 二重起動や依存配列変更時
//   の二重 fetch を防ぐ
// - 1〜2 回の自動リトライ (指数バックオフ) で一過性 5xx / network 失敗を吸収
// - 連続失敗時は onError コールバックでエラーモーダルを発火させる
//
// Issue #176 timeout-fix F1: AbortError を 4 経路で区別する。
// `controller.abort(new DOMException(reason, "AbortError"))` で reason を埋め
// 込み、catch 内で `controller.signal.reason` を見て分岐する (Web 標準 + Vercel
// 対象ブラウザ全カバー: Chrome 98+ / Firefox 97+ / Safari 15.4+)。
//
//   - CANCEL    : `cancel()` 関数経由のキャンセル (待った / 終局) → silent stale
//   - SUPERSEDE : 新 request 上書きでの abort                       → silent stale
//   - UNMOUNT   : useEffect cleanup の abort                       → silent stale
//   - TIMEOUT   : overall timer (`overallTimeoutMs` 経過)           → onError 発火
//
// 旧実装は AbortError を全て silent stale で破棄していたため、overall timeout
// が発火しても `onError` が走らず AI が永久停止する致命バグがあった
// (本番で 504 が 3 回連続 → 永久停止のメカニズム)。

"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  Difficulty,
  GameState,
  Move,
  Player,
} from "@/lib/shogi/types";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { SearchStats } from "@/lib/shogi/ai/search-context";
import type { TurnAction } from "@/lib/shogi/ai/turn/types";

export interface AiMoveRequestParams {
  gameId: string;
  gameState: GameState;
  player: Player;
  difficulty: Difficulty;
  variantId: string;
  clientMoveCount: number;
  // Issue #193 / PR1a: optional な cardState 送信経路。PR1a では route 側で
  // silent ignore (型不一致でも 400 返却せず無視)、PR1d で評価関数に組込予定。
  cardState?: CardGameState;
  // Issue #193 / PR1a: CPU vs CPU 観戦モードフラグ。route 側で timeLimitMs を
  // SPECTATOR_TIME_LIMIT_MS (1500ms) に短縮して観戦体験を向上させる。
  spectatorMode?: boolean;
  // Issue #245 派生 (検証デバッグ): CPU エンジン選択。route の env ENABLE_LEARNED_EVAL が
  // master switch (env OFF=production では無視され bolt-on 固定)。未指定は env に従う。
  engine?: "legacy" | "learned";
}

export interface AiMoveResponse {
  move: Move | null;
  // Issue #193: AI が選んだ最良 TurnAction (move | draw | playCard)。
  // route.ts は findBestMoveWithStats の result 全体を返すため、本フィールドを
  // 型に追加するだけで action が呼び出し側 (use-card-shogi-game) に伝播する。
  // null は action 未算出 (standard variant / cardState 未渡時、後方互換で move のみ使用)。
  action: TurnAction | null;
  // Issue #245 S4c-1d: action が double_move のとき、実行用の 1手目/2手目 (1手目詰み時 move2=null)。
  // route.ts は result 全体を JSON パススルーするため本フィールド追加で bridge へ伝播する。
  // 未設定 (bolt-on / dm 以外 / 旧サーバ) は bridge が null フォールバック = 従来挙動。
  doubleMove?: { move1: Move; move2: Move | null };
  stats: SearchStats;
}

export interface UseAiRequestOptions {
  // 連続失敗時に呼ばれる。ユーザー向けエラーモーダルを表示する想定。
  onError?: (err: AiRequestError) => void;
  // Issue #235 派生 (504 UX 改善、2026-06-10): 自動リトライ試行へ入った瞬間に呼ばれる。
  // UI 側はこれを受けて思考表示を「考え中 ...」→「長考中 ...」へ切替え、ユーザーには
  // 「CPU が長考している」ように見せる (失敗を露出せず待ちの姿勢を作る)。
  // リトライも失敗した場合は従来どおり onError → エラーモーダルでユーザーに委ねる。
  onAutoRetry?: () => void;
  // 全体タイムアウト (ms)。リトライを含む overall 上限。
  // Issue #176 timeout-fix F4 で 12s に設定していたが、その値では 1 試行目が 504
  // (サーバ応答 ≈ 10.3〜11s) のときリトライ 2 試行目が ~1.7s しか走れず、
  // 「自動リトライがあるのに 504 連鎖では構造的に無力」だった。
  // Issue #235 派生 (2026-06-10): 2 試行目にも完全な実行窓を与える 24s へ拡張
  // (最悪連鎖 = 1 試行目 11s + backoff 0.3s + 2 試行目 11s ≈ 22.3s < 24s)。
  // エンジン側は同日の 504 修正 (action-phase budget) で最悪 ≈ 5.1s に bound 済のため、
  // 通常はこの上限に遠く届かない (本値は真の 504 連鎖時の外側 hard deadline)。
  // デフォルト 24000ms。
  overallTimeoutMs?: number;
  // 自動リトライ回数 (これ以外に最初の試行 1 回がある)。デフォルト 1。
  // Issue #176 timeout-fix F4: 旧 default=2 では (1 試行 5s × 3 + backoff 累積)
  // が 15s を踏み超え overall timer が retry 中に発火 → 永久停止の誘発要因と
  // なっていた。retry=1 を維持 (1 回目の失敗 = 自動リトライ、2 回目の失敗 = modal)。
  maxRetries?: number;
}

export interface AiRequestError {
  kind: "network" | "http" | "timeout" | "invalid";
  status?: number;
  message: string;
}

// AbortController.abort(reason) に渡す DOMException の message として使う。
// `controller.signal.reason` 経由で取り出して経路を区別するため、必ず本定数を
// 経由して abort を呼ぶ (raw 文字列での typo を型エラーで検知させるため)。
export const ABORT_REASONS = {
  CANCEL: "cancel",
  SUPERSEDE: "supersede",
  TIMEOUT: "overall timeout",
  UNMOUNT: "unmount",
} as const;

export type AbortReason = (typeof ABORT_REASONS)[keyof typeof ABORT_REASONS];

// signal.reason の message が ABORT_REASONS のいずれかと一致するかを検査する。
// `signal.reason` は abort(reason) で渡された値そのもの (DOMException など) で、
// browser 側で勝手に作られる場合 (network エラー等) は undefined になり得る。
function getAbortReason(signal: AbortSignal): AbortReason | null {
  const reason = signal.reason;
  if (reason instanceof DOMException) {
    const message = reason.message;
    for (const value of Object.values(ABORT_REASONS)) {
      if (message === value) return value;
    }
  }
  return null;
}

// ランダム request id (crypto.randomUUID は modern browser/edge で使える)。
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Issue #176 timeout-fix F4: 指数バックオフを 300ms 起点 (cap 1500ms) に縮小。
// Issue #235 派生 (2026-06-10): overallTimeoutMs を 24000ms へ拡張したことに伴い、
// maxRetries=1 + overallTimeoutMs=24000ms で最悪累積 (11s + 0.3s + 11s ≈ 22.3s)
// < 24s となり、retry 2 回目にも完全な実行窓を与えつつ overall timer が retry 中に
// 発火しないよう整合させる (backoff 自体の値は不変)。
//
// 504 原因別 retry 効果見積もり:
//   A: maxDuration 超過        → retry 効果薄 (warm 再走でも同遅延)
//   B: cold start spike        → retry 効果中 (2 回目 warm 直行で復旧)
//   C: Neon DB 一時遅延 (resume) → retry 効果大 (2 回目 warm DB 直行)
// A は modal 経由のユーザー手動リトライで救済、B/C は retry で自動復旧。
function backoffMs(attempt: number): number {
  return Math.min(300 * Math.pow(2, attempt - 1), 1500);
}

// signal が aborted になった時、reject を「signal.reason 自体」を保持した
// AbortError にして、呼び出し側で reason 経路を区別できるようにする。
// (DOMException の message に reason 文字列をそのまま透過させる)
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      // catch 側は controller.signal.reason を直接見るので、ここの reject 値は
      // name === "AbortError" を満たせば中身は問わない (互換性のため Aborted)。
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

export function useAiRequest(options: UseAiRequestOptions = {}) {
  const { onError, onAutoRetry, overallTimeoutMs = 24000, maxRetries = 1 } = options;

  // 現在 in-flight な AbortController。新規 request で前回を abort し、stale 応答
  // を確実に捨てる。
  const inFlightRef = useRef<AbortController | null>(null);

  // 直近の request id。fetch 結果 dispatch 前にこの id と一致するか確認する。
  const currentRequestIdRef = useRef<string | null>(null);

  // unmount 時に in-flight を必ず abort して、stale callback の発火を防ぐ。
  useEffect(() => {
    return () => {
      inFlightRef.current?.abort(
        new DOMException(ABORT_REASONS.UNMOUNT, "AbortError"),
      );
    };
  }, []);

  // 進行中の request を明示的にキャンセル (待った / 終局時に呼ぶ)。
  const cancel = useCallback(() => {
    inFlightRef.current?.abort(
      new DOMException(ABORT_REASONS.CANCEL, "AbortError"),
    );
    inFlightRef.current = null;
    currentRequestIdRef.current = null;
  }, []);

  // 新しい AI 思考 request を発行する。
  // 戻り値: 「自分の request id と現在 id が一致するか」「response payload」を含む結果。
  // stale な応答は { stale: true } を返し、呼び出し側で破棄する。
  const requestMove = useCallback(
    async (
      params: AiMoveRequestParams,
    ): Promise<
      | { stale: false; response: AiMoveResponse; requestId: string }
      | { stale: true; requestId: string }
    > => {
      // 既存 request があれば abort (新 request 上書き)
      inFlightRef.current?.abort(
        new DOMException(ABORT_REASONS.SUPERSEDE, "AbortError"),
      );
      const controller = new AbortController();
      inFlightRef.current = controller;

      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      // overall timeout (本タイマーだけ onError を発火させる経路、F1 の核心)
      const overallTimer = setTimeout(() => {
        controller.abort(
          new DOMException(ABORT_REASONS.TIMEOUT, "AbortError"),
        );
      }, overallTimeoutMs);

      const body = JSON.stringify({ ...params, requestId });

      // AbortError 共通処理: signal.reason の経路で onError 発火 / stale を分岐。
      // - TIMEOUT       : overall timer 経由 → onError({ kind: "timeout" }) 発火
      // - CANCEL/SUPERSEDE/UNMOUNT : 意図的中断 → silent stale (UI 別経路で復旧)
      // - 不明 (reason 取得不能) : 安全側で silent stale 扱い (旧挙動と同じ)
      const handleAbort = ():
        | { stale: true; requestId: string } => {
        const reason = getAbortReason(controller.signal);
        if (reason === ABORT_REASONS.TIMEOUT) {
          onError?.({
            kind: "timeout",
            message: "AI 思考が時間内に完了しませんでした",
          });
        }
        return { stale: true, requestId };
      };

      try {
        let lastError: AiRequestError | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (controller.signal.aborted) {
            // 意図的キャンセル / overall timeout 等。reason で onError 発火経路を分岐。
            return handleAbort();
          }
          if (attempt > 0) {
            // Issue #235 派生 (504 UX 改善): 自動リトライ開始を UI へ通知
            // (「考え中 ...」→「長考中 ...」切替。失敗を露出せず長考として見せる)。
            onAutoRetry?.();
            try {
              await delay(backoffMs(attempt), controller.signal);
            } catch {
              // delay() が AbortError で reject した場合も reason 経路で分岐。
              return handleAbort();
            }
          }
          try {
            const res = await fetch("/api/ai-move", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
              signal: controller.signal,
              credentials: "same-origin",
            });
            if (!res.ok) {
              lastError = {
                kind: "http",
                status: res.status,
                message: `HTTP ${res.status}`,
              };
              // 4xx (400/401/403/404/409/413/415) はリトライしても通らない。即エラー。
              if (res.status >= 400 && res.status < 500) break;
              continue; // 5xx はリトライ対象
            }
            const data = (await res.json()) as AiMoveResponse;
            if (currentRequestIdRef.current !== requestId) {
              // 自分が最新でない (= 後続 request に上書きされた)。stale 扱い。
              return { stale: true, requestId };
            }
            return { stale: false, response: data, requestId };
          } catch (err) {
            if ((err as { name?: string }).name === "AbortError") {
              // signal.reason で経路を区別。TIMEOUT のみ onError 発火、他は silent stale。
              return handleAbort();
            }
            lastError = {
              kind: "network",
              message: (err as Error).message ?? "Network error",
            };
            // network エラーは次の attempt でリトライ
          }
        }
        // すべてのリトライ消費 → エラー通知
        if (lastError) onError?.(lastError);
        return { stale: true, requestId };
      } finally {
        clearTimeout(overallTimer);
        if (inFlightRef.current === controller) {
          inFlightRef.current = null;
        }
      }
    },
    [maxRetries, onError, onAutoRetry, overallTimeoutMs],
  );

  return { requestMove, cancel };
}
