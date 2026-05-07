"use client";

// Issue #177: 対局画面全体の背景を切替確認するためのラッパー。
// screenTexture が default (=null URL) のときは既存の AppBackground (青海波 + オーブ)
// を描画し、テクスチャ選択時は fixed 全画面の背景画像レイヤーに切り替える。
// プレビュー用なので永続化なし。
import { AppBackground } from "@/components/layout/app-background";
import { useScreenTexture } from "./board-texture-context";

export function PreviewScreenBackground() {
  const screen = useScreenTexture();
  if (!screen.url) {
    return <AppBackground variant="setup" />;
  }
  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        backgroundImage: `url(${screen.url})`,
        // 縦横比を保ったまま画面短辺に合わせて拡大し、画面全体をカバー。
        // 1 枚のみ表示 (no-repeat)、画面より大きくなった分は右下方向にはみ出す
        // (= 左上アンカー、右/下 を切り落とす) よう background-position を top left に。
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "top left",
      }}
      aria-hidden
    />
  );
}
