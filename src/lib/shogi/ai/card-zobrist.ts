// Issue #235 S4c-2a: cardState 用 Zobrist fold キー + computeCardFold。
//
// 目的: WorldState 探索 (S4c-2b) の TT key = boardHash ^ cardFold。本ファイルは cardState の
// 各 slice を `{lo, hi}` 32bit×2 の Zobrist キーへ畳み込む (zobrist.ts と同形式、XOR 合成)。
// move-only の zobrist.ts (盤+持駒+手番) は無改変。card slice 専用の別キー表を新設する。
//
// fold 方針は `CARD_STATE_FOLD_POLICY` (tt-fold-policy.ts) が正本:
//   - "fold":           内容 (正規化後) を畳み込む。mana / hand / trap / noPromoteMarks / drawProgress。
//   - "foldLength":     length のみ畳み込む。deck。
//   - "evalIrrelevant": 畳み込まない。graveyard / manaCap / pendingCard / lastTurnStartedAt。
// computeCardFold が上記 fold/foldLength slice のみを XOR する。網羅性 (slice 追加時の漏れ検出) は
// card-zobrist.test.ts が CARD_STATE_FOLD_POLICY と突き合わせて保証する。
//
// 誤 hit ゼロ (R-3) のための実装上の要点 (M1 §13.8 反映):
//   - hand: defId 多重集合で正規化 (順序非依存)。getCardActions が instanceId 非依存ゆえ defId count
//           で合法 card action 集合が一意に決まる。
//   - noPromoteMarks: **count でなく position で fold**。mark-aware 合法手生成 (moves.ts isNoPromoteLocked)
//           は座標を読むため、count 一致でも position 違いは別局面 = 別 key。
//   - deck: length のみ (canDraw は length 参照、内容差は draw 後の hand fold が別 key に分離)。
//   - 値域上限を config 由来で定数化 (マジックナンバー禁止、AGENTS 10)。境界超過は防御 clamp
//     (実ゲームでは到達しない深さ。clamp 起因の誤 hit は depth>MAX_DRAW_PROGRESS 等の非現実局面のみ)。
//   - doubleMove (WorldState フィールド、CardGameState に無し) は S4c-1 では常時 null ゆえ非対象。
//     **S4c-1d で double_move を木に入れる際は TT key 構築側 (search.ts) で doubleMove を fold へ
//     加える必要あり (型網羅ガードが効かないので要注意)**。

import type { CardGameState, CardId } from "../cards/types";
import type { Player } from "../types";
import type { ZobristHash } from "./zobrist";
import { MANA_CAP, AUTO_DRAW_INTERVAL, DECK_TOTAL_MAX } from "../cards/card-system-config";
import { MAX_DEPTH } from "./search-context";

// fold 対象 CardId 全種 (hand/trap キー表の次元)。CardId union と一致させる
// (card-zobrist.test.ts が CardId 網羅を検証)。
export const CARD_IDS: readonly CardId[] = [
  "mana_up",
  "pawn_return",
  "no_promote",
  "double_pawn",
  "piece_return",
  "check_break",
  "double_move",
];

const PLAYERS: readonly Player[] = ["sente", "gote"];
const BOARD_SQUARES = 81;

// 値域上限 (config 由来 + 探索深さ余裕)。境界超過は clamp (防御、実局面で非到達)。
const MAX_MANA = MANA_CAP; // mana: 0..MANA_CAP
const MAX_HAND_CARD_COUNT = DECK_TOTAL_MAX; // 同一 defId の所持上限 ≤ デッキ総数
const MAX_DECK_LEN = DECK_TOTAL_MAX; // deck length: 0..DECK_TOTAL_MAX
// drawProgress は通常 0..AUTO_DRAW_INTERVAL だが deck 枯渇時は reset されず探索深さ分 +1 され得る
// (types.ts CardGameState コメント)。探索は MAX_DEPTH 手まで → 余裕を持って AUTO_DRAW_INTERVAL+MAX_DEPTH。
const MAX_DRAW_PROGRESS = AUTO_DRAW_INTERVAL + MAX_DEPTH;

type Key = { lo: number; hi: number };

function randomUint32(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
function randKey(): Key {
  return { lo: randomUint32(), hi: randomUint32() };
}
function randKeyArray(len: number): Key[] {
  return Array.from({ length: len }, randKey);
}
function byPlayer<T>(make: () => T): Record<Player, T> {
  return { sente: make(), gote: make() };
}
function clampIndex(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}
function xorKey(h: ZobristHash, k: Key): ZobristHash {
  return { lo: (h.lo ^ k.lo) >>> 0, hi: (h.hi ^ k.hi) >>> 0 };
}

// ===== キー表 (module load 時 random) =====
const MANA_KEYS: Record<Player, Key[]> = byPlayer(() => randKeyArray(MAX_MANA + 1));
const HAND_CARD_KEYS: Record<Player, Record<CardId, Key[]>> = byPlayer(() => {
  const rec = {} as Record<CardId, Key[]>;
  for (const id of CARD_IDS) rec[id] = randKeyArray(MAX_HAND_CARD_COUNT + 1);
  return rec;
});
const TRAP_KEYS: Record<Player, Record<CardId, Key>> = byPlayer(() => {
  const rec = {} as Record<CardId, Key>;
  for (const id of CARD_IDS) rec[id] = randKey();
  return rec;
});
const MARK_KEYS: Record<Player, Key[]> = byPlayer(() => randKeyArray(BOARD_SQUARES));
const DRAW_PROGRESS_KEYS: Record<Player, Key[]> = byPlayer(() =>
  randKeyArray(MAX_DRAW_PROGRESS + 1),
);
const DECK_LEN_KEYS: Record<Player, Key[]> = byPlayer(() => randKeyArray(MAX_DECK_LEN + 1));

// 同一 defId 所持数を数える (hand 多重集合の正規化)。
function countByDefId(cards: { defId: CardId }[]): Map<CardId, number> {
  const m = new Map<CardId, number>();
  for (const c of cards) m.set(c.defId, (m.get(c.defId) ?? 0) + 1);
  return m;
}

// cardState を fold した {lo, hi}。TT key = computeHash(board) ^ computeCardFold(cardState)。
// 毎ノード full 計算 (O(hand + mark + 定数) = 小、incremental は誤りの温床ゆえ避ける)。
export function computeCardFold(cardState: CardGameState): ZobristHash {
  let h: ZobristHash = { lo: 0, hi: 0 };
  for (const p of PLAYERS) {
    // mana (fold)
    h = xorKey(h, MANA_KEYS[p][clampIndex(cardState.mana[p], MAX_MANA)]);
    // hand (fold, defId 多重集合)
    const counts = countByDefId(cardState.hand[p]);
    for (const [id, c] of counts) {
      if (c > 0) h = xorKey(h, HAND_CARD_KEYS[p][id][clampIndex(c, MAX_HAND_CARD_COUNT)]);
    }
    // trap (fold, defId)
    const trap = cardState.trap[p];
    if (trap) h = xorKey(h, TRAP_KEYS[p][trap.defId]);
    // noPromoteMarks (fold, position)
    for (const mark of cardState.noPromoteMarks[p]) {
      const idx = mark.row * 9 + mark.col;
      if (idx >= 0 && idx < BOARD_SQUARES) h = xorKey(h, MARK_KEYS[p][idx]);
    }
    // drawProgress (fold)
    h = xorKey(h, DRAW_PROGRESS_KEYS[p][clampIndex(cardState.drawProgress[p], MAX_DRAW_PROGRESS)]);
    // deck (foldLength)
    h = xorKey(h, DECK_LEN_KEYS[p][clampIndex(cardState.deck[p].length, MAX_DECK_LEN)]);
  }
  return h;
}
