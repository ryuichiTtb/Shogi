// Issue #79: 音源調整ツール (/dev/sound-tuner) で「どの SFX イベントにどの mp3
// を割り当てるか」を localStorage に保存する小さなストア。flight-params.ts と
// 同じ構造 (useSyncExternalStore + storage event 購読) を踏襲。
//
// オーバーライドが保存されると、useSound 経由で本番ゲーム (/play /classic) の
// SFX 再生にも即時反映される (同タブ内は listeners 通知、別タブは storage event)。
// localStorage に値が無い一般ユーザーには影響なし (manifest.ts の既定値で動作)。

import { useSyncExternalStore } from "react";

import { AUDIO_MANIFEST, SFX_FILES } from "@/lib/audio/manifest";

// SFX_FILES のキー (12 種)。順序は UI 一覧の表示順を兼ねる。
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
  | "trap_trigger";

export const SFX_EVENT_KEYS: readonly SfxEventKey[] = [
  "piece_move",
  "piece_jump",
  "piece_capture",
  "piece_promote",
  "piece_drop",
  "check",
  "game_over",
  "game_start",
  "card_draw",
  "card_play",
  "mana_charge",
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
  card_draw: "カードドロー",
  card_play: "カードプレイ",
  mana_charge: "マナチャージ",
  trap_trigger: "トラップ発動",
};

// ホワイトリスト: AUDIO_MANIFEST.sfxUrls (manifest.ts の SFX_URLS) を再利用し
// 二重管理を避ける。manifest に新ファイルが追加されたら自動的にこちらも追従。
// localStorage 改ざん防御の要なので validation で必ず通す。
export function isAllowedSoundPath(p: string): boolean {
  return (AUDIO_MANIFEST.sfxUrls as readonly string[]).includes(p);
}

// SfxEventKey の集合判定 (parseStored で利用)。
const EVENT_KEY_SET: ReadonlySet<string> = new Set(SFX_EVENT_KEYS);

export type SoundOverrides = Partial<Record<SfxEventKey, string>>;

export const DEFAULT_SOUND_OVERRIDES: SoundOverrides = {};

const STORAGE_KEY = "dev:sound-overrides:v1";

// JSON パース + バリデーション。未知の event key・未知の path は drop する。
// 完全に invalid な JSON はデフォルト (= 空オブジェクト) を返す。
export function parseStored(raw: string | null): SoundOverrides {
  if (!raw) return DEFAULT_SOUND_OVERRIDES;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return DEFAULT_SOUND_OVERRIDES;
    }
    const result: SoundOverrides = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!EVENT_KEY_SET.has(k)) continue;
      if (typeof v !== "string" || !isAllowedSoundPath(v)) continue;
      result[k as SfxEventKey] = v;
    }
    return result;
  } catch {
    return DEFAULT_SOUND_OVERRIDES;
  }
}

let cached: SoundOverrides | null = null;
const listeners = new Set<() => void>();

function readStorage(): SoundOverrides {
  if (typeof window === "undefined") return DEFAULT_SOUND_OVERRIDES;
  try {
    return parseStored(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SOUND_OVERRIDES;
  }
}

function getSnapshot(): SoundOverrides {
  if (cached === null) cached = readStorage();
  return cached;
}

function getServerSnapshot(): SoundOverrides {
  return DEFAULT_SOUND_OVERRIDES;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 別タブから保存/削除された場合に追従するため storage イベントを購読する。
// モジュール初回 import 時に 1 回だけ登録する。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cached = readStorage();
      listeners.forEach((l) => l());
    }
  });
}

function persistAndNotify(next: SoundOverrides): void {
  cached = next;
  if (typeof window !== "undefined") {
    try {
      // 空オブジェクトなら remove、それ以外は set
      if (Object.keys(next).length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // quota 等のエラーは握り潰す (cached は更新済なので画面には反映される)
    }
  }
  listeners.forEach((l) => l());
}

// useSyncExternalStore で localStorage の値に追従。
// SSR では DEFAULT (空) を返し、クライアント mount 後に保存値があれば差し替える。
export function useSoundOverrides(): SoundOverrides {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// 1 イベントの割り当てを保存。filePath は isAllowedSoundPath を通過したものに限る。
export function saveSoundOverride(key: SfxEventKey, filePath: string): void {
  if (!isAllowedSoundPath(filePath)) return;
  const current = getSnapshot();
  persistAndNotify({ ...current, [key]: filePath });
}

// 1 イベントの割り当てをクリア (デフォルト = manifest の値に戻る)。
export function resetSoundOverride(key: SfxEventKey): void {
  const current = getSnapshot();
  if (!(key in current)) return;
  const next: SoundOverrides = { ...current };
  delete next[key];
  persistAndNotify(next);
}

// 全オーバーライドを削除。
export function resetAllSoundOverrides(): void {
  if (Object.keys(getSnapshot()).length === 0) return;
  persistAndNotify(DEFAULT_SOUND_OVERRIDES);
}

// useSound などフック外から同期的に「現在有効な SFX URL」を引くためのヘルパ。
// オーバーライドが無効値 (削除済 path 等) なら manifest 既定値にフォールバック。
// 戻り値は string を保証 (SFX_FILES に必ず key が存在する前提)。
export function getEffectiveSfxPath(key: SfxEventKey): string {
  const overrides = getSnapshot();
  const overridden = overrides[key];
  if (overridden && isAllowedSoundPath(overridden)) return overridden;
  return SFX_FILES[key];
}
