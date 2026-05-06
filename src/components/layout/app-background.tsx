// Issue #117: 全画面共通の背景レイヤー。
// fixed inset-0 -z-10 で配置し、ベースグラデ + 青海波パターン + 浮遊オーブ + 光源の
// 4 レイヤーを variant に応じて段階的に表示する。
// CardBackProvider の現在のスタイルに合わせて装飾色を切り替えるが、
// SSR/CSR 整合のため mounted 完了までユーザー設定依存レイヤーを描画しない。
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCardBackStyle } from "@/components/card-back/card-back-provider";

export type AppBackgroundVariant = "hero" | "setup" | "page";

interface AppBackgroundProps {
  variant?: AppBackgroundVariant;
}

// 青海波 SVG (back-seigaiha.tsx と同一定義の再利用)
const SEIGAIHA_DATA_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 10' width='20' height='10'><g fill='none' stroke='%23fbbf24' stroke-opacity='0.28' stroke-width='0.6'><path d='M0 10 A10 10 0 0 1 20 10'/><path d='M-10 5 A10 10 0 0 1 10 5'/><path d='M10 5 A10 10 0 0 1 30 5'/></g></svg>\")";

export function AppBackground({ variant = "page" }: AppBackgroundProps) {
  const { style } = useCardBackStyle();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // ハイドレーション完了までは「ユーザー設定依存」のレイヤーを描画しない。
  // ベースグラデのみ常時描画して安全側に倒す。
  const showDecorative = mounted;

  // style に応じて浮遊オーブの差し色を切り替え。設定ハイブが届くまでは中立な amber。
  const orbColors = pickOrbColors(showDecorative ? style : null);

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden>
      {/* Layer 0: ベースグラデ (全 variant 共通) */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background" />

      {/* Layer 1: 青海波パターン (page を含む全 variant) */}
      {showDecorative && (
        <div
          className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
          style={{
            backgroundImage: SEIGAIHA_DATA_URL,
            backgroundSize: "60px 30px",
          }}
        />
      )}

      {/* Layer 2: 浮遊オーブ × 2 (setup / hero のみ) */}
      {showDecorative && (variant === "setup" || variant === "hero") && (
        <>
          <div
            className="home-bg-orb home-bg-orb-a"
            style={{ background: orbColors.a }}
          />
          <div
            className="home-bg-orb home-bg-orb-b"
            style={{ background: orbColors.b }}
          />
        </>
      )}

      {/* Layer 3: トップ近辺の柔らかい光源 (hero のみ) */}
      {showDecorative && variant === "hero" && (
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-[55vh] opacity-50 dark:opacity-30",
          )}
          style={{
            background:
              "radial-gradient(ellipse 60% 100% at 50% 0%, var(--hero-overlay-from, oklch(0.97 0.05 80)) 0%, transparent 70%)",
          }}
        />
      )}
    </div>
  );
}

// 浮遊オーブの差し色。card-back スタイルの世界観に合わせる。
function pickOrbColors(style: string | null) {
  switch (style) {
    case "minimal":
      return {
        a: "radial-gradient(circle, rgba(250, 204, 21, 0.55), transparent 70%)",
        b: "radial-gradient(circle, rgba(202, 138, 4, 0.45), transparent 70%)",
      };
    case "emblem":
      return {
        a: "radial-gradient(circle, rgba(251, 191, 36, 0.55), transparent 70%)",
        b: "radial-gradient(circle, rgba(120, 53, 15, 0.45), transparent 70%)",
      };
    case "kokeA":
    case "kokeB":
    case "kokeC":
      // 苔 3 variant は同じ深緑×金の世界観。オーブ色も共通。
      return {
        a: "radial-gradient(circle, rgba(252, 211, 77, 0.50), transparent 70%)",
        b: "radial-gradient(circle, rgba(6, 78, 59, 0.55), transparent 70%)",
      };
    case "sasa":
      // 翠: 深緑ベース + ゴールド差し色
      return {
        a: "radial-gradient(circle, rgba(252, 211, 77, 0.50), transparent 70%)",
        b: "radial-gradient(circle, rgba(4, 120, 87, 0.50), transparent 70%)",
      };
    case "seigaiha":
    default:
      // mounted 前 (style=null) もこの中立配色で描画される (実際は showDecorative=false で非表示)
      return {
        a: "radial-gradient(circle, rgba(251, 191, 36, 0.50), transparent 70%)",
        b: "radial-gradient(circle, rgba(99, 102, 241, 0.45), transparent 70%)",
      };
  }
}
