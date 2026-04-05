import type { Move } from "../types";

export type TTFlag = "exact" | "lower" | "upper";

export interface TTEntry {
  hash: number;
  depth: number;
  score: number;
  flag: TTFlag;
  bestMove: Move | null;
  age: number;
}

const TT_SIZE = 1 << 22; // 4M entries
const TT_MASK = TT_SIZE - 1;

export class TranspositionTable {
  private table: (TTEntry | undefined)[];
  private currentAge: number;

  constructor() {
    this.table = new Array(TT_SIZE);
    this.currentAge = 0;
  }

  probe(hash: number): TTEntry | undefined {
    const idx = hash & TT_MASK;
    const entry = this.table[idx];
    if (entry && entry.hash === hash) {
      return entry;
    }
    return undefined;
  }

  store(
    hash: number,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Move | null
  ): void {
    const idx = hash & TT_MASK;
    const existing = this.table[idx];

    // Replacement strategy: replace if same hash, older entry, or shallower depth
    if (
      !existing ||
      existing.hash === hash ||
      existing.age < this.currentAge ||
      existing.depth <= depth
    ) {
      this.table[idx] = {
        hash,
        depth,
        score,
        flag,
        bestMove,
        age: this.currentAge,
      };
    }
  }

  newSearch(): void {
    this.currentAge++;
  }

  clear(): void {
    this.table = new Array(TT_SIZE);
    this.currentAge = 0;
  }
}
