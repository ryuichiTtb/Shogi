// カード将棋(card-shogi variant)の型定義
//
// Phase 0 暫定実装。Phase A 以降でカード追加・効果追加に伴い拡張する。
// イベント駆動設計(設計ドキュメント 2.6)の足がかりとして、状態遷移は GameEvent として記録する。

import type { GameState, Player, Move } from "@/lib/shogi/types";

export type CardKind = "normal" | "trap";

// Phase 0 の暫定カードID。Phase A 以降でユニオンを拡張する。
export type CardId =
  | "mana_up"
  | "pawn_return"
  | "no_promote"
  | "double_pawn"
  | "piece_return"
  | "check_break"
  | "double_move"
  | "wild_strike";

export type CardTargeting = "none" | "ownPiece" | "enemyPiece" | "square";

// 4段階レア度 (Issue #104)
export type CardRarity = "common" | "rare" | "super_rare" | "epic";

// マスターカタログ運用用ステータス(Issue #102)
// draft: 検討中(本実装前) / preparing: 実装中(プール非公開) /
// active: 公開中 / deprecated: 廃止
export type CardStatus = "draft" | "preparing" | "active" | "deprecated";

// 採用フェーズ(設計ドキュメント 2.5)
export type CardPhase = "0" | "A" | "B" | "C";

// 王手中の使用可否区分 (Issue #82)。
// 大前提: 自分に手番が回ってきた時点で「王手中なら必ず1手で王手回避できる手が存在する」
// (詰みなら手番自体が回らない)。この前提のもとで:
// - "forbidden": そのカードの効果が「王手回避になり得ない」ため、王手中は無条件で使用不可。
//   例: 自分の駒を盤上から退かす歩戻し / 駒戻し、盤面駒に作用しないトラップ系。
//   メリット: 動的判定 (canEscapeCheckWithCard 等) を完全にスキップ → 計算リソース節約。
// - "conditional": 通常の1手の「一部のパターンでのみ」回避になる場合。配置先・対象次第なので
//   動的シミュレーションで実際に検証する。例: 二歩指し (合駒として打てるマスがあるか)。
// - "unconditional": そのカードが「通常の1手分以上の選択肢」を提供する場合。大前提から
//   1手回避手は必ず存在するので、そのカード機能で必ず1手回避手を取れる = 無条件で使用可。
//   例: 二手指し (1手で回避できる前提から2手以内で回避は自明)。動的判定をスキップ。
// 詳細指針: Issue #82 のコメント「王手時カード使用可否の検討観点」参照。
export type CardCheckUsage = "forbidden" | "conditional" | "unconditional";

// 使用条件判定(マナ以外の独自条件)。true=使用可 / false=非活性。
// CARD_USE_CONDITIONS で defId 別に登録 (Server→Client 境界で serialize できないため
// CardDefinition には含めない)。未登録 defId は常に使用可と見なす。
// Issue #82: pawn_return / double_pawn / piece_return 等で使用。Issue #115 で正式化予定。
export type CardUseCondition = (
  gameState: GameState,
  player: Player,
  cardState: CardGameState,
) => boolean;

export interface CardDefinition {
  id: CardId;
  kind: CardKind;
  name: string;
  description: string;
  cost: number;
  rarity: CardRarity;
  // effects.ts でディスパッチするための識別子。CardId と同値だが将来「同一効果の別カード」を許すため独立。
  effectId: string;
  targeting: CardTargeting;
  // カードの絵柄/アイコン(Phase 0 は絵文字)。Phase A 以降で SVG/画像差替予定。
  icon: string;
  // 運用ステータス(マスターカタログでのフィルタ・公開判定に使用)
  status: CardStatus;
  // 王手中の使用可否区分 (Issue #82)。trap カードは原則 "forbidden" (固定)。
  // normal カードは設計判断で個別に決定する。詳細は CardCheckUsage の JSDoc 参照。
  checkUsage: CardCheckUsage;
  // 採用フェーズ
  phase?: CardPhase;
  // 詳細仕様(マスターカタログ詳細ページ表示用、改行・箇条書き可)
  detailDescription?: string;
  // 使用条件の説明文(マスターカタログ詳細ページで「使用条件」枠に表示)。
  // 実際の判定ロジックは CARD_USE_CONDITIONS 側に持つ。表示と判定の整合は手動管理。
  useConditionDescription?: string;
  // 追加日(ISO 日付文字列、例: "2026-04-30")
  addedAt?: string;
  // 関連 Issue 番号
  relatedIssues?: number[];
}

export interface CardInstance {
  instanceId: string;
  defId: CardId;
}

export interface TrapInstance {
  instanceId: string;
  defId: CardId;
  owner: Player;
}

export type TrapTrigger = "promotion_declared" | "check_declared";

export type CardTarget = { kind: "square"; row: number; col: number } | { kind: "handPiece"; pieceType: string };

export interface PendingCard {
  instance: CardInstance;
  player: Player;
  phase: "selectTarget" | "confirm";
  target?: CardTarget;
}

// 「成り不可」マーク (no_promote 永続効果)。
// 各プレイヤーが「成り不可」状態を持つ自分の駒の現在位置を保持。
// 駒が動いたら座標を追従、駒が取られた / 持ち駒に戻った場合は削除 (案A 仕様)。
export interface PieceMark {
  row: number;
  col: number;
}

export interface CardGameState {
  mana: Record<Player, number>;
  manaCap: number;
  hand: Record<Player, CardInstance[]>;
  deck: Record<Player, CardInstance[]>;
  graveyard: Record<Player, CardInstance[]>;
  trap: Record<Player, TrapInstance | null>;
  pendingCard: PendingCard | null;
  // 早指し判定用に、各プレイヤーの「今の番が始まった瞬間」のタイムスタンプを保持
  lastTurnStartedAt: Record<Player, number | null>;
  // no_promote の永続マーク。各プレイヤーの「成り不可」駒の現在位置リスト。
  noPromoteMarks: Record<Player, PieceMark[]>;
  // Issue #130: 自動ドロー進捗。各プレイヤーごとに「自分の手番が終わるたびに +1」で
  // カウントし、AUTO_DRAW_INTERVAL に到達するとマナ消費なしで自動ドローが発火する。
  // 値域は 0..AUTO_DRAW_INTERVAL を想定。山札枯渇時は加算が AUTO_DRAW_INTERVAL を
  // 超えうるが、UI では Math.min(progress, interval) でクランプして表示する。
  drawProgress: Record<Player, number>;
}

// Step 5 (Issue #107): 旧 CHARGE_MANA / SET_TRAP / TRIGGER_TRAP は dead code
// (UI からも内部からも dispatch されていなかった) のため削除済み。
// マナチャージは MAKE_MOVE の reducer 内で makeMoveWithEffects がターンチャージ
// イベントを生成し、トラップは BEGIN_PLAY_CARD → CONFIRM_PLAY_CARD と
// MAKE_MOVE の no_promote トラップ発動経路で完結している。
export type CardAction =
  | { type: "DRAW_CARD"; player: Player }
  // ドロー演出完了時に呼ぶ。currentPlayer を相手に渡し、isDrawing をクリア。
  | { type: "COMMIT_DRAW" }
  | { type: "BEGIN_PLAY_CARD"; player: Player; instanceId: string }
  | { type: "SELECT_CARD_TARGET"; target: CardTarget }
  | { type: "CONFIRM_PLAY_CARD" }
  // カード使用演出 (中央フライト表示) 完了時に呼ぶ。currentPlayer を相手に渡し
  // 自分側の lastTurnStartedAt をクリア。これまでは CONFIRM_PLAY_CARD 時に
  // 即座に反転していたが、AI が演出中に動き出してしまうため演出完了まで保留する。
  | { type: "COMMIT_PLAY_CARD" }
  | { type: "CANCEL_PLAY_CARD" }
  | { type: "RESET_TURN_TIMER"; player: Player }
  // 王手崩し (#82) のアニメーション完了時に呼ぶ。isCheckBreakAnimating をクリアし
  // AI 思考とプレイヤー入力のロックを解除する。
  | { type: "COMMIT_CHECK_BREAK" };

// トラップ発動時に持ち駒化した相手駒の情報。check_break (#82) で UI が
// 駒フライト演出を組むために使う。座標は適用前 (盤上にあった時点) の位置、
// pieceType は unpromote 後の持ち駒種別、originalPieceType / originalOwner は
// 演出中(王手中央表示・トラップ発動演出の間)に盤面に「ゴースト駒」として
// 残像表示するための原駒情報。
export interface TrapCapturedPiece {
  row: number;
  col: number;
  pieceType: string;
  originalPieceType: string;
  originalOwner: Player;
}

// 乱撃 (#196) で「消滅」させた相手駒の情報。盤上から完全除去し持ち駒化しないため、
// hand 種別は持たない。row/col は適用前の位置、pieceType は成駒含む実 type
// (ゴースト描画で龍/馬等を正しく出すため)、owner は色描画用。
// cardPlayEvent.destroyedPieces で UI が斬撃→消滅演出を組む。
export interface DestroyedPiece {
  row: number;
  col: number;
  pieceType: string;
  owner: Player;
}

// Issue #130: ドロー発火源。手動 (DRAW_CARD コマンド) か、自動 (AUTO_DRAW_INTERVAL 到達)
// かを区別する。UNDO のブロック判定 (auto はブロックしない) と UI 演出 (色味・規模) で参照。
// optional とすることで、過去の DB 保存ログ (source 未記録時代) との互換を保つ。
// 未指定は manual 扱い (`(ev.source ?? "manual")` のフォールバックを各参照箇所で使う)。
export type DrawSource = "manual" | "auto";

export type GameEvent =
  | { kind: "moveEvent"; move: Move; at: number }
  | { kind: "manaChargeEvent"; player: Player; amount: number; reason: "turn" | "card"; fastMove?: boolean; at: number }
  | { kind: "drawEvent"; player: Player; instance: CardInstance; source?: DrawSource; at: number }
  // returnedPiece: pawn_return / piece_return が盤上 → 持ち駒に戻した駒の
  // 元位置と unpromote 後の駒種。効果適用後は盤上から消えるため、相手 (AI)
  // 使用時に駒フライト演出 (盤上 → 持ち駒) を再現するのに使う (Issue #193 /
  // card-apply)。自分側は適用前に DOM から捕捉するため不要だが共通化のため
  // イベントに載せる。駒移動を伴わないカードでは undefined。
  | {
      kind: "cardPlayEvent";
      player: Player;
      instance: CardInstance;
      target?: CardTarget;
      returnedPiece?: { row: number; col: number; pieceType: string };
      // 乱撃 (#196): 消滅させた相手駒のリスト。相手 (AI) 使用時の斬撃→消滅演出を
      // 再現するために載せる。駒消滅を伴わないカードでは undefined。
      destroyedPieces?: DestroyedPiece[];
      at: number;
    }
  | { kind: "trapSetEvent"; player: Player; instance: TrapInstance; at: number }
  | { kind: "trapTriggerEvent"; player: Player; instance: TrapInstance; reason: TrapTrigger; capturedPieces?: TrapCapturedPiece[]; at: number };
