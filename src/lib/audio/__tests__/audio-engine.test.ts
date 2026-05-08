// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __forTest,
  isSfxMuted,
  loadSfxBuffer,
  playSfxBuffer,
  playSfxBufferOnce,
  setSfxMuted,
  unlockAudio,
} from "../audio-engine";

// Issue #189: audio-engine.ts は Web Audio API に依存する。jsdom では
// AudioContext が未実装のため、mock を global に注入してテストする。

interface MockSource {
  buffer: AudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

interface MockGain {
  gain: { value: number };
  connect: ReturnType<typeof vi.fn>;
}

interface MockCtx {
  state: "suspended" | "running" | "closed" | "interrupted";
  destination: { type: "destination" };
  createBufferSource: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  _stateListeners: Array<() => void>;
  _setState: (s: MockCtx["state"]) => void;
}

let createdCtx: MockCtx | null = null;
let lastBufferSources: MockSource[] = [];
let lastGains: MockGain[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let decodeShouldFail = false;

function buildMockCtx(initialState: MockCtx["state"] = "suspended"): MockCtx {
  const ctx: MockCtx = {
    state: initialState,
    destination: { type: "destination" },
    _stateListeners: [],
    createBufferSource: vi.fn(() => {
      const s: MockSource = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: vi.fn(),
      };
      lastBufferSources.push(s);
      return s;
    }),
    createGain: vi.fn(() => {
      const g: MockGain = {
        gain: { value: 1 },
        connect: vi.fn(),
      };
      lastGains.push(g);
      return g;
    }),
    decodeAudioData: vi.fn(
      (
        _arr: ArrayBuffer,
        onSuccess?: (b: AudioBuffer) => void,
        onError?: () => void,
      ) => {
        if (decodeShouldFail) {
          if (onError) onError();
          return Promise.reject(new Error("decode failed"));
        }
        const buf = { duration: 0.5 } as unknown as AudioBuffer;
        if (onSuccess) onSuccess(buf);
        return Promise.resolve(buf);
      },
    ),
    resume: vi.fn(() => {
      ctx.state = "running";
      ctx._stateListeners.forEach((l) => l());
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(
      (event: string, listener: () => void) => {
        if (event === "statechange") {
          ctx._stateListeners.push(listener);
        }
      },
    ),
    _setState(s) {
      ctx.state = s;
      ctx._stateListeners.forEach((l) => l());
    },
  };
  return ctx;
}

beforeEach(() => {
  __forTest.reset();
  createdCtx = null;
  lastBufferSources = [];
  lastGains = [];
  decodeShouldFail = false;

  // class で mock コンストラクタを定義 (new 呼出に対応するため arrow は不可)
  class MockAudioContext {
    constructor() {
      createdCtx = buildMockCtx("suspended");
      return createdCtx as unknown as MockAudioContext;
    }
  }
  // 既存の (jsdom 上の) AudioContext を mock 実装で上書き
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  (globalThis as unknown as { webkitAudioContext: unknown }).webkitAudioContext = MockAudioContext;

  fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }),
  );
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  __forTest.reset();
});

describe("audio-engine: loadSfxBuffer", () => {
  it("空文字 path は no-op で null を返す", async () => {
    const result = await loadSfxBuffer("");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("同一 path への 2 回呼び出しで fetch + decode は 1 回のみ (cache hit)", async () => {
    const path = "/sounds/test.mp3";
    const a = await loadSfxBuffer(path);
    const b = await loadSfxBuffer(path);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createdCtx?.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("同一 path への並行ロードは Promise を共有して二重 fetch しない", async () => {
    const path = "/sounds/parallel.mp3";
    const [a, b] = await Promise.all([loadSfxBuffer(path), loadSfxBuffer(path)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("decode 失敗時は null を返す (例外は伝播しない)", async () => {
    decodeShouldFail = true;
    const result = await loadSfxBuffer("/sounds/broken.mp3");
    expect(result).toBeNull();
    // 次回再試行できるようキャッシュには残らない
    decodeShouldFail = false;
    const retry = await loadSfxBuffer("/sounds/broken.mp3");
    expect(retry).not.toBeNull();
  });

  it("fetch 失敗 (status !ok) は null を返す", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    const result = await loadSfxBuffer("/sounds/404.mp3");
    expect(result).toBeNull();
  });
});

describe("audio-engine: playSfxBuffer", () => {
  it("buffer がキャッシュ済みなら即時 source を start", async () => {
    const path = "/sounds/cached.mp3";
    await loadSfxBuffer(path);
    const beforeCount = lastBufferSources.length;
    playSfxBuffer(path);
    expect(lastBufferSources.length).toBe(beforeCount + 1);
    const last = lastBufferSources[lastBufferSources.length - 1];
    expect(last.start).toHaveBeenCalledTimes(1);
  });

  it("同 path 連打で複数 source が並行 start (= 重なり再生)", async () => {
    const path = "/sounds/multi.mp3";
    await loadSfxBuffer(path);
    const beforeCount = lastBufferSources.length;
    playSfxBuffer(path);
    playSfxBuffer(path);
    playSfxBuffer(path);
    expect(lastBufferSources.length).toBe(beforeCount + 3);
    // 直前の source は stop されない (重なり OK)
    for (let i = beforeCount; i < lastBufferSources.length - 1; i++) {
      expect(lastBufferSources[i].stop).not.toHaveBeenCalled();
    }
  });

  it("空文字 path は no-op (source を作らない)", () => {
    const beforeCount = lastBufferSources.length;
    playSfxBuffer("");
    expect(lastBufferSources.length).toBe(beforeCount);
  });
});

describe("audio-engine: playSfxBufferOnce", () => {
  it("同 key 連打時に直前 source が stop されてから新 source を start", async () => {
    const path = "/sounds/once.mp3";
    await loadSfxBuffer(path);
    playSfxBufferOnce(path);
    const first = lastBufferSources[lastBufferSources.length - 1];
    expect(first.start).toHaveBeenCalledTimes(1);
    expect(first.stop).not.toHaveBeenCalled();

    playSfxBufferOnce(path);
    const second = lastBufferSources[lastBufferSources.length - 1];
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.start).toHaveBeenCalledTimes(1);
    expect(first).not.toBe(second);
  });

  it("異なる path は互いに stop しない", async () => {
    const a = "/sounds/once-a.mp3";
    const b = "/sounds/once-b.mp3";
    await loadSfxBuffer(a);
    await loadSfxBuffer(b);
    playSfxBufferOnce(a);
    const sa = lastBufferSources[lastBufferSources.length - 1];
    playSfxBufferOnce(b);
    const sb = lastBufferSources[lastBufferSources.length - 1];
    expect(sa.stop).not.toHaveBeenCalled();
    expect(sb.stop).not.toHaveBeenCalled();
  });

  it("空文字 path は no-op", () => {
    const beforeCount = lastBufferSources.length;
    playSfxBufferOnce("");
    expect(lastBufferSources.length).toBe(beforeCount);
  });
});

describe("audio-engine: setSfxMuted", () => {
  it("setSfxMuted(true) で マスタ GainNode の値が 0 になる", async () => {
    // ctx を作るために 1 度音源ロードを走らせる
    await loadSfxBuffer("/sounds/x.mp3");
    setSfxMuted(true);
    expect(__forTest.getMasterGain()?.gain.value).toBe(0);
    expect(isSfxMuted()).toBe(true);
  });

  it("setSfxMuted(false) で マスタ GainNode の値が 1 に戻る", async () => {
    await loadSfxBuffer("/sounds/x.mp3");
    setSfxMuted(true);
    setSfxMuted(false);
    expect(__forTest.getMasterGain()?.gain.value).toBe(1);
    expect(isSfxMuted()).toBe(false);
  });

  it("AudioContext 生成前に setSfxMuted(true) を呼んでも、後の生成時に値が反映される", async () => {
    setSfxMuted(true);
    expect(isSfxMuted()).toBe(true);
    // 次の音源ロードで AudioContext が生成され、masterGain が初期値 0 になる
    await loadSfxBuffer("/sounds/y.mp3");
    expect(__forTest.getMasterGain()?.gain.value).toBe(0);
  });
});

describe("audio-engine: unlockAudio", () => {
  it("ctx.state === 'suspended' のとき resume が呼ばれて running に遷移する", async () => {
    await unlockAudio();
    expect(createdCtx?.state).toBe("running");
    expect(createdCtx?.resume).toHaveBeenCalledTimes(1);
  });

  it("ctx.state === 'running' のときは resume を呼ばない", async () => {
    await unlockAudio();
    createdCtx!.resume.mockClear();
    // 既に running
    await unlockAudio();
    expect(createdCtx?.resume).not.toHaveBeenCalled();
  });
});

describe("audio-engine: statechange フォールバック", () => {
  it("interrupted に落ちた場合 resume が試行される", async () => {
    // ctx 生成 + statechange listener attach
    await unlockAudio();
    createdCtx!.resume.mockClear();
    // 外部要因 (通話着信等) で interrupted に落ちる
    createdCtx!._setState("interrupted");
    // statechange listener 経由で resume 呼出
    expect(createdCtx?.resume).toHaveBeenCalled();
  });
});
