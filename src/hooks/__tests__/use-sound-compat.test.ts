// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #189: useSound / playSfxOnce / prepareAudio の互換 API が破壊されて
// いないことを保証する。Howler から Web Audio API への置換に伴い、既存呼出元
// (shogi-game / card-shogi-game / deck-editor-pane / masked-link / page /
// match-setup) を書換せずに済むかをここで担保する。

// audio-engine と use-bgm の副作用を遮断するため、playSfxBuffer / setSfxMuted /
// setBgmMuted / unlockAudio を mock する。本テストは use-sound のシグネチャと
// 委譲ルートだけを検証する (Web Audio の中身は audio-engine.test.ts でカバー)。

vi.mock("@/lib/audio/audio-engine", () => ({
  loadSfxBuffer: vi.fn().mockResolvedValue(null),
  playSfxBuffer: vi.fn(),
  playSfxBufferOnce: vi.fn(),
  setSfxMuted: vi.fn(),
  unlockAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-bgm", () => ({
  setBgmMuted: vi.fn(),
}));

vi.mock("@/lib/dev/sound-overrides", () => ({
  getEffectiveSfxPath: (key: string) => {
    if (key === "missing") return "";
    if (key === "piece_move") return "/sounds/piece-move.mp3";
    return `/sounds/mock/${key}.mp3`;
  },
}));

import { setBgmMuted } from "@/hooks/use-bgm";
import {
  playSfxBuffer,
  playSfxBufferOnce,
  setSfxMuted,
  unlockAudio,
} from "@/lib/audio/audio-engine";
import { playSfxOnce, prepareAudio, useSound } from "../use-sound";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- module-level API ----

describe("playSfxOnce", () => {
  it("有効な key を audio-engine.playSfxBufferOnce に委譲する", () => {
    playSfxOnce("piece_move");
    expect(playSfxBufferOnce).toHaveBeenCalledWith("/sounds/piece-move.mp3");
  });

  it("dev override で空文字 (unassign) のときは no-op", () => {
    // sound-overrides の mock で "missing" は "" を返す
    playSfxOnce("missing" as Parameters<typeof playSfxOnce>[0]);
    expect(playSfxBufferOnce).not.toHaveBeenCalled();
  });
});

describe("prepareAudio", () => {
  it("audio-engine.unlockAudio() を await して resolve する", async () => {
    await prepareAudio();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });
});

// ---- useSound hook ----
//
// React Hook の動作テストには @testing-library/react が必要だが、本リポジトリ
// では未導入のため、Hook の戻り値構造と委譲先 API を直接シミュレートする
// 形で検証する (renderHook 相当のフレームを自前で組む)。

import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

interface HookHandle {
  result: ReturnType<typeof useSound>;
}

function renderUseSound(handle: HookHandle): { unmount: () => void } {
  function Probe(): null {
    handle.result = useSound();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Probe));
  });
  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useSound: 互換 API", () => {
  it("戻り値に playSfx / toggleMute / isMuted / isReady を含む", () => {
    const handle = {} as HookHandle;
    const { unmount } = renderUseSound(handle);
    expect(typeof handle.result.playSfx).toBe("function");
    expect(typeof handle.result.toggleMute).toBe("function");
    expect(typeof handle.result.isMuted).toBe("boolean");
    expect(typeof handle.result.isReady).toBe("boolean");
    unmount();
  });

  it("playSfx は audio-engine.playSfxBuffer に委譲する", () => {
    const handle = {} as HookHandle;
    const { unmount } = renderUseSound(handle);
    handle.result.playSfx("piece_move");
    expect(playSfxBuffer).toHaveBeenCalledWith("/sounds/piece-move.mp3");
    unmount();
  });

  it("playSfx は dev override で空文字のとき no-op", () => {
    const handle = {} as HookHandle;
    const { unmount } = renderUseSound(handle);
    handle.result.playSfx("missing" as Parameters<typeof handle.result.playSfx>[0]);
    expect(playSfxBuffer).not.toHaveBeenCalled();
    unmount();
  });

  it("toggleMute で setBgmMuted と setSfxMuted の両方を呼び、isMuted が反転する", () => {
    const handle = {} as HookHandle;
    const { unmount } = renderUseSound(handle);
    expect(handle.result.isMuted).toBe(false);
    act(() => {
      handle.result.toggleMute();
    });
    expect(setBgmMuted).toHaveBeenCalledWith(true);
    expect(setSfxMuted).toHaveBeenCalledWith(true);
    expect(handle.result.isMuted).toBe(true);
    act(() => {
      handle.result.toggleMute();
    });
    expect(setBgmMuted).toHaveBeenLastCalledWith(false);
    expect(setSfxMuted).toHaveBeenLastCalledWith(false);
    expect(handle.result.isMuted).toBe(false);
    unmount();
  });
});
