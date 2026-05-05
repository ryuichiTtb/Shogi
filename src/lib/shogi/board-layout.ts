export const SHOGI_BOARD_CELLS = 9;
export const SHOGI_BOARD_GAP = 1;
export const SHOGI_BOARD_BORDER = 2;
export const SHOGI_BOARD_CELL_HEIGHT_RATIO = 1.08;

export interface ShogiBoardCellSize {
  width: number;
  height: number;
}

export interface ShogiBoardGridSize {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  border: number;
}

export function getShogiBoardCellSize(baseSize: number): ShogiBoardCellSize {
  const width = Math.max(1, Math.floor(baseSize));
  const height = Math.max(width + 1, Math.round(width * SHOGI_BOARD_CELL_HEIGHT_RATIO));
  return { width, height };
}

export function getShogiBoardGridSize(baseSize: number): ShogiBoardGridSize {
  const cell = getShogiBoardCellSize(baseSize);
  const innerGaps = (SHOGI_BOARD_CELLS - 1) * SHOGI_BOARD_GAP;
  return {
    width: SHOGI_BOARD_CELLS * cell.width + innerGaps + SHOGI_BOARD_BORDER,
    height: SHOGI_BOARD_CELLS * cell.height + innerGaps + SHOGI_BOARD_BORDER,
    cellWidth: cell.width,
    cellHeight: cell.height,
    gap: SHOGI_BOARD_GAP,
    border: SHOGI_BOARD_BORDER,
  };
}

export function getShogiBoardLabelSize(baseSize: number, isMobile: boolean): number {
  const labelSize = isMobile ? Math.max(12, baseSize * 0.3) : Math.max(16, baseSize * 0.45);
  return Math.round(labelSize);
}
