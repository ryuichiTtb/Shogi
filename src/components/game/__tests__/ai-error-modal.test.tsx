// Issue #176 timeout-fix F6 (fix-PR1 範囲, M-4): AiErrorModal の kind 別文言分岐テスト。
//
// F1 で AiErrorModal を AiRequestError.kind に応じた文言分岐に変更したことを
// 受け、timeout / http / network / default の 4 経路 + dismiss 抑制 (L-2) を
// 確認する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AiErrorModal } from "../ai-error-modal";

afterEach(() => {
  cleanup();
});

describe("AiErrorModal - kind 別文言分岐", () => {
  it("error.kind === 'timeout' で timeout 文言を表示", () => {
    render(
      <AiErrorModal
        open
        error={{ kind: "timeout", message: "timeout" }}
        onRetry={() => {}}
        onResign={() => {}}
      />,
    );
    expect(
      screen.getByText(/AI が時間内に手を返せませんでした/),
    ).toBeTruthy();
  });

  it("error.kind === 'http' で status を含む http 文言を表示", () => {
    render(
      <AiErrorModal
        open
        error={{ kind: "http", status: 504, message: "HTTP 504" }}
        onRetry={() => {}}
        onResign={() => {}}
      />,
    );
    expect(
      screen.getByText(/サーバ側でエラーが発生しました \(504\)/),
    ).toBeTruthy();
  });

  it("error.kind === 'network' で通信エラー文言を表示", () => {
    render(
      <AiErrorModal
        open
        error={{ kind: "network", message: "fetch failed" }}
        onRetry={() => {}}
        onResign={() => {}}
      />,
    );
    expect(
      screen.getByText(/通信エラーで AI 思考が中断されました/),
    ).toBeTruthy();
  });

  it("error が null / undefined のときは default 文言を表示", () => {
    render(
      <AiErrorModal
        open
        error={null}
        onRetry={() => {}}
        onResign={() => {}}
      />,
    );
    expect(
      screen.getByText(/通信や一時的なエラーで AI 思考が完了しませんでした/),
    ).toBeTruthy();
  });

  it("open=false のときは modal が表示されない", () => {
    render(
      <AiErrorModal
        open={false}
        error={{ kind: "timeout", message: "timeout" }}
        onRetry={() => {}}
        onResign={() => {}}
      />,
    );
    expect(screen.queryByText(/AI が時間内に/)).toBeNull();
  });
});

describe("AiErrorModal - retry / resign ボタン", () => {
  it("「もう一度試す」クリックで onRetry が発火", async () => {
    const onRetry = vi.fn();
    const onResign = vi.fn();
    render(
      <AiErrorModal
        open
        error={{ kind: "timeout", message: "timeout" }}
        onRetry={onRetry}
        onResign={onResign}
      />,
    );
    const retryBtn = screen.getByRole("button", { name: "もう一度試す" });
    retryBtn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onResign).not.toHaveBeenCalled();
  });

  it("「投了する」クリックで onResign が発火", async () => {
    const onRetry = vi.fn();
    const onResign = vi.fn();
    render(
      <AiErrorModal
        open
        error={{ kind: "timeout", message: "timeout" }}
        onRetry={onRetry}
        onResign={onResign}
      />,
    );
    const resignBtn = screen.getByRole("button", { name: "投了する" });
    resignBtn.click();
    expect(onResign).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("AiErrorModal - dismiss 抑制 (L-1, L-2 回帰防止)", () => {
  // ai-error-modal.tsx:29 の `onOpenChange={() => {}}` で Esc / 外クリック dismiss を
  // 抑制している。card-shogi の進行不能状態を救済するためで、必ず Retry/Resign の
  // どちらかを選ばせる設計。回帰防止のためテスト。
  it("Esc キーでは dismiss されない (進行不能状態の救済)", () => {
    render(
      <AiErrorModal
        open
        error={{ kind: "timeout", message: "timeout" }}
        onRetry={vi.fn()}
        onResign={vi.fn()}
      />,
    );
    // dismiss されないことの観測には dialog が DOM に残ることを確認すれば十分
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(
      screen.getByText(/AI が時間内に手を返せませんでした/),
    ).toBeTruthy();
  });
});
