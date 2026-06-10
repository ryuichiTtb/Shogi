// Issue #235 派生 (504 UX 改善): AiThinkingIndicator の表示分岐テスト。
//
// - visible=false → 何も描画しない (CPU 手番以外でレイヤを残さない)
// - visible=true / longThinking=false → 「考え中 ...」 (CPU 手番のデフォルト表示)
// - visible=true / longThinking=true → 「長考中 ...」 (自動リトライ中の切替表示)

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AiThinkingIndicator } from "../ai-thinking-indicator";

afterEach(() => {
  cleanup();
});

describe("AiThinkingIndicator", () => {
  it("visible=false では何も描画しない", () => {
    render(<AiThinkingIndicator visible={false} longThinking={false} />);
    expect(screen.queryByTestId("ai-thinking-indicator")).toBeNull();
  });

  it("visible=true / longThinking=false で「考え中 ...」を表示", () => {
    render(<AiThinkingIndicator visible longThinking={false} />);
    expect(screen.getByText("考え中 ...")).toBeTruthy();
    expect(screen.queryByText("長考中 ...")).toBeNull();
  });

  it("visible=true / longThinking=true で「長考中 ...」へ切替", () => {
    render(<AiThinkingIndicator visible longThinking />);
    expect(screen.getByText("長考中 ...")).toBeTruthy();
    expect(screen.queryByText("考え中 ...")).toBeNull();
  });

  it("操作を妨げない (pointer-events-none) かつ盤相対の中央配置レイヤである", () => {
    render(<AiThinkingIndicator visible longThinking={false} />);
    const layer = screen.getByTestId("ai-thinking-indicator");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("absolute");
  });
});
