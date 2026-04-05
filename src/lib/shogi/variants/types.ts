// ルールバリアントシステム - 拡張性のある将棋ルール定義

export type Player = "sente" | "gote";

export type CorePieceType =
  | "king"
  | "rook"
  | "bishop"
  | "gold"
  | "silver"
  | "knight"
  | "lance"
  | "pawn";

export type PromotedPieceType =
  | "promoted_rook"
  | "promoted_bishop"
  | "promoted_silver"
  | "promoted_knight"
  | "promoted_lance"
  | "promoted_pawn";

export type PieceType = CorePieceType | PromotedPieceType | string; // stringは将来のカスタム駒に対応

export interface Piece {
  type: PieceType;
  owner: Player;
}

export interface Position {
  row: number; // 0 = 上端（後手陣）, boardSize.rows-1 = 下端（先手陣）
  col: number; // 0 = 右端, boardSize.cols-1 = 左端
}

export type Board = (Piece | null)[][];

export type Hand = Record<Player, Partial<Record<string, number>>>;

// 移動パターン定義
export interface MovePattern {
  type: "step" | "slide" | "jump";
  directions: [number, number][]; // [rowDelta, colDelta] 先手視点
}

// 特殊能力（将来のカスタム駒用）
export interface SpecialAbility {
  id: string;
  description: string;
  trigger: "on_move" | "on_capture" | "on_promote" | "on_drop";
  effect: string; // シリアライズ可能な効果識別子
}

// 駒の定義（拡張可能）
export interface PieceDefinition {
  type: PieceType;
  kanji: string;         // 漢字表示
  kanjiPromoted?: string; // 成り後の漢字（promotesToがある場合）
  value: number;
  movePatterns: MovePattern[];
  promotesTo?: PieceType;
  canPromote?: boolean;
  mustPromoteRows?: number; // 最終N段では強制成り（先手視点で末尾N行）
  specialAbility?: SpecialAbility;
}

// 時間制限設定
export type TimeControlType = "byoyomi" | "fischer" | "absolute" | "none";

export interface TimeControl {
  type: TimeControlType;
  initialSeconds: number;   // 持ち時間（秒）
  byoyomiSeconds?: number;  // 秒読み（byoyomi用）
  incrementSeconds?: number; // 加算（fischer用）
}

// ルールのオーバーライド
export interface RuleOverrides {
  allowDrop: boolean;
  promotionZoneRows: number;       // 成りゾーンの段数（標準=3）
  checkRepetition: boolean;        // 千日手チェック
  allowImpasse: boolean;           // 持将棋チェック
  impassePoints: { major: number; minor: number }; // 大駒・小駒の持将棋点数
  pawnDropCheckmate: boolean;      // 打ち歩詰め禁止（trueで禁止）
  doublePawn: boolean;             // 二歩禁止（trueで禁止）
  customMoveValidator?: (
    move: import("./types").Move,
    state: import("./types").GameState
  ) => boolean;
}

// ルールバリアント本体
export interface RuleVariant {
  id: string;
  name: string;
  description: string;
  boardSize: { rows: number; cols: number };
  pieces: PieceDefinition[];
  initialSetup: (boardSize: { rows: number; cols: number }) => Board;
  initialHand?: Hand;
  rules: RuleOverrides;
  timeControl?: TimeControl;
}

// ゲーム設定
export type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";

export interface GameConfig {
  variant: RuleVariant;
  difficulty: Difficulty;
  playerColor: Player;
  timeControl?: TimeControl;
  characterId: string;
  soundEnabled: boolean;
  commentaryEnabled: boolean;
}

// 手の種類
export interface Move {
  type: "move" | "drop";
  from?: Position;
  to: Position;
  piece: PieceType;
  captured?: PieceType;
  promote?: boolean;
  dropPiece?: PieceType;
  player: Player;
}

// ゲーム状態
export type GameStatus =
  | "active"
  | "checkmate"
  | "resign"
  | "repetition"
  | "perpetual_check"
  | "impasse"
  | "timeout"
  | "stalemate";

export interface GameState {
  board: Board;
  hand: Hand;
  currentPlayer: Player;
  moveHistory: Move[];
  positionHistory: string[]; // ハッシュ化した局面文字列リスト（千日手検出用）
  status: GameStatus;
  winner?: Player | "draw";
  moveCount: number;
}
