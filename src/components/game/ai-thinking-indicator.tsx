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
// - ShogiBoard のグリッド div (relative) の直下に absolute inset-0 で重ねて描画される
//   (shogi-board.tsx)。これによりラベル行・列・スペーサーのオフセットに依らず常に
//   盤グリッドの中央に表示される (全レイアウト・先後で 1px 正確)。
// - z-[8] は BoardOverlay (王手・トラップ発動等のイベント演出、wrapper 側 z-10) より
//   下層に置き、イベント演出を常に優先表示する。
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
      {/* もう少し大きめの表示 (ユーザー要望): text-lg / sm 以上で text-xl。 */}
      <div className="animate-pulse rounded-full bg-black/65 px-7 py-3 text-lg font-semibold text-white shadow-lg sm:text-xl">
        {longThinking ? "長考中 ..." : "考え中 ..."}
      </div>
    </div>
  );
}
