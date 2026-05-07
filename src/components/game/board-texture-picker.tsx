"use client";

// Issue #177: 将棋盤背景の素材確認用フローティング UI。
// プレビュー目的のため localStorage 等への永続化はしない。
import { BOARD_TEXTURES, useBoardTextureControls } from "./board-texture-context";

export function BoardTexturePicker() {
  const ctx = useBoardTextureControls();
  if (!ctx) return null;
  return (
    <div className="fixed top-2 right-2 z-50 rounded-lg border bg-background/90 px-2 py-1.5 shadow-md backdrop-blur-sm flex items-center gap-2 text-xs">
      <label htmlFor="board-texture-select" className="font-medium whitespace-nowrap">
        盤背景
      </label>
      <select
        id="board-texture-select"
        value={ctx.texture.id}
        onChange={(e) => ctx.setTextureById(e.target.value)}
        className="rounded border bg-background px-1.5 py-0.5 text-xs"
      >
        {BOARD_TEXTURES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
