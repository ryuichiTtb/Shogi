// 学習データキャプチャの localStorage 永続化 (Issue #245 P0-3 リロード耐性)。
//
// client-only I/O。リロード / 戻る / 進む / 更新で in-memory バッファ (captureRef) が
// 揮発しても、本ストレージから復元して続きから記録できるようにする。
// SSR (window 不在) / quota 超過 / Private Mode の例外はすべて握り潰し、当該対局のみ
// 無記録に degrade する (best-effort、既存 board-layout-provider の localStorage 方針と整合)。
// capture.ts (純粋ロジック) の I/O を本モジュールへ分離し、capture.ts の純粋性を保つ。

import type { CaptureSnapshot } from "./capture";

const STORAGE_PREFIX = "training:";

function storageKey(gameId: string): string {
  return STORAGE_PREFIX + gameId;
}

export function readTrainingSnapshot(gameId: string): CaptureSnapshot {
  const empty: CaptureSnapshot = { samples: [], plyCounter: 0 };
  if (typeof window === "undefined") return empty; // SSR
  try {
    const raw = window.localStorage.getItem(storageKey(gameId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as CaptureSnapshot;
    // 壊れた JSON / 旧形式は空として扱う (握り潰し)。
    if (!parsed || !Array.isArray(parsed.samples) || typeof parsed.plyCounter !== "number") {
      return empty;
    }
    return parsed;
  } catch {
    return empty; // JSON 破損 / Private Mode 等
  }
}

export function writeTrainingSnapshot(gameId: string, snapshot: CaptureSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(gameId), JSON.stringify(snapshot));
  } catch {
    // quota 超過 / Private Mode 等 → 当該対局のみ無記録に degrade。
  }
}

export function clearTrainingSnapshot(gameId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(gameId));
  } catch {
    // ignore
  }
}
