// Issue #176 timeout-fix F6 (fix-PR1 範囲): useAiRequest の race / 並走系テスト。
//
// F1 で導入した signal.reason 区別 (CANCEL / SUPERSEDE / UNMOUNT / TIMEOUT) と
// F4 の retry 予算 (maxRetries=1 / backoff=300ms / overallTimeoutMs=12000ms)
// が意図通り動くかを検証する。
//
// テスト技術:
//   - global.fetch を vi.fn() で差し替え 503/504/200/AbortError を制御
//   - vi.useFakeTimers() で setTimeout (overall timer / backoff delay) を制御
//   - @testing-library/react の renderHook + act で hook を駆動

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAiRequest,
  ABORT_REASONS,
  type AiMoveResponse,
  type AiRequestError,
} from "../use-ai-request";
import type { GameState } from "@/lib/shogi/types";

// ----------------------- helpers -----------------------

const sampleGameState: GameState = {
  board: [],
  hand: { sente: {}, gote: {} },
  currentPlayer: "sente",
  moveCount: 0,
  status: "active",
  // 型上の最低限を満たすキャスト (テスト用簡易 fixture)
} as unknown as GameState;

function makeParams(overrides: Partial<Parameters<ReturnType<typeof useAiRequest>["requestMove"]>[0]> = {}) {
  return {
    gameId: "test-game",
    gameState: sampleGameState,
    player: "gote" as const,
    difficulty: "expert" as const,
    variantId: "standard",
    clientMoveCount: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const sampleAiResponse: AiMoveResponse = {
  move: {
    type: "drop",
    to: { row: 0, col: 0 },
    dropPiece: "pawn",
    piece: "pawn",
    player: "gote",
  },
  stats: {
    elapsedMs: 100,
    nodes: 1,
    depthCompleted: 1,
    timedOut: false,
    stoppedBy: "none",
    usedBook: false,
    usedFallback: false,
  },
};

// ----------------------- shared setup -----------------------

let fetchSpy: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ----------------------- 1. CANCEL: silent stale -----------------------

describe("useAiRequest - F1 abort reason 経路区別", () => {
  it("cancel() は onError を発火させず stale: true を返す", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAiRequest({ onError }));

    // fetch は abort されるまで未解決
    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    let promise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      promise = result.current.requestMove(makeParams());
      // 1 tick で fetch が呼ばれている状態にする
      await Promise.resolve();
    });

    await act(async () => {
      result.current.cancel();
    });

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("unmount は onError を発火させず stale: true を返す (cleanup 経由)", async () => {
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useAiRequest({ onError }));

    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    let promise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      promise = result.current.requestMove(makeParams());
      await Promise.resolve();
    });

    unmount();

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("supersede (連続 requestMove) は前 request の onError を発火させない", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAiRequest({ onError }));

    let firstResolveAbortReject!: (e: Error) => void;
    fetchSpy
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            firstResolveAbortReject = reject;
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      )
      .mockResolvedValueOnce(jsonResponse(sampleAiResponse));

    let firstPromise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    let secondPromise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      firstPromise = result.current.requestMove(makeParams());
      await Promise.resolve();
    });
    await act(async () => {
      secondPromise = result.current.requestMove(makeParams());
      await Promise.resolve();
    });

    const r1 = await firstPromise;
    expect(r1.stale).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    void firstResolveAbortReject;

    const r2 = await secondPromise;
    expect(r2.stale).toBe(false);
    if (r2.stale === false) {
      expect(r2.response.move).not.toBeNull();
    }
  });

  it("overall timeout fire 時のみ onError({ kind: 'timeout' }) を 1 回発火させる (F1 核心)", async () => {
    const onError = vi.fn<(e: AiRequestError) => void>();
    const { result } = renderHook(() =>
      useAiRequest({ onError, overallTimeoutMs: 100, maxRetries: 0 }),
    );

    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    let promise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      promise = result.current.requestMove(makeParams());
    });

    // overall timer (100ms) を発火させる (microtask flush 込み)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "timeout" }),
    );
  });
});

// ----------------------- HTTP / network 経路 -----------------------

describe("useAiRequest - HTTP / network retry 経路", () => {
  it("HTTP 504 が maxRetries 回連続 (=1) で onError({ kind: 'http', status: 504 }) を 1 回発火", async () => {
    const onError = vi.fn<(e: AiRequestError) => void>();
    const { result } = renderHook(() =>
      useAiRequest({ onError, maxRetries: 1 }),
    );

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: "timeout" }, { status: 504 }))
      .mockResolvedValueOnce(jsonResponse({ error: "timeout" }, { status: 504 }));

    let promise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      promise = result.current.requestMove(makeParams());
    });

    // backoff 300ms + microtask flush を非同期版で進める
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "http", status: 504 }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("HTTP 503 → 200 で retry 成功し onError は不発", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAiRequest({ onError, maxRetries: 1 }),
    );

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: "unavail" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(sampleAiResponse));

    let promise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      promise = result.current.requestMove(makeParams());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const r = await promise;
    expect(r.stale).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("HTTP 4xx (例: 400) は retry せず onError を発火し fetch は 1 回のみ", async () => {
    const onError = vi.fn<(e: AiRequestError) => void>();
    const { result } = renderHook(() =>
      useAiRequest({ onError, maxRetries: 1 }),
    );

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "bad" }, { status: 400 }),
    );

    let promise!: ReturnType<ReturnType<typeof useAiRequest>["requestMove"]>;
    await act(async () => {
      promise = result.current.requestMove(makeParams());
      await Promise.resolve();
    });

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "http", status: 400 }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ----------------------- 定数 -----------------------

describe("ABORT_REASONS 定数", () => {
  it("4 経路すべての reason 文字列が export されている", () => {
    expect(ABORT_REASONS.CANCEL).toBe("cancel");
    expect(ABORT_REASONS.SUPERSEDE).toBe("supersede");
    expect(ABORT_REASONS.TIMEOUT).toBe("overall timeout");
    expect(ABORT_REASONS.UNMOUNT).toBe("unmount");
  });
});
