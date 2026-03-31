import type { GameState } from "../types";

// Zobrist hashing using 32-bit unsigned integers represented as numbers
// We use a pair [hi, lo] of 32-bit values for a 64-bit-equivalent hash
// to reduce collision probability.

export type ZobristHash = number; // 32-bit unsigned integer (sufficient for TT with 1M entries)

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

// PIECE_KEYS[pieceType][player] = number[] of length 81
export const PIECE_KEYS: Record<string, Record<string, number[]>> = {};

// HAND_KEYS[pieceType][player][count] (count 0..MAX_HAND_COUNT)
export const HAND_KEYS: Record<string, Record<string, number[]>> = {};

export const SIDE_TO_MOVE_KEY: number = randomUint32();

// Initialize at module load
for (const pt of PIECE_TYPES) {
  PIECE_KEYS[pt] = {};
  for (const pl of PLAYERS) {
    PIECE_KEYS[pt][pl] = Array.from({ length: BOARD_SQUARES }, () => randomUint32());
  }
}

for (const ht of HAND_TYPES) {
  HAND_KEYS[ht] = {};
  for (const pl of PLAYERS) {
    HAND_KEYS[ht][pl] = Array.from({ length: MAX_HAND_COUNT + 1 }, () => randomUint32());
    HAND_KEYS[ht][pl][0] = 0;
  }
}

// Build a hash from scratch for a GameState
export function computeHash(state: GameState): ZobristHash {
  let hash = 0;

  // Board pieces
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = state.board[row][col];
      if (piece) {
        const keys = PIECE_KEYS[piece.type]?.[piece.owner];
        if (keys) {
          hash = (hash ^ keys[row * 9 + col]) >>> 0;
        }
      }
    }
  }

  // Hand pieces
  for (const pl of PLAYERS) {
    const hand = state.hand[pl as "sente" | "gote"];
    for (const ht of HAND_TYPES) {
      const count = hand[ht] ?? 0;
      if (count > 0 && count <= MAX_HAND_COUNT) {
        hash = (hash ^ HAND_KEYS[ht][pl][count]) >>> 0;
      }
    }
  }

  // Side to move
  if (state.currentPlayer === "gote") {
    hash = (hash ^ SIDE_TO_MOVE_KEY) >>> 0;
  }

  return hash;
}
