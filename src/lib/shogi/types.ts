// 型定義の再エクスポート（利便性のため）
export type {
  Player,
  CorePieceType,
  PromotedPieceType,
  PieceType,
  Piece,
  Position,
  Board,
  Hand,
  MovePattern,
  SpecialAbility,
  PieceDefinition,
  TimeControl,
  TimeControlType,
  RuleOverrides,
  RuleVariant,
  GameConfig,
  Difficulty,
  Move,
  GameStatus,
  GameState,
} from "./variants/types";

// ホーム/対局セットアップ画面で扱うモード識別子。
// createGame() の variantId 引数 (string 型) に渡される。
export type GameMode = "card-shogi" | "standard";
