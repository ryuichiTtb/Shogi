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
  action: null,
  stats: {
    elapsedMs: 100,
    nodes: 1,
    depthCompleted: 1,
    timedOut: false,
    stoppedBy: "none",
    usedBook: false,
    usedFallback: false,
    usedCardAction: false,
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

  it("supersede (連続 requestMove) は前 request の onError を発火させず、前 signal.reason は SUPERSEDE になる (M-1)", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAiRequest({ onError }));

    // 1 回目 fetch の signal を保持して、後で reason を inspect する
    let firstSignal: AbortSignal | undefined;
    fetchSpy
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            firstSignal = init.signal ?? undefined;
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

    // M-1: 前 controller の signal.reason が SUPERSEDE であることを直接検証。
    // 将来この reason 文字列が誤って TIMEOUT 等に書き換わると onError 誤発火を
    // 引き起こすため、reason の物理紐付けを確認する。
    expect(firstSignal?.aborted).toBe(true);
    expect(firstSignal?.reason).toBeInstanceOf(DOMException);
    expect((firstSignal?.reason as DOMException).message).toBe(
      ABORT_REASONS.SUPERSEDE,
    );

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

// ----------------------- race / 並走系 (R-1, 計画書 L388-392 ケース 7-9) -----------------------

describe("useAiRequest - race / 並走系 (F1 reason 区別の物理保証)", () => {
  // ケース 8: backoff delay() 中に overall timeout 発火 → onError({ kind: "timeout" }) 発火。
  // F1 で delay() catch 内に追加した handleAbort() の直接検証 (回帰防止上の核心)。
  // overallTimeoutMs (250ms) < backoff (300ms) で、delay の中で overall timer fire を起こす。
  it("ケース 8: backoff delay() 中に overall timeout が発火すると onError({ kind: 'timeout' }) を発火", async () => {
    const onError = vi.fn<(e: AiRequestError) => void>();
    const { result } = renderHook(() =>
      useAiRequest({ onError, overallTimeoutMs: 250, maxRetries: 1 }),
    );

    // 1 回目は 504 で即返し → backoff (300ms) 突入。
    // overall timer (250ms) が backoff 中に fire するため、2 回目 fetch には到達しない。
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: "timeout" }, { status: 504 }))
      .mockImplementation(
        // 2 回目以降は呼ばれないはずだが、万一呼ばれても abort で reject される形に
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
    await act(async () => {
      // 504 resolve → continue → backoff 300ms 開始 → 250ms 時点で overall timer fire
      // → delay の onAbort が reject → catch で handleAbort → onError({kind:"timeout"})
      await vi.advanceTimersByTimeAsync(400);
    });

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "timeout" }),
    );
    // 1 回目だけ呼ばれて、backoff 中に abort されたので 2 回目には到達していない
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // ケース 7: 「supersede 後に前 controller を再度 abort しても reason は変わらない」
  // という Web 標準の controller↔reason 物理紐付けを直接検証する。
  // useAiRequest の動的 race (= 1 回目 supersede 後に 1 回目 overall timer が遅れて発火)
  // でも前 controller の reason が SUPERSEDE のまま不変なため、後続 controller の
  // reason が誤って TIMEOUT に書き換わることはない、ということを示す原理レベルテスト。
  it("ケース 7: SUPERSEDE で abort 済 controller を再度 abort しても reason は SUPERSEDE のまま (Web 標準の物理紐付け)", () => {
    const controller = new AbortController();
    controller.abort(
      new DOMException(ABORT_REASONS.SUPERSEDE, "AbortError"),
    );

    // この controller を再度 abort しても、Web 標準では reason は最初の abort で固定される。
    // useAiRequest の race で 1 回目 supersede 後に 1 回目 overall timer が遅れて発火しても、
    // 前 controller の reason は SUPERSEDE のまま ≠ TIMEOUT で onError は発火しない。
    controller.abort(
      new DOMException(ABORT_REASONS.TIMEOUT, "AbortError"),
    );

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
    expect((controller.signal.reason as DOMException).message).toBe(
      ABORT_REASONS.SUPERSEDE,
    );
    // → このため、別 controller (= 後続 request) の reason には混線しない
  });

  // ケース 9: requestMove 中に cancel() が呼ばれた場合、fetch は abort で reject され、
  // catch 経由の handleAbort で silent stale (CANCEL は onError 不発)。
  // 既に aborted な signal を fetch が同期的に観測する経路 (ループ先頭の早期 return も
  // 含む) で onError 不発が崩れないことを確認するエッジケース。
  it("ケース 9: requestMove 中に cancel() を呼ぶと AbortError 経路で silent stale (CANCEL は onError 不発)", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAiRequest({ onError }));

    // fetch は abort listener 付きで、abort 時に reject する
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
      // microtask flush 前に cancel → controller.signal.aborted = true (reason=CANCEL)
      result.current.cancel();
    });

    const r = await promise;
    expect(r.stale).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    // CANCEL 経路は silent stale で破棄、TIMEOUT のみ onError 発火するという F1 設計通り
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
