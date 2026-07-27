// 学習用棋譜データ収集 (Issue #245 フェーズ0) の共通型。
//
// フレームワーク非依存 (React / Next / Prisma / Node fs 非依存)。人間対局・自己対戦・
// (将来) 観戦の各収集経路が、本型と serialize / sink を共有することで疎結合に保つ。
// 収集する単位は「決定点」= move / playCard / draw の各 1 操作。double_move は
// ターン単位 1 サンプル (events に move×2 を内包) とする (計画 §10)。

import type { Difficulty, GameStatus, Player } from "@/lib/shogi/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type { GameEvent } from "@/lib/shogi/cards/types";

// 学習データの出自。弱い AI 由来データを高品質扱いしないためのフィルタにも使う。
export type TrainingSource = "human" | "self_play";

// union の各メンバへ分配的に Omit を適用するヘルパ。
// 単純な Omit<GameEvent, "at"> は keyof が共通キー (kind) のみに潰れて
// メンバ固有フィールドを失うため、discriminant を保つには分配が必要。
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// 保存用に正規化した GameEvent。再現性を汚す at (= Date.now()) を剥がしたもの。
// 順序は TrainingSample.plyIndex / events 配列順で担保する (計画 §10, M1 NIT-1)。
// fastMove / drawEvent.source 等は学習に有用なので残す。
export type TrainingEvent = DistributiveOmit<GameEvent, "at">;

// 学習用「1決定点」のスナップショット (行動前の局面 + カード状態 + 採用行動 + 発生イベント)。
export interface TrainingSampleData {
  plyIndex: number; // 0 始まりの決定通し番号 (試合内で一意)
  moveCount: number; // その時点の gameState.moveCount (card / draw では据置 = 同値が並ぶ)
  sideToMove: Player; // この局面で行動する側
  boardState: unknown; // serializeBoardForTraining(行動前) の結果 (JSON、moveHistory/positionHistory 除外)
  cardState: unknown; // serializeCardState(行動前) の結果 (JSON)
  action: TurnAction; // 採用した行動
  events: TrainingEvent[]; // 適用で生じたイベント (at 剥がし)
  // Issue #245 Stage 2 P2-0: search-score ラベル生成 (Pass 1) が付与する「この局面を World 探索で
  // 深さ D まで読んだ move-only backed-up 値 (先手絶対視点 cp)」。DB スキーマには持たない (JSONL のみ)。
  // 3 状態を区別する (教材多様化 段1):
  //   - キー欠落 (undefined) = **未採点**。生 (フェーズ0/1) のサンプル。
  //   - null                 = **採点不能**。深さ 1 すら完了しなかった局面
  //                            (evaluatePositionWorldMoveOnly が null を返す)。嘘の 0 を書かないための明示。
  //   - number               = 採点済み。
  // encode 段 (gameToBootstrapRows) は undefined / null をどちらも outcome のみのラベルへ
  // フォールバックする。静かに劣化しないよう、採点率は encode の .meta.json へ記録する。
  searchScore?: number | null;
}

// Issue #245 教材多様化 段1: ラベル (searchScore) の**意味**を決める生成レシピ。
//
// 探索深さや root でのカード展開が違えば searchScore は別物になるため、新旧のラベルが
// 1 ファイルに混ざると学習が静かに壊れる。出力 JSONL の試合メタへ刻んで、
// 再開・取り合い・encode の各段で「違うレシピの成果を既済扱いしない / 混ぜない」を機械的に保証する。
//
// ★フィールドを追加したら scripts/utils/label-identity.ts の recipeKey にも足し、version を上げること
//   (recipeKey は列挙で正規化するため、足し忘れると別レシピが同一キーになる)。
export interface LabelMeta {
  version: number; // レシピ形式の版。意味論を変えたら上げる
  depth: number; // 探索深さ D (= 要求値。実際に到達した深さではない)
  expandCards: boolean; // ラベル探索の root で playCard を展開したか (段2 で true)
  expandDraw: boolean; // 同 draw (山札順への依存を断つため既定 false)
}

// 学習用「1試合」のメタ + 勝敗ラベル。勝敗の単一情報源 (サンプルへ非正規化しない)。
export interface TrainingGameData {
  source: TrainingSource;
  variantId: string;
  // 両者の素性 (人間側は null)。
  senteDifficulty?: Difficulty | null;
  senteCharacterId?: string | null;
  goteDifficulty?: Difficulty | null;
  goteCharacterId?: string | null;
  humanColor?: Player | null; // "sente" | "gote" | null (self_play)
  deckSpecSente?: unknown; // デッキ構成 (人間側は未保持のため省略可)
  deckSpecGote?: unknown;
  // 結果 (終局時に確定)。winner=null (中断) は学習除外。
  winner?: Player | "draw" | null;
  finalStatus: GameStatus;
  moveCount: number;
  engineVersion?: string | null; // データ来歴フィルタキー
  // 由来の参照 (任意)。human 時は元 Game.id、分岐生成 (段5) では
  // `branch:<親の内容ハッシュ>:<分岐 ply>` を入れて親をたどれるようにする。
  sourceGameId?: string | null;
  // ラベル生成レシピの刻印 (教材多様化 段1)。ラベル付けバッチ (scripts/label-search-score-245.ts) が
  // 出力時に付ける。生データ・DB 由来のレコードには無い (undefined = "legacy" 扱い)。
  labelMeta?: LabelMeta | null;
}

// 1 試合分のまとまり (メタ + per-decision サンプル列)。JSONL の 1 行 / sink の保存単位。
export interface TrainingGameRecord {
  game: TrainingGameData;
  samples: TrainingSampleData[];
}

// 1 試合分 (メタ + per-decision サンプル列) を確定保存するシンク。
//
// 中断対局 (winner=null) は学習除外ゆえ「終局時に 1 試合分まとめて書く」方式で十分。
// 人間対局は収集経路が貯めて終局時に flush、自己対戦は in-memory 収集後に書く。
// 実装: MemoryTrainingSink (本ディレクトリ) / JSONL (Node) / DB (server, Prisma)。
export interface TrainingSink {
  writeGame(game: TrainingGameData, samples: TrainingSampleData[]): Promise<void>;
}
