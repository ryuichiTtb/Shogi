// Issue #176 Phase 1 Stage B: AI 思考リクエストの共通 fetch helper。
//
// 設計:
// - AbortController + request id で stale 応答 (待った / 終局 / unmount 後の
//   遅延応答) を捨てる
// - 同期的 in-flight ref で、useEffect の StrictMode 二重起動や依存配列変更時
//   の二重 fetch を防ぐ
// - 1〜2 回の自動リトライ (指数バックオフ) で一過性 5xx / network 失敗を吸収
// - 連続失敗時は onError コールバックでエラーモーダルを発火させる
// - request.signal による abort はリトライ対象外 (待った / 終局はリトライ不要)

"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  Difficulty,
  GameState,
  Move,
  Player,
} from "@/lib/shogi/types";
import type { SearchStats } from "@/lib/shogi/ai/search-context";

export interface AiMoveRequestParams {
  gameId: string;
  gameState: GameState;
  player: Player;
  difficulty: Difficulty;
  variantId: string;
  clientMoveCount: number;
}

export interface AiMoveResponse {
  move: Move | null;
  stats: SearchStats;
}

export interface UseAiRequestOptions {
  // 連続失敗時に呼ばれる。ユーザー向けエラーモーダルを表示する想定。
  onError?: (err: AiRequestError) => void;
  // 全体タイムアウト (ms)。リトライを含む overall 上限。デフォルト 15000。
  overallTimeoutMs?: number;
  // 自動リトライ回数 (これ以外に最初の試行 1 回がある)。デフォルト 2。
  maxRetries?: number;
}

export interface AiRequestError {
  kind: "network" | "http" | "timeout" | "invalid";
  status?: number;
  message: string;
}

// ランダム request id (crypto.randomUUID は modern browser/edge で使える)。
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 指数バックオフ (600ms, 1500ms, ...)
function backoffMs(attempt: number): number {
  return Math.min(600 * Math.pow(2.5, attempt - 1), 4000);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

export function useAiRequest(options: UseAiRequestOptions = {}) {
  const { onError, overallTimeoutMs = 15000, maxRetries = 2 } = options;

  // 現在 in-flight な AbortController。新規 request で前回を abort し、stale 応答
  // を確実に捨てる。
  const inFlightRef = useRef<AbortController | null>(null);

  // 直近の request id。fetch 結果 dispatch 前にこの id と一致するか確認する。
  const currentRequestIdRef = useRef<string | null>(null);

  // unmount 時に in-flight を必ず abort して、stale callback の発火を防ぐ。
  useEffect(() => {
    return () => {
      inFlightRef.current?.abort();
    };
  }, []);

  // 進行中の request を明示的にキャンセル (待った / 終局時に呼ぶ)。
  const cancel = useCallback(() => {
    inFlightRef.current?.abort();
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
      // 既存 request があれば abort
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      // overall timeout
      const overallTimer = setTimeout(() => {
        controller.abort(new DOMException("overall timeout", "AbortError"));
      }, overallTimeoutMs);

      const body = JSON.stringify({ ...params, requestId });

      try {
        let lastError: AiRequestError | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (controller.signal.aborted) {
            // 意図的なキャンセル: stale 扱いで破棄 (リトライしない)
            return { stale: true, requestId };
          }
          if (attempt > 0) {
            try {
              await delay(backoffMs(attempt), controller.signal);
            } catch {
              return { stale: true, requestId };
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
              // 明示的キャンセル / overall timeout / unmount。リトライしない。
              return { stale: true, requestId };
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
    [maxRetries, onError, overallTimeoutMs],
  );

  return { requestMove, cancel };
}
