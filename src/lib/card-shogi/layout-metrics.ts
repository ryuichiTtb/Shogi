import {
  SHOGI_BOARD_CELLS,
  getShogiBoardGridSize,
  getShogiBoardLabelSize,
} from "@/lib/shogi/board-layout";

export type CardShogiLayoutMode = "mobile" | "tablet" | "largeDesktop";

export interface CardShogiViewportSpec {
  name: string;
  width: number;
  height: number;
  kind: "mobile" | "desktop";
  deviceScaleFactor: number;
  isMobile: boolean;
}

export interface CardBoardArea {
  viewportWidth: number;
  viewportHeight: number;
  availableWidth?: number;
  availableHeight?: number;
  mode?: CardShogiLayoutMode;
}

export interface ShogiBoardOuterSize {
  width: number;
  height: number;
  gridWidth: number;
  gridHeight: number;
  cellWidth: number;
  cellHeight: number;
  labelSize: number;
}

export interface CardBoardSizeResult {
  squareSize: number;
  mode: CardShogiLayoutMode;
  availableWidth: number;
  availableHeight: number;
  board: ShogiBoardOuterSize;
  capturedWidth: number;
  capturedHeight: number;
  requiredWidth: number;
  requiredHeight: number;
  limitingAxis: "width" | "height" | "both";
  usedEmergencyFloor: boolean;
}

export const CARD_SHOGI_MOBILE_BREAKPOINT = 768;
export const CARD_SHOGI_LARGE_DESKTOP_BREAKPOINT = 1280;

export const CARD_SHOGI_VIEWPORT_MATRIX: CardShogiViewportSpec[] = [
  { name: "mobile-320x568", width: 320, height: 568, kind: "mobile", deviceScaleFactor: 2, isMobile: true },
  { name: "mobile-360x640", width: 360, height: 640, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "mobile-360x740", width: 360, height: 740, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "mobile-375x812", width: 375, height: 812, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "mobile-390x844", width: 390, height: 844, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "mobile-393x852", width: 393, height: 852, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "mobile-414x896", width: 414, height: 896, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "mobile-430x932", width: 430, height: 932, kind: "mobile", deviceScaleFactor: 3, isMobile: true },
  { name: "desktop-1280x800", width: 1280, height: 800, kind: "desktop", deviceScaleFactor: 1, isMobile: false },
  { name: "desktop-1366x768", width: 1366, height: 768, kind: "desktop", deviceScaleFactor: 1, isMobile: false },
  { name: "desktop-1440x900", width: 1440, height: 900, kind: "desktop", deviceScaleFactor: 1, isMobile: false },
  { name: "desktop-1920x1080", width: 1920, height: 1080, kind: "desktop", deviceScaleFactor: 1, isMobile: false },
];

const BOARD_TOP_LABEL_GAP = 2;
const RANK_LABEL_GAP = 2;
const DESKTOP_LEFT_LABEL_EXTRA = 6;
const CAPTURED_WIDTH_EXTRA = 60;
const CAPTURED_HEIGHT = 72;
const CAPTURED_HEIGHT_COMPACT = 52;
const STACK_GAP_MOBILE_TABLET = 2;
const STACK_GAP_DESKTOP = 4;
const TABLET_STATUS_BAR_HEIGHT = 28;
const MIN_SQUARE_SIZE = 32;
const EMERGENCY_MIN_SQUARE_SIZE = 26;
const MAX_SQUARE_SIZE = 64;

export function getCardShogiLayoutMode(viewportWidth: number): CardShogiLayoutMode {
  if (viewportWidth < CARD_SHOGI_MOBILE_BREAKPOINT) return "mobile";
  if (viewportWidth >= CARD_SHOGI_LARGE_DESKTOP_BREAKPOINT) return "largeDesktop";
  return "tablet";
}

export function getCardShogiBoardLabelSize(squareSize: number, mode: CardShogiLayoutMode): number {
  return getShogiBoardLabelSize(squareSize, mode === "mobile");
}

export function getShogiBoardOuterSize(squareSize: number, mode: CardShogiLayoutMode): ShogiBoardOuterSize {
  const labelSize = getCardShogiBoardLabelSize(squareSize, mode);
  const grid = getShogiBoardGridSize(squareSize);
  const leftSpacer = mode === "mobile" ? 0 : labelSize + DESKTOP_LEFT_LABEL_EXTRA;
  return {
    width: leftSpacer + grid.width + RANK_LABEL_GAP + labelSize,
    height: labelSize + BOARD_TOP_LABEL_GAP + grid.height,
    gridWidth: grid.width,
    gridHeight: grid.height,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    labelSize,
  };
}

function getCapturedHeight(mode: CardShogiLayoutMode): number {
  return mode === "mobile" ? CAPTURED_HEIGHT_COMPACT : CAPTURED_HEIGHT;
}

function getStackGap(mode: CardShogiLayoutMode): number {
  return mode === "largeDesktop" ? STACK_GAP_DESKTOP : STACK_GAP_MOBILE_TABLET;
}

function getFallbackWidth(viewportWidth: number, mode: CardShogiLayoutMode): number {
  if (mode === "largeDesktop") return Math.max(260, viewportWidth - 220 - 240 - 220 - 48);
  return Math.max(260, Math.min(viewportWidth, 1024) - 16);
}

function getFallbackHeight(viewportHeight: number, mode: CardShogiLayoutMode): number {
  if (mode === "largeDesktop") return Math.max(360, viewportHeight - 64);
  if (mode === "tablet") return Math.max(360, viewportHeight - 180);
  return Math.max(320, viewportHeight - 180);
}

function getRequiredSize(squareSize: number, mode: CardShogiLayoutMode) {
  const board = getShogiBoardOuterSize(squareSize, mode);
  const capturedHeight = getCapturedHeight(mode);
  const capturedWidth = SHOGI_BOARD_CELLS * squareSize + CAPTURED_WIDTH_EXTRA;
  const stackGap = getStackGap(mode);
  const statusHeight = mode === "tablet" ? TABLET_STATUS_BAR_HEIGHT : 0;
  const requiredWidth = Math.ceil(Math.max(board.width, capturedWidth));
  const requiredHeight = Math.ceil(statusHeight + capturedHeight * 2 + board.height + stackGap * 2);
  return { board, capturedHeight, capturedWidth, requiredWidth, requiredHeight };
}

export function computeCardBoardSize(area: CardBoardArea): CardBoardSizeResult {
  const mode = area.mode ?? getCardShogiLayoutMode(area.viewportWidth);
  const availableWidth = Math.max(0, Math.floor(area.availableWidth ?? getFallbackWidth(area.viewportWidth, mode)));
  const availableHeight = Math.max(0, Math.floor(area.availableHeight ?? getFallbackHeight(area.viewportHeight, mode)));

  let squareSize = EMERGENCY_MIN_SQUARE_SIZE;
  for (let candidate = MAX_SQUARE_SIZE; candidate >= EMERGENCY_MIN_SQUARE_SIZE; candidate--) {
    const required = getRequiredSize(candidate, mode);
    if (required.requiredWidth <= availableWidth && required.requiredHeight <= availableHeight) {
      squareSize = candidate;
      break;
    }
  }

  const required = getRequiredSize(squareSize, mode);
  const widthTight = required.requiredWidth >= availableWidth - 1;
  const heightTight = required.requiredHeight >= availableHeight - 1;
  const limitingAxis = widthTight && heightTight ? "both" : widthTight ? "width" : "height";

  return {
    squareSize,
    mode,
    availableWidth,
    availableHeight,
    board: required.board,
    capturedWidth: required.capturedWidth,
    capturedHeight: required.capturedHeight,
    requiredWidth: required.requiredWidth,
    requiredHeight: required.requiredHeight,
    limitingAxis,
    usedEmergencyFloor: squareSize < MIN_SQUARE_SIZE,
  };
}
