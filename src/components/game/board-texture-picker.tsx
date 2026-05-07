"use client";

// Issue #177: 対局画面 (画面全体) の背景素材を確認するためのフローティング UI。
// プレビュー目的のため localStorage 等への永続化はしない。
// 将棋盤背景は /board-design ページの永続設定 (BoardLayoutProvider) で扱う。
import { SCREEN_TEXTURES, useScreenTextureControls } from "./board-texture-context";

export function ScreenBackgroundPicker() {
  const ctx = useScreenTextureControls();
  if (!ctx) return null;
  return (
    <div className="fixed top-2 right-2 z-50 rounded-lg border bg-background/90 px-2 py-1.5 shadow-md backdrop-blur-sm flex items-center gap-2 text-xs">
      <label htmlFor="screen-texture-select" className="font-medium whitespace-nowrap">
        画面背景
      </label>
      <select
        id="screen-texture-select"
        value={ctx.texture.id}
        onChange={(e) => ctx.setTextureById(e.target.value)}
        className="rounded border bg-background px-1.5 py-0.5 text-xs"
      >
        {SCREEN_TEXTURES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
