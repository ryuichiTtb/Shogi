// Step 4 (Issue #107): SFX のパスを 1 ファイルに集約する。
// 旧: use-sound.ts に SFX_FILES が散在 → ロビーで先読みするときに
// 「どのアセットがあるか」を 1 ヶ所で参照するため manifest 化する。
//
// 注意: public/sw.js の PRECACHE_ASSETS は現状 hand-coded で同期していない。
// SW 経由のキャッシュ範囲を変えるときは sw.js 側も合わせて更新する
// (本マニフェストとの自動同期は Phase 後段で検討)。

// SFX (短尺・タップで即時再生される効果音)。
// Web Audio API モードで Howler に渡されるためデコード済みバッファとして保持される。
export const SFX_FILES: Record<string, string> = {
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
};

// SFX の物理的な URL リスト (重複排除済み)。先読み時に同 URL を 2 度
// load しないために使う。
export const SFX_URLS: readonly string[] = Array.from(
  new Set(Object.values(SFX_FILES)),
);

// 統合マニフェスト。useAssetPreloader / use-sound.ts から参照する。
export interface AssetManifest {
  sfx: Record<string, string>;
  sfxUrls: readonly string[];
}

export const AUDIO_MANIFEST: AssetManifest = {
  sfx: SFX_FILES,
  sfxUrls: SFX_URLS,
};
