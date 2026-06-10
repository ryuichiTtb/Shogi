// Issue #235 派生 (504 UX 改善、2026-06-10): CPU 手番中に盤中央へ常時表示する思考インジケータ。
//
// 仕様 (ユーザー要件):
// - プレイヤーが手を指す / カードを使い CPU 手番になったら、CPU が手を返すまで
//   「考え中 ...」を盤中央に表示する (デフォルト機能)。
// - AI リクエストが一過性失敗し自動リトライへ入ったら「長考中 ...」へ切替え、
//   失敗を露出せず「CPU が長考している」ように見せる (use-ai-request の onAutoRetry 連動)。
// - 自動リトライも失敗した場合は AiErrorModal (もう一度試す / 投了する) が出る。
//
// 設計:
// - BoardOverlay (z-10、王手・トラップ発動等のイベント演出) と同じ盤コンテナ相対の
//   absolute レイヤだが z-[8] で下層に置き、イベント演出を常に優先表示する。
// - pointer-events-none で操作を一切妨げない (CPU 手番中のみの表示で実害もない)。
// - アニメーションは Tailwind animate-pulse (CSS opacity keyframes) のみ = JS タイマー
//   不使用・再レイアウトなしでモバイル負荷ゼロ近傍 (AGENTS UI/UX 方針)。
// - 観戦モード (CPU vs CPU) では両者 AI で常時表示になってしまうため、呼び出し側で
//   visible=false にする (card-shogi-game.tsx)。

"use client";

export interface AiThinkingIndicatorProps {
  // CPU が思考中 (= AI リクエスト in-flight) のときだけ表示する。
  visible: boolean;
  // 自動リトライ中は「長考中 ...」へ切替 (use-ai-request onAutoRetry 連動)。
  longThinking: boolean;
}

export function AiThinkingIndicator({ visible, longThinking }: AiThinkingIndicatorProps) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center"
      aria-live="polite"
      data-testid="ai-thinking-indicator"
    >
      <div className="animate-pulse rounded-full bg-black/60 px-5 py-2 text-sm font-medium text-white/90 shadow-lg sm:text-base">
        {longThinking ? "長考中 ..." : "考え中 ..."}
      </div>
    </div>
  );
}
