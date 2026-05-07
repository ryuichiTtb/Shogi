"use client";

// Issue #177: 将棋盤背景・画面全体背景の素材確認用フローティング UI。
// プレビュー目的のため localStorage 等への永続化はしない。
import { BOARD_TEXTURES, useBoardTextureControls } from "./board-texture-context";

export function BoardTexturePicker() {
  const ctx = useBoardTextureControls();
  if (!ctx) return null;
  return (
    <div className="fixed top-2 right-2 z-50 rounded-lg border bg-background/90 px-2 py-1.5 shadow-md backdrop-blur-sm flex flex-col gap-1 text-xs">
      <Row
        label="盤背景"
        htmlFor="board-texture-select"
        value={ctx.boardTexture.id}
        onChange={ctx.setBoardTextureById}
      />
      <Row
        label="画面背景"
        htmlFor="screen-texture-select"
        value={ctx.screenTexture.id}
        onChange={ctx.setScreenTextureById}
      />
    </div>
  );
}

function Row({
  label,
  htmlFor,
  value,
  onChange,
}: {
  label: string;
  htmlFor: string;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="font-medium whitespace-nowrap w-16">
        {label}
      </label>
      <select
        id={htmlFor}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border bg-background px-1.5 py-0.5 text-xs flex-1"
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
