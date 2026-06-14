// 学習型評価 (Issue #245 フェーズ1) の局面符号化 (encoder)。
//
// ★最重要原則: encoder は **学習 (export) と推論 (World リーフ) で単一実装を共有** する。
// 数式の二重実装による train/inference スキューを構造的に防ぐ (計画 §3 論点B / M1)。
// - 推論時: World リーフの world.gameState / world.cardState (ライブ型) を直接渡す。
// - 学習時: JSONL の boardState (= serializeBoardForTraining 出力、構造的に EncoderPosition を満たす) +
//   deserializeCardState(cardState) を同じ encodePosition に渡す。
//
// 符号化方針 (PoC、低バグ表面を優先 = #235 の符号バグの教訓):
// - **先手絶対視点 + 手番ビット** で符号化し、NN も先手絶対視点の評価値を出す
//   (既存 evaluate の「正=先手有利」契約に drop-in、World リーフ差し替えが 1 関数で済む)。
// - 手番側視点への正規化 (データ効率↑) はフェーズ2の最適化として温存する。
//
// レイアウト (FEATURE_DIM は下記ブロックの合算で決定的に導出する):
//   [盤面 one-hot]  81 マス × (2 所有者 × PIECE_TYPES) … 占有マスのみ 1、空マスは全 0
//   [no_promote マーク] 81 マス × 2 プレイヤー … マーク済マスに 1
//   [持ち駒]        HAND_PIECE_TYPES × 2 プレイヤー … count / HAND_MAX で正規化
//   [手番]          1 … 先手番=1, 後手番=0
//   [マナ]          3 … sente/gote の mana と manaCap を MANA_CAP_REF で正規化 (動的上限対応)
//   [手札カード]    CARD_DEF_IDS × 2 プレイヤー … defId 別枚数を正規化
//   [山札]          2 … sente/gote の山札枚数を正規化
//   [トラップ]      CARD_DEF_IDS × 2 プレイヤー … セット中トラップの defId を one-hot

import { CARD_DEFS, MANA_CAP } from "@/lib/shogi/cards/definitions";
import type { CardGameState, CardId } from "@/lib/shogi/cards/types";
import type { Hand, PieceType, Player } from "@/lib/shogi/types";

// --- 固定オーダー (レイアウトの単一情報源) ---

// 盤上に存在しうる 14 駒種 (card-shogi は標準将棋駒)。PieceType の string 拡張 (将来のカスタム駒) は
// 本 PoC の対象外 = 未知種は符号化されず空マス扱い (card-shogi では発生しない)。
export const PIECE_TYPES: readonly PieceType[] = [
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

// 持ち駒に入りうる駒種 (玉・成駒は手駒にならない)。
export const HAND_PIECE_TYPES: readonly PieceType[] = [
  "rook",
  "bishop",
  "gold",
  "silver",
  "knight",
  "lance",
  "pawn",
];

// 手駒枚数の正規化上限 (駒種ごとの実際的な最大保持数 = 領域知識)。count/上限 を [0,1] にクランプ。
const HAND_MAX: Record<string, number> = {
  rook: 2,
  bishop: 2,
  gold: 4,
  silver: 4,
  knight: 4,
  lance: 4,
  pawn: 18,
};

// カード defId の固定オーダー = registry キーをソート (挿入順非依存で決定的)。
// カード追加で次元が変わる = 再学習前提 (#245「新カード→再学習」)。
export const CARD_DEF_IDS: readonly CardId[] = (Object.keys(CARD_DEFS) as CardId[])
  .slice()
  .sort();

// 盤サイズ (card-shogi / 標準将棋は 9×9 固定)。他バリアントは encoder 見直しが必要 (本 PoC 対象外)。
const BOARD_ROWS = 9;
const BOARD_COLS = 9;
const SQUARES = BOARD_ROWS * BOARD_COLS;

// 正規化定数 (領域知識。マジックナンバーでなく意味づけのある基準値)。
const MANA_CAP_REF = MANA_CAP; // mana / manaCap を割る基準。動的上限時は値が 1 を超え得る (= 上限拡大を表現)。
const CARD_HAND_NORM = 4; // 手札中の同一 defId 枚数の正規化基準。
const DECK_NORM = 20; // 山札枚数の正規化基準 (デッキ上限の安全側)。

// --- レイアウトのオフセット (合算で FEATURE_DIM を導出) ---

const PLAYERS: readonly Player[] = ["sente", "gote"];
const N_PIECE = PIECE_TYPES.length;
const N_HAND_PIECE = HAND_PIECE_TYPES.length;
const N_CARD = CARD_DEF_IDS.length;

const BOARD_BLOCK = SQUARES * PLAYERS.length * N_PIECE;
const MARK_BLOCK = SQUARES * PLAYERS.length;
const HAND_BLOCK = N_HAND_PIECE * PLAYERS.length;
const SIDE_BLOCK = 1;
const MANA_BLOCK = 3;
const CARD_HAND_BLOCK = N_CARD * PLAYERS.length;
const DECK_BLOCK = PLAYERS.length;
const TRAP_BLOCK = N_CARD * PLAYERS.length;

const OFF_BOARD = 0;
const OFF_MARK = OFF_BOARD + BOARD_BLOCK;
const OFF_HAND = OFF_MARK + MARK_BLOCK;
const OFF_SIDE = OFF_HAND + HAND_BLOCK;
const OFF_MANA = OFF_SIDE + SIDE_BLOCK;
const OFF_CARD_HAND = OFF_MANA + MANA_BLOCK;
const OFF_DECK = OFF_CARD_HAND + CARD_HAND_BLOCK;
const OFF_TRAP = OFF_DECK + DECK_BLOCK;

// 入力ベクトル次元 (学習側のネット入力サイズと一致させる単一情報源)。
export const FEATURE_DIM =
  BOARD_BLOCK +
  MARK_BLOCK +
  HAND_BLOCK +
  SIDE_BLOCK +
  MANA_BLOCK +
  CARD_HAND_BLOCK +
  DECK_BLOCK +
  TRAP_BLOCK;

// レイアウトのオフセット/サイズ (テスト検証・将来の特徴デバッグ用に公開)。
export const FEATURE_LAYOUT = {
  board: { offset: OFF_BOARD, size: BOARD_BLOCK },
  marks: { offset: OFF_MARK, size: MARK_BLOCK },
  hand: { offset: OFF_HAND, size: HAND_BLOCK },
  side: { offset: OFF_SIDE, size: SIDE_BLOCK },
  mana: { offset: OFF_MANA, size: MANA_BLOCK },
  cardHand: { offset: OFF_CARD_HAND, size: CARD_HAND_BLOCK },
  deck: { offset: OFF_DECK, size: DECK_BLOCK },
  trap: { offset: OFF_TRAP, size: TRAP_BLOCK },
} as const;

// 索引マップ (ホットパスで Map lookup を避けるため事前構築)。
const PIECE_INDEX: ReadonlyMap<PieceType, number> = new Map(PIECE_TYPES.map((t, i) => [t, i]));
const HAND_PIECE_INDEX: ReadonlyMap<PieceType, number> = new Map(
  HAND_PIECE_TYPES.map((t, i) => [t, i]),
);
const CARD_INDEX: ReadonlyMap<CardId, number> = new Map(CARD_DEF_IDS.map((c, i) => [c, i]));
const PLAYER_INDEX: Record<Player, number> = { sente: 0, gote: 1 };

// encoder が読む局面の最小構造 (ライブ GameState と serializeBoardForTraining 出力の両方が満たす)。
export interface EncoderPosition {
  board: ReadonlyArray<ReadonlyArray<{ type: PieceType; owner: Player } | null>>;
  hand: Hand;
  currentPlayer: Player;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 局面 + カード状態を FEATURE_DIM 次元の特徴ベクトルへ符号化する (純関数・先手絶対視点)。
export function encodePosition(pos: EncoderPosition, card: CardGameState): Float32Array {
  const f = new Float32Array(FEATURE_DIM);

  // [盤面] 占有マスに (player, pieceType) の one-hot を立てる。
  for (let r = 0; r < BOARD_ROWS; r++) {
    const row = pos.board[r];
    if (!row) continue;
    for (let c = 0; c < BOARD_COLS; c++) {
      const cell = row[c];
      if (!cell) continue;
      const pi = PIECE_INDEX.get(cell.type);
      if (pi === undefined) continue; // 未知駒種 (card-shogi では発生しない)
      const sq = r * BOARD_COLS + c;
      const owner = PLAYER_INDEX[cell.owner];
      f[OFF_BOARD + (owner * SQUARES + sq) * N_PIECE + pi] = 1;
    }
  }

  // [no_promote マーク] プレイヤー別にマーク済マスを立てる。
  for (const p of PLAYERS) {
    const base = OFF_MARK + PLAYER_INDEX[p] * SQUARES;
    for (const m of card.noPromoteMarks[p]) {
      if (m.row < 0 || m.row >= BOARD_ROWS || m.col < 0 || m.col >= BOARD_COLS) continue;
      f[base + m.row * BOARD_COLS + m.col] = 1;
    }
  }

  // [持ち駒] count / HAND_MAX で正規化。
  for (const p of PLAYERS) {
    const playerHand = pos.hand[p] ?? {};
    const base = OFF_HAND + PLAYER_INDEX[p] * N_HAND_PIECE;
    for (const [type, idx] of HAND_PIECE_INDEX) {
      const count = playerHand[type] ?? 0;
      if (count > 0) f[base + idx] = clamp01(count / (HAND_MAX[type] ?? 1));
    }
  }

  // [手番] 先手番=1, 後手番=0。
  f[OFF_SIDE] = pos.currentPlayer === "sente" ? 1 : 0;

  // [マナ] mana / 上限基準。manaCap も帯同し動的上限を表現。
  f[OFF_MANA + 0] = clamp01(card.mana.sente / MANA_CAP_REF);
  f[OFF_MANA + 1] = clamp01(card.mana.gote / MANA_CAP_REF);
  f[OFF_MANA + 2] = card.manaCap / MANA_CAP_REF; // クランプしない (上限拡大シグナル)

  // [手札カード] defId 別枚数を数え上げてから一度だけ正規化する。
  for (const p of PLAYERS) {
    const base = OFF_CARD_HAND + PLAYER_INDEX[p] * N_CARD;
    for (const inst of card.hand[p]) {
      const ci = CARD_INDEX.get(inst.defId);
      if (ci === undefined) continue;
      f[base + ci] += 1; // まず生カウント
    }
    for (let i = 0; i < N_CARD; i++) {
      if (f[base + i] > 0) f[base + i] = clamp01(f[base + i] / CARD_HAND_NORM);
    }
  }

  // [山札] 残枚数を正規化。
  f[OFF_DECK + 0] = clamp01(card.deck.sente.length / DECK_NORM);
  f[OFF_DECK + 1] = clamp01(card.deck.gote.length / DECK_NORM);

  // [トラップ] セット中トラップの defId を one-hot。
  for (const p of PLAYERS) {
    const t = card.trap[p];
    if (!t) continue;
    const ci = CARD_INDEX.get(t.defId);
    if (ci === undefined) continue;
    f[OFF_TRAP + PLAYER_INDEX[p] * N_CARD + ci] = 1;
  }

  return f;
}
