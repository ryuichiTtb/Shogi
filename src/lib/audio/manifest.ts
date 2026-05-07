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
  // 駒系
  piece_move: "/sounds/piece-move.mp3",
  piece_jump: "/sounds/jump.mp3",
  piece_capture: "/sounds/piece-capture.mp3",
  piece_promote: "/sounds/piece-promote.mp3",
  piece_drop: "/sounds/piece-drop.mp3",
  // 駒のフライト演出 (歩戻し / 駒戻し / 王手崩し 等で発火)
  piece_flight: "/sounds/音源/振る/刀剣・投げナイフ.mp3",
  // 対局系
  check: "/sounds/check.mp3",
  // 詰み (王手と分離。専用音源 = 血しぶき)
  checkmate: "/sounds/音源/詰み/血しぶき・飛び散る03.mp3",
  // game_start / game_over は default 未割当 (鳴らさない)。dev tool で割当てると
  // 鳴るようになる。
  game_over: "",
  game_start: "",
  // カード系
  // 手動ドロー (山札クリック): Motion-Swish で軽く
  card_draw: "/sounds/音源/カード/山札ドロー/Motion-Swish01-01.mp3",
  // 自動ドロー (AI ターン後の relay): 旧 card_draw の値 (piece-drop) を継続
  card_auto_draw: "/sounds/piece-drop.mp3",
  card_play: "/sounds/piece-move.mp3",
  mana_charge: "/sounds/piece-promote.mp3",
  // トラップ発動: 剣で斬る (ざっくり) で重みを出す
  trap_trigger: "/sounds/音源/剣/剣で斬る3(ざっくり).mp3",
  trap_set:
    "/sounds/音源/トラップセット/【トラップセット採用候補】狙撃銃のボルトアクション.mp3",
  card_to_hand: "/sounds/音源/カード/手札IN/刀を鞘にしまう1（ｶﾁｬｯ）.mp3",
  // ドローカードオープン: 全レア度共通で「刀の素振り (シュピン)」(将来差別化予定)
  draw_card_open_common: "/sounds/音源/剣/刀の素振り1（シュピン）.mp3",
  draw_card_open_rare: "/sounds/音源/剣/刀の素振り1（シュピン）.mp3",
  draw_card_open_super_rare: "/sounds/音源/剣/刀の素振り1（シュピン）.mp3",
  draw_card_open_epic: "/sounds/音源/剣/刀の素振り1（シュピン）.mp3",
  // ★ Issue #79 派生: カード使用 3 段階
  // 1) 手札クリック (popup 表示) → カードをめくる音
  card_select: "/sounds/音源/カードをめくる.mp3",
  // 2) 使用ボタン押下 → サブマシンガンのボルトリリース (確定の重み)
  card_use_confirm:
    "/sounds/音源/トラップセット/サブマシンガンのボルトリリース.mp3",
  // 3) 使用演出発動 (中央 card flight) → 刀の素振り (シュピン)
  card_use_animation: "/sounds/音源/剣/刀の素振り1（シュピン）.mp3",
  // ★ Issue #79 派生: UI 系
  // デッキ編成のカード移動 (所持 ⇄ 編成) → 風のスワッシュ感
  deck_card_move: "/sounds/音源/振る/wind-blowing.mp3",
  // デッキ編成 保存ボタン → 小鼓 (こつづみ) で和の確定感
  deck_save: "/sounds/音源/和/小鼓（こつづみ）.mp3",
  // 画面遷移ボタン (戻る以外) → 軽い駒移動音
  nav_forward: "/sounds/piece-move.mp3",
  // 画面遷移 戻るボタン → ナイフを投げる音
  nav_back: "/sounds/音源/振る/ナイフを投げる.mp3",
};

// BGM (画面/状態別ループ再生される長尺素材)。
// 値が空文字 `""` の event は「未割当」で、useBgm 側でガードして再生しない。
// HTML5 Audio モード (html5: true) でストリーミング再生する。
//
// Issue #79 派生のユーザ要望:
//   - ホーム / 対局相手選択など 対局画面以外: ファンタジー-日常-.mp3 (連続再生)
//   - 対局中 / 対局終了画面: RPG_Battle_01.mp3
// 同一 path を bgm_home / bgm_match_setup に設定することで、ホーム → /play
// 遷移で BGM がリスタートしないように useBgm 側で same-path 早期 return する。
export const BGM_FILES: Record<string, string> = {
  bgm_home: "/sounds/音源/BGM/ファンタジー-日常-.mp3",
  bgm_match_setup: "/sounds/音源/BGM/ファンタジー-日常-.mp3",
  bgm_game: "/sounds/音源/BGM/RPG_Battle_01.mp3",
  bgm_game_over: "/sounds/音源/BGM/RPG_Battle_01.mp3",
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
