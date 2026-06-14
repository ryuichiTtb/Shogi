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
  boardState: unknown; // serializeGameState(行動前) の結果 (JSON)
  cardState: unknown; // serializeCardState(行動前) の結果 (JSON)
  action: TurnAction; // 採用した行動
  events: TrainingEvent[]; // 適用で生じたイベント (at 剥がし)
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
  sourceGameId?: string | null; // human 時、元 Game.id への参照 (任意)
}

// 1 試合分 (メタ + per-decision サンプル列) を確定保存するシンク。
//
// 中断対局 (winner=null) は学習除外ゆえ「終局時に 1 試合分まとめて書く」方式で十分。
// 人間対局は収集経路が貯めて終局時に flush、自己対戦は in-memory 収集後に書く。
// 実装: MemoryTrainingSink (本ディレクトリ) / JSONL (Node) / DB (server, Prisma)。
export interface TrainingSink {
  writeGame(game: TrainingGameData, samples: TrainingSampleData[]): Promise<void>;
}
