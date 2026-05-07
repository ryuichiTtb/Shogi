// Issue #79: 音源調整ツール (/dev/sound-tuner) で「どの SFX/BGM イベントに
// どの mp3 を割り当てるか」を localStorage に保存する小さなストア。
// flight-params.ts と同じ構造 (useSyncExternalStore + storage event 購読) を踏襲。
//
// SFX オーバーライドは PR 1 (#79-tuner-page) で実装、PR 2 (#79-tuner-wiring) で
// useSound と統合される予定。本 PR 1.7 時点では SFX_EVENT_KEYS の event 体系を
// 拡張 (12 → 18) しつつ、新たに BGM 用の override 系 API も追加する。
// BGM オーバーライドは use-bgm.ts が即座に反映する。
//
// localStorage に値が無い一般ユーザーには影響なし (manifest.ts の既定値で動作)。

import { useSyncExternalStore } from "react";

import { AUDIO_MANIFEST, BGM_FILES, SFX_FILES } from "@/lib/audio/manifest";

// =====================
// SFX (効果音)
// =====================

// SFX_FILES のキー (18 種)。順序は UI 一覧の表示順を兼ねる。
export type SfxEventKey =
  | "piece_move"
  | "piece_jump"
  | "piece_capture"
  | "piece_promote"
  | "piece_drop"
  | "check"
  | "game_over"
  | "game_start"
  | "card_draw"
  | "card_play"
  | "mana_charge"
  | "trap_trigger"
  // ★ Issue #79 PR 1.7 で追加
  | "trap_set"
  | "card_to_hand"
  | "draw_card_open_common"
  | "draw_card_open_rare"
  | "draw_card_open_super_rare"
  | "draw_card_open_epic";

export const SFX_EVENT_KEYS: readonly SfxEventKey[] = [
  // 駒系
  "piece_move",
  "piece_jump",
  "piece_capture",
  "piece_promote",
  "piece_drop",
  // 対局系
  "check",
  "game_start",
  "game_over",
  // カード系
  "card_draw",
  "draw_card_open_common",
  "draw_card_open_rare",
  "draw_card_open_super_rare",
  "draw_card_open_epic",
  "card_to_hand",
  "card_play",
  "mana_charge",
  "trap_set",
  "trap_trigger",
];

// 一覧 / 詳細ページで日本語表示するためのラベル。
export const SFX_EVENT_LABELS: Record<SfxEventKey, string> = {
  piece_move: "駒を動かす",
  piece_jump: "駒が飛ぶ (桂馬等)",
  piece_capture: "駒を取る",
  piece_promote: "成る",
  piece_drop: "駒を打つ",
  check: "王手",
  game_over: "対局終了",
  game_start: "対局開始",
  card_draw: "カードドロー (山札)",
  card_play: "カードプレイ",
  mana_charge: "マナチャージ",
  trap_trigger: "トラップ発動",
  trap_set: "トラップセット",
  card_to_hand: "手札 IN",
  draw_card_open_common: "ドローカードオープン (Common)",
  draw_card_open_rare: "ドローカードオープン (Rare)",
  draw_card_open_super_rare: "ドローカードオープン (Super Rare)",
  draw_card_open_epic: "ドローカードオープン (Epic)",
};

// =====================
// BGM
// =====================

// BGM event 4 種 (画面/状態別)。
export type BgmEventKey =
  | "bgm_home"
  | "bgm_match_setup"
  | "bgm_game"
  | "bgm_game_over";

export const BGM_EVENT_KEYS: readonly BgmEventKey[] = [
  "bgm_home",
  "bgm_match_setup",
  "bgm_game",
  "bgm_game_over",
];

export const BGM_EVENT_LABELS: Record<BgmEventKey, string> = {
  bgm_home: "ホーム / ロビー",
  bgm_match_setup: "対局相手選択",
  bgm_game: "対局中",
  bgm_game_over: "対局終了",
};

// =====================
// 共通: ホワイトリスト
// =====================

// dev tool で割り当て可能な全音源 (74 ファイル)。manifest.poolUrls = SOUND_POOL を参照。
// localStorage 改ざん防御の要なので validation で必ず通す。
export function isAllowedSoundPath(p: string): boolean {
  return (AUDIO_MANIFEST.poolUrls as readonly string[]).includes(p);
}

const SFX_KEY_SET: ReadonlySet<string> = new Set(SFX_EVENT_KEYS);
const BGM_KEY_SET: ReadonlySet<string> = new Set(BGM_EVENT_KEYS);

// =====================
// SFX オーバーライド (localStorage)
// =====================

export type SoundOverrides = Partial<Record<SfxEventKey, string>>;

export const DEFAULT_SOUND_OVERRIDES: SoundOverrides = {};

const SFX_STORAGE_KEY = "dev:sound-overrides:v1";

// JSON パース + バリデーション (SFX 用)。未知 key/path は drop。
// 空文字 `""` は「明示的に未割り当て (鳴らさない)」を表す特殊値として許可する。
export function parseStored(raw: string | null): SoundOverrides {
  if (!raw) return DEFAULT_SOUND_OVERRIDES;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return DEFAULT_SOUND_OVERRIDES;
    }
    const result: SoundOverrides = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!SFX_KEY_SET.has(k)) continue;
      if (typeof v !== "string") continue;
      if (v !== "" && !isAllowedSoundPath(v)) continue;
      result[k as SfxEventKey] = v;
    }
    return result;
  } catch {
    return DEFAULT_SOUND_OVERRIDES;
  }
}

let cachedSfx: SoundOverrides | null = null;
const sfxListeners = new Set<() => void>();

function readSfxStorage(): SoundOverrides {
  if (typeof window === "undefined") return DEFAULT_SOUND_OVERRIDES;
  try {
    return parseStored(localStorage.getItem(SFX_STORAGE_KEY));
  } catch {
    return DEFAULT_SOUND_OVERRIDES;
  }
}

function getSfxSnapshot(): SoundOverrides {
  if (cachedSfx === null) cachedSfx = readSfxStorage();
  return cachedSfx;
}

function getSfxServerSnapshot(): SoundOverrides {
  return DEFAULT_SOUND_OVERRIDES;
}

function subscribeSfx(listener: () => void): () => void {
  sfxListeners.add(listener);
  return () => {
    sfxListeners.delete(listener);
  };
}

function persistSfxAndNotify(next: SoundOverrides): void {
  cachedSfx = next;
  if (typeof window !== "undefined") {
    try {
      if (Object.keys(next).length === 0) {
        localStorage.removeItem(SFX_STORAGE_KEY);
      } else {
        localStorage.setItem(SFX_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // quota 等は無視
    }
  }
  sfxListeners.forEach((l) => l());
}

export function useSoundOverrides(): SoundOverrides {
  return useSyncExternalStore(subscribeSfx, getSfxSnapshot, getSfxServerSnapshot);
}

export function saveSoundOverride(key: SfxEventKey, filePath: string): void {
  if (!isAllowedSoundPath(filePath)) return;
  const current = getSfxSnapshot();
  persistSfxAndNotify({ ...current, [key]: filePath });
}

/**
 * 該当 event の SFX を「鳴らさない」ように明示的に未割り当て化する。
 * 既定 (SFX_FILES) があっても再生されなくなる。元に戻すには
 * resetSoundOverride() で override 自体を削除する。
 */
export function unassignSoundOverride(key: SfxEventKey): void {
  const current = getSfxSnapshot();
  if (current[key] === "") return;
  persistSfxAndNotify({ ...current, [key]: "" });
}

export function resetSoundOverride(key: SfxEventKey): void {
  const current = getSfxSnapshot();
  if (!(key in current)) return;
  const next: SoundOverrides = { ...current };
  delete next[key];
  persistSfxAndNotify(next);
}

export function resetAllSoundOverrides(): void {
  if (Object.keys(getSfxSnapshot()).length === 0) return;
  persistSfxAndNotify(DEFAULT_SOUND_OVERRIDES);
}

// useSound などフック外から同期的に「現在有効な SFX URL」を引くヘルパ。
// 解決順:
//   1. override が存在 + 空文字 `""` → 「明示的に鳴らさない」→ "" を返す
//   2. override が存在 + ホワイトリスト適合 → その path
//   3. それ以外 → manifest 既定 (SFX_FILES[key])、それも無ければ ""
// 呼出側 (playSfx) で `if (!src) return;` ガードする前提。
export function getEffectiveSfxPath(key: SfxEventKey): string {
  const overrides = getSfxSnapshot();
  if (key in overrides) {
    const overridden = overrides[key]!;
    if (overridden === "") return ""; // 明示 unassign
    if (isAllowedSoundPath(overridden)) return overridden;
  }
  return SFX_FILES[key] ?? "";
}

// =====================
// BGM オーバーライド (localStorage)
// =====================

export type BgmOverrides = Partial<Record<BgmEventKey, string>>;
export const DEFAULT_BGM_OVERRIDES: BgmOverrides = {};

const BGM_STORAGE_KEY = "dev:bgm-overrides:v1";

// 空文字 `""` は「明示的に未割り当て (BGM 鳴らさない)」を表す特殊値として許可する。
export function parseBgmStored(raw: string | null): BgmOverrides {
  if (!raw) return DEFAULT_BGM_OVERRIDES;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return DEFAULT_BGM_OVERRIDES;
    }
    const result: BgmOverrides = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!BGM_KEY_SET.has(k)) continue;
      if (typeof v !== "string") continue;
      if (v !== "" && !isAllowedSoundPath(v)) continue;
      result[k as BgmEventKey] = v;
    }
    return result;
  } catch {
    return DEFAULT_BGM_OVERRIDES;
  }
}

let cachedBgm: BgmOverrides | null = null;
const bgmListeners = new Set<() => void>();

function readBgmStorage(): BgmOverrides {
  if (typeof window === "undefined") return DEFAULT_BGM_OVERRIDES;
  try {
    return parseBgmStored(localStorage.getItem(BGM_STORAGE_KEY));
  } catch {
    return DEFAULT_BGM_OVERRIDES;
  }
}

function getBgmSnapshot(): BgmOverrides {
  if (cachedBgm === null) cachedBgm = readBgmStorage();
  return cachedBgm;
}

function getBgmServerSnapshot(): BgmOverrides {
  return DEFAULT_BGM_OVERRIDES;
}

function subscribeBgm(listener: () => void): () => void {
  bgmListeners.add(listener);
  return () => {
    bgmListeners.delete(listener);
  };
}

function persistBgmAndNotify(next: BgmOverrides): void {
  cachedBgm = next;
  if (typeof window !== "undefined") {
    try {
      if (Object.keys(next).length === 0) {
        localStorage.removeItem(BGM_STORAGE_KEY);
      } else {
        localStorage.setItem(BGM_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // quota 等は無視
    }
  }
  bgmListeners.forEach((l) => l());
}

export function useBgmOverrides(): BgmOverrides {
  return useSyncExternalStore(subscribeBgm, getBgmSnapshot, getBgmServerSnapshot);
}

export function saveBgmOverride(key: BgmEventKey, filePath: string): void {
  if (!isAllowedSoundPath(filePath)) return;
  const current = getBgmSnapshot();
  persistBgmAndNotify({ ...current, [key]: filePath });
}

/**
 * 該当 event の BGM を「鳴らさない」ように明示的に未割り当て化する。
 * 既定 (BGM_FILES) があっても再生されなくなる。元に戻すには
 * resetBgmOverride() で override 自体を削除する。
 */
export function unassignBgmOverride(key: BgmEventKey): void {
  const current = getBgmSnapshot();
  if (current[key] === "") return;
  persistBgmAndNotify({ ...current, [key]: "" });
}

export function resetBgmOverride(key: BgmEventKey): void {
  const current = getBgmSnapshot();
  if (!(key in current)) return;
  const next: BgmOverrides = { ...current };
  delete next[key];
  persistBgmAndNotify(next);
}

export function resetAllBgmOverrides(): void {
  if (Object.keys(getBgmSnapshot()).length === 0) return;
  persistBgmAndNotify(DEFAULT_BGM_OVERRIDES);
}

// useBgm hook が同期的に「現在有効な BGM URL」を引くヘルパ。
// 解決順:
//   1. override が存在 + 空文字 `""` → 「明示的に鳴らさない」→ "" を返す
//   2. override が存在 + ホワイトリスト適合 → その path
//   3. それ以外 → manifest 既定 (BGM_FILES[key])、それも無ければ ""
export function getEffectiveBgmPath(key: BgmEventKey): string {
  const overrides = getBgmSnapshot();
  if (key in overrides) {
    const overridden = overrides[key]!;
    if (overridden === "") return ""; // 明示 unassign
    if (isAllowedSoundPath(overridden)) return overridden;
  }
  return BGM_FILES[key] ?? "";
}

// =====================
// 別タブからの storage event 購読 (SFX / BGM 共通)
// =====================

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SFX_STORAGE_KEY || e.key === null) {
      cachedSfx = readSfxStorage();
      sfxListeners.forEach((l) => l());
    }
    if (e.key === BGM_STORAGE_KEY || e.key === null) {
      cachedBgm = readBgmStorage();
      bgmListeners.forEach((l) => l());
    }
  });
}
