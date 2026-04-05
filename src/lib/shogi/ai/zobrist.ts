import type { GameState } from "../types";

// Dual 32-bit Zobrist hashing for collision resistance
// lo: TT index用 (22-bit mask), hi: 検証用 (32-bit full comparison)
// 実質54-bit衝突耐性

export type ZobristHash = { lo: number; hi: number };

const PIECE_TYPES = [
  "king",
  "rook",
  "bishop",
  "gold",
  "silver",
  "knight",
  "lance",
  "pawn",
  "promoted_rook",
  "promoted_bishop",
  "promoted_silver",
  "promoted_knight",
  "promoted_lance",
  "promoted_pawn",
];

const PLAYERS = ["sente", "gote"];
const HAND_TYPES = ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"];
const MAX_HAND_COUNT = 18;
const BOARD_SQUARES = 81;

// Random 32-bit unsigned integer
function randomUint32(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

// --- lo (TT index用) ---
export const PIECE_KEYS: Record<string, Record<string, number[]>> = {};
export const HAND_KEYS: Record<string, Record<string, number[]>> = {};
export const SIDE_TO_MOVE_KEY: number = randomUint32();

// --- hi (検証用) ---
export const PIECE_KEYS_HI: Record<string, Record<string, number[]>> = {};
export const HAND_KEYS_HI: Record<string, Record<string, number[]>> = {};
export const SIDE_TO_MOVE_KEY_HI: number = randomUint32();

// Initialize at module load
for (const pt of PIECE_TYPES) {
  PIECE_KEYS[pt] = {};
  PIECE_KEYS_HI[pt] = {};
  for (const pl of PLAYERS) {
    PIECE_KEYS[pt][pl] = Array.from({ length: BOARD_SQUARES }, () => randomUint32());
    PIECE_KEYS_HI[pt][pl] = Array.from({ length: BOARD_SQUARES }, () => randomUint32());
  }
}

for (const ht of HAND_TYPES) {
  HAND_KEYS[ht] = {};
  HAND_KEYS_HI[ht] = {};
  for (const pl of PLAYERS) {
    HAND_KEYS[ht][pl] = Array.from({ length: MAX_HAND_COUNT + 1 }, () => randomUint32());
    HAND_KEYS[ht][pl][0] = 0;
    HAND_KEYS_HI[ht][pl] = Array.from({ length: MAX_HAND_COUNT + 1 }, () => randomUint32());
    HAND_KEYS_HI[ht][pl][0] = 0;
  }
}

// Build a hash from scratch for a GameState
export function computeHash(state: GameState): ZobristHash {
  let lo = 0;
  let hi = 0;

  // Board pieces
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = state.board[row][col];
      if (piece) {
        const idx = row * 9 + col;
        const keysLo = PIECE_KEYS[piece.type]?.[piece.owner];
        const keysHi = PIECE_KEYS_HI[piece.type]?.[piece.owner];
        if (keysLo) lo = (lo ^ keysLo[idx]) >>> 0;
        if (keysHi) hi = (hi ^ keysHi[idx]) >>> 0;
      }
    }
  }

  // Hand pieces
  for (const pl of PLAYERS) {
    const hand = state.hand[pl as "sente" | "gote"];
    for (const ht of HAND_TYPES) {
      const count = hand[ht] ?? 0;
      if (count > 0 && count <= MAX_HAND_COUNT) {
        lo = (lo ^ HAND_KEYS[ht][pl][count]) >>> 0;
        hi = (hi ^ HAND_KEYS_HI[ht][pl][count]) >>> 0;
      }
    }
  }

  // Side to move
  if (state.currentPlayer === "gote") {
    lo = (lo ^ SIDE_TO_MOVE_KEY) >>> 0;
    hi = (hi ^ SIDE_TO_MOVE_KEY_HI) >>> 0;
  }

  return { lo, hi };
}
