import { describe, expect, it } from "vitest";

import {
  SHOGI_BOARD_CELLS,
  SHOGI_BOARD_GAP,
  getShogiBoardCellSize,
  getShogiBoardGridSize,
  getShogiBoardLabelSize,
} from "../board-layout";

describe("shogi board layout", () => {
  it("keeps board cells slightly portrait while staying on integer pixels", () => {
    expect(getShogiBoardCellSize(40)).toEqual({ width: 40, height: 43 });
    expect(getShogiBoardCellSize(64)).toEqual({ width: 64, height: 69 });
  });

  it("derives the visible grid size from cell width, cell height, gaps, and borders", () => {
    const grid = getShogiBoardGridSize(40);

    expect(grid.width).toBe(SHOGI_BOARD_CELLS * 40 + (SHOGI_BOARD_CELLS - 1) * SHOGI_BOARD_GAP + 2);
    expect(grid.height).toBe(SHOGI_BOARD_CELLS * 43 + (SHOGI_BOARD_CELLS - 1) * SHOGI_BOARD_GAP + 2);
    expect(grid.height).toBeGreaterThan(grid.width);
  });

  it("uses integer label sizes to avoid sub-pixel board offsets", () => {
    expect(getShogiBoardLabelSize(35, true)).toBe(12);
    expect(getShogiBoardLabelSize(57, false)).toBe(26);
  });
});
