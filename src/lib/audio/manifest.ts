// Step 4 (Issue #107): SFX のパスを 1 ファイルに集約する。
// Issue #79 (PR 1.7): SFX を 18 event に拡張、BGM_FILES を新設、
// SOUND_POOL は scripts/build-waveform-peaks.ts が glob scan した結果
// (= waveform-peaks-data.ts) を single source of truth として import。
//
// 注意: public/sw.js の PRECACHE_ASSETS は現状 hand-coded で同期していない。
// SW 経由のキャッシュ範囲を変えるときは sw.js 側も合わせて更新する。

import { WAVEFORM_PEAKS } from "@/lib/dev/waveform-peaks-data";

// SFX (短尺・タップで即時再生される効果音)。
// 値が空文字 `""` の event は「未割当」で、playSfx 側でガードして無音 skip。
// Web Audio API モードで Howler に渡されるためデコード済みバッファとして保持される。
export const SFX_FILES: Record<string, string> = {
  // 既存 SFX (8 + カード将棋用 4 = 12 event)
  piece_move: "/sounds/piece-move.mp3",
  piece_jump: "/sounds/jump.mp3",
  piece_capture: "/sounds/piece-capture.mp3",
  piece_promote: "/sounds/piece-promote.mp3",
  piece_drop: "/sounds/piece-drop.mp3",
  check: "/sounds/check.mp3",
  game_over: "/sounds/game-over.mp3",
  game_start: "/sounds/game-start.mp3",
  // カード将棋用 SE (Phase 0 では既存ファイルをエイリアスとして再利用、Phase A 以降で差替予定)
  card_draw: "/sounds/piece-drop.mp3",
  card_play: "/sounds/piece-move.mp3",
  mana_charge: "/sounds/piece-promote.mp3",
  trap_trigger: "/sounds/check.mp3",
  // ★ Issue #79 PR 1.7: 新 SFX event 6 個
  // 採用候補マーク付き音源を default に設定。未割当のものは "" で playSfx 側でガード。
  trap_set:
    "/sounds/音源/トラップセット/【トラップセット採用候補】狙撃銃のボルトアクション.mp3",
  card_to_hand: "/sounds/音源/カード/手札IN/刀を鞘にしまう1（ｶﾁｬｯ）.mp3",
  draw_card_open_common: "",
  draw_card_open_rare: "",
  draw_card_open_super_rare: "",
  draw_card_open_epic: "",
};

// BGM (画面/状態別ループ再生される長尺素材)。
// 値が空文字 `""` の event は「未割当」で、useBgm 側でガードして再生しない。
// HTML5 Audio モード (html5: true) でストリーミング再生する。
export const BGM_FILES: Record<string, string> = {
  bgm_home: "",
  bgm_match_setup: "",
  bgm_game: "",
  bgm_game_over: "",
};

// SFX の物理的な URL リスト (空文字除外 + 重複排除済み)。
// useAssetPreloader が初回 fetch する対象。空文字 src で 404 を防ぐ。
export const SFX_URLS: readonly string[] = Array.from(
  new Set(Object.values(SFX_FILES).filter(Boolean)),
);

// BGM の物理的な URL リスト (空文字除外)。
// 現状 preload はしない (cache-first SW で初回再生時のみ fetch)。
export const BGM_URLS: readonly string[] = Array.from(
  new Set(Object.values(BGM_FILES).filter(Boolean)),
);

// dev tool で選択可能な全音源プール。peaks-data の key (= public/sounds 配下の
// 全 mp3) を single source of truth として参照。
// scripts/build-waveform-peaks.ts が glob scan した結果に追従する。
export const SOUND_POOL: readonly string[] = Object.freeze(
  Object.keys(WAVEFORM_PEAKS),
);

// 統合マニフェスト。useAssetPreloader / use-sound.ts / use-bgm.ts /
// dev tool から参照する。
export interface AssetManifest {
  sfx: Record<string, string>;
  sfxUrls: readonly string[];
  bgm: Record<string, string>;
  bgmUrls: readonly string[];
  poolUrls: readonly string[];
}

export const AUDIO_MANIFEST: AssetManifest = {
  sfx: SFX_FILES,
  sfxUrls: SFX_URLS,
  bgm: BGM_FILES,
  bgmUrls: BGM_URLS,
  poolUrls: SOUND_POOL,
};
