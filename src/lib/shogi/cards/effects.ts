// カード効果の純粋関数群。
// 入力に対して副作用を起こさず、新しい状態オブジェクトを返す。
// reducer から呼び出され、reducer 側で eventLog を追記する。

import type { GameState, Player, Position } from "@/lib/shogi/types";
import { cloneGameState } from "../board";
import { isPawnDropCheckmate, isInCheck } from "../moves";
import { unpromotePieceType } from "../variants/standard";
import { CARD_SHOGI_VARIANT } from "../variants/card-shogi";
import type { CardGameState, CardId, CardTarget } from "./types";

// ----- no_promote 永続マーク管理 -----

export function hasNoPromoteMark(
  cardState: CardGameState,
  player: Player,
  pos: Position,
): boolean {
  return cardState.noPromoteMarks[player].some(
    (m) => m.row === pos.row && m.col === pos.col,
  );
}

export function addNoPromoteMark(
  cardState: CardGameState,
  player: Player,
  pos: Position,
): CardGameState {
  if (hasNoPromoteMark(cardState, player, pos)) return cardState;
  return {
    ...cardState,
    noPromoteMarks: {
      ...cardState.noPromoteMarks,
      [player]: [...cardState.noPromoteMarks[player], { row: pos.row, col: pos.col }],
    },
  };
}

export function removeNoPromoteMark(
  cardState: CardGameState,
  player: Player,
  pos: Position,
): CardGameState {
  if (!hasNoPromoteMark(cardState, player, pos)) return cardState;
  return {
    ...cardState,
    noPromoteMarks: {
      ...cardState.noPromoteMarks,
      [player]: cardState.noPromoteMarks[player].filter(
        (m) => !(m.row === pos.row && m.col === pos.col),
      ),
    },
  };
}

export function moveNoPromoteMark(
  cardState: CardGameState,
  player: Player,
  from: Position,
  to: Position,
): CardGameState {
  if (!hasNoPromoteMark(cardState, player, from)) return cardState;
  return {
    ...cardState,
    noPromoteMarks: {
      ...cardState.noPromoteMarks,
      [player]: cardState.noPromoteMarks[player].map((m) =>
        m.row === from.row && m.col === from.col ? { row: to.row, col: to.col } : m,
      ),
    },
  };
}

// マナUP: 即時マナ +3 (上限 manaCap を超えない)
export function applyManaUp(
  cardState: CardGameState,
  player: Player,
): CardGameState {
  const next = Math.min(cardState.manaCap, cardState.mana[player] + 3);
  return {
    ...cardState,
    mana: { ...cardState.mana, [player]: next },
  };
}

// 二歩指し: 持ち駒の歩 1枚を、自分の未成り歩がいる列の空マスに打つ。
// 二歩禁則は解除するが、行きどころのない歩 / 打ち歩詰めは禁則維持する。
// 失敗時(条件未達)は null を返す。
export function applyDoublePawn(
  state: GameState,
  player: Player,
  target: Position,
): GameState | null {
  if (!isDoublePawnLegalSquare(state, player, target)) return null;

  const newState = cloneGameState(state);
  // 持ち駒から歩を1枚消費
  const handCount = newState.hand[player]["pawn"] ?? 0;
  if (handCount <= 0) return null;
  if (handCount === 1) {
    delete newState.hand[player]["pawn"];
  } else {
    newState.hand[player]["pawn"] = handCount - 1;
  }
  // 盤面に歩を配置
  newState.board[target.row][target.col] = { type: "pawn", owner: player };
  return newState;
}

// 二歩指しの配置可能マスを判定する純粋関数。UI ハイライトと効果適用の両方から使う。
export function isDoublePawnLegalSquare(
  state: GameState,
  player: Player,
  target: Position,
): boolean {
  const variant = CARD_SHOGI_VARIANT;
  const { rows } = variant.boardSize;

  // 1. 持ち駒に歩があるか
  const handPawnCount = state.hand[player]["pawn"] ?? 0;
  if (handPawnCount <= 0) return false;

  // 2. 配置先が空マスか
  if (state.board[target.row]?.[target.col]) return false;

  // 3. 配置先の列に自分の未成り歩がいるか (と金は除外)
  let hasOwnPawnInColumn = false;
  for (let r = 0; r < rows; r++) {
    const piece = state.board[r]?.[target.col];
    if (piece && piece.owner === player && piece.type === "pawn") {
      hasOwnPawnInColumn = true;
      break;
    }
  }
  if (!hasOwnPawnInColumn) return false;

  // 4. 行きどころのない歩(後手1段目 / 先手9段目)は不可
  if (player === "sente" && target.row === 0) return false;
  if (player === "gote" && target.row === rows - 1) return false;

  // 5. 打ち歩詰めは禁則維持
  const dropMove = {
    type: "drop" as const,
    to: target,
    piece: "pawn",
    dropPiece: "pawn",
    player,
  };
  if (isPawnDropCheckmate(state, dropMove, variant)) return false;

  return true;
}

// 駒戻し: 自盤上の玉以外の駒1枚を持ち駒に戻す (Issue #82)。
// 成駒は成り解除 (unpromote) して持ち駒の元駒種に加算する。
// 自玉が王手露出する手 (ピン駒の引き戻し) は不正として null を返す。
export function applyPieceReturn(
  state: GameState,
  player: Player,
  target: Position,
): GameState | null {
  if (!isPieceReturnLegalSquare(state, player, target)) return null;
  const piece = state.board[target.row]?.[target.col];
  if (!piece) return null;

  const newState = cloneGameState(state);
  newState.board[target.row][target.col] = null;
  // 成駒は元駒種に戻して持ち駒へ
  const handPieceType = unpromotePieceType(piece.type);
  const currentCount = newState.hand[player][handPieceType] ?? 0;
  newState.hand[player][handPieceType] = currentCount + 1;
  return newState;
}

// 駒戻しの選択可能マスを判定する純粋関数。UI ハイライトと効果適用の両方から使う。
// - 自分の駒であること
// - 玉(king)は対象外
// - その駒を引っ込めても自玉が王手にならないこと(ピン駒は不可)
export function isPieceReturnLegalSquare(
  state: GameState,
  player: Player,
  target: Position,
): boolean {
  const piece = state.board[target.row]?.[target.col];
  if (!piece) return false;
  if (piece.owner !== player) return false;
  if (piece.type === "king") return false;

  // 仮想的に駒を消した盤面で自玉が王手にならないか確認 (ピン駒チェック)
  const probe = cloneGameState(state);
  probe.board[target.row][target.col] = null;
  if (isInCheck(probe, player, CARD_SHOGI_VARIANT)) return false;

  return true;
}

// 歩戻し: 自盤上の歩(または と金)1枚を持ち駒に戻す。
// と金は将棋ルール上「歩」として持ち駒になる(unpromote)。
// 失敗時(対象がない/相手の駒/歩でない)は null を返す。
export function applyPawnReturn(
  state: GameState,
  player: Player,
  target: Position,
): GameState | null {
  if (!isPawnReturnLegalSquare(state, player, target)) return null;
  const newState = cloneGameState(state);
  newState.board[target.row][target.col] = null;
  const currentCount = newState.hand[player]["pawn"] ?? 0;
  newState.hand[player]["pawn"] = currentCount + 1;
  return newState;
}

// 歩戻しの選択可能マスを判定する純粋関数。UI ハイライトと効果適用の両方から使う。
// - 対象が自分の歩 (pawn) または と金 (promoted_pawn) であること
export function isPawnReturnLegalSquare(
  state: GameState,
  player: Player,
  target: Position,
): boolean {
  const piece = state.board[target.row]?.[target.col];
  if (!piece) return false;
  if (piece.owner !== player) return false;
  if (piece.type !== "pawn" && piece.type !== "promoted_pawn") return false;
  return true;
}

// ----- 王手中のカード使用判定 (Issue #82) -----

// カード適用後の GameState を返すシミュレータ。
// - target ありカード: 各 applyXXX を呼んで結果の GameState を返す
// - target なしカード (mana_up / no_promote 等): 盤面を変えないので null を返す
//   → 王手回避にならないため、王手中は使用不可と扱う
export function simulateCardEffect(
  state: GameState,
  player: Player,
  defId: CardId,
  target: CardTarget | null,
): GameState | null {
  switch (defId) {
    case "pawn_return":
      if (!target || target.kind !== "square") return null;
      return applyPawnReturn(state, player, { row: target.row, col: target.col });
    case "piece_return":
      if (!target || target.kind !== "square") return null;
      return applyPieceReturn(state, player, { row: target.row, col: target.col });
    case "double_pawn":
      if (!target || target.kind !== "square") return null;
      return applyDoublePawn(state, player, { row: target.row, col: target.col });
    default:
      // mana_up / no_promote / sample_* 等は GameState を変えないので null
      return null;
  }
}

// ターゲット指定型カードの選択可能マスを判定する共通ヘルパ (Step S1 / 2026-05-03)。
// handleSquareClick の駒フライト起動前と reducer 直前の selectSquare の両方から呼ぶ。
// 検証順序を 1 箇所に集約することで、無効マスでフライト演出だけ走る現象を防ぐ。
//
// 振る舞い:
// - target が square でなければ false
// - カード種別ごとの妥当性 (自駒の歩 / 自駒で玉でなくピンでない / 二歩配置可) を検証
// - 王手中なら、そのマスへの適用が王手回避になることも要求
// - target なしカード (mana_up / no_promote) は target を取らないので適用範囲外 → false
export function isValidCardTargetSquare(
  state: GameState,
  player: Player,
  defId: CardId,
  target: Position,
): boolean {
  switch (defId) {
    case "pawn_return":
      if (!isPawnReturnLegalSquare(state, player, target)) return false;
      break;
    case "piece_return":
      if (!isPieceReturnLegalSquare(state, player, target)) return false;
      break;
    case "double_pawn":
      if (!isDoublePawnLegalSquare(state, player, target)) return false;
      break;
    default:
      // mana_up / no_promote / sample_* など target なしカードは square 対象外
      return false;
  }
  // 王手中: 適用結果が王手解除になることを要求
  const variant = CARD_SHOGI_VARIANT;
  if (isInCheck(state, player, variant)) {
    const after = simulateCardEffect(state, player, defId, {
      kind: "square",
      row: target.row,
      col: target.col,
    });
    if (!after || isInCheck(after, player, variant)) return false;
  }
  return true;
}

// 王手回避になるマスを列挙する。王手中のカード使用可否・配置先制限の両方で参照される。
// 戻り値が空なら「そのカードでは王手回避できない」=王手中使用不可。
export function getCheckEscapingSquares(
  state: GameState,
  player: Player,
  defId: CardId,
): Position[] {
  const variant = CARD_SHOGI_VARIANT;
  const { rows, cols } = variant.boardSize;
  const result: Position[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const target: CardTarget = { kind: "square", row: r, col: c };
      const after = simulateCardEffect(state, player, defId, target);
      if (after && !isInCheck(after, player, variant)) {
        result.push({ row: r, col: c });
      }
    }
  }
  return result;
}

// 同種トラップ重複チェック (Issue #105)。
// 自分側のトラップスロットに同じ defId のトラップがすでに置かれていれば true。
// reducer の使用前ガードと UI の非活性判定で共通利用する。
export function hasSameKindTrapPlaced(
  cardState: CardGameState,
  player: Player,
  defId: CardId,
): boolean {
  const existing = cardState.trap[player];
  return existing !== null && existing.defId === defId;
}

// トラップセット: 手札の指定カードを trap スロットへ移動 (マナ消費は呼び出し側)
export function applyTrapSet(
  cardState: CardGameState,
  player: Player,
  instanceId: string,
): CardGameState | null {
  const card = cardState.hand[player].find((c) => c.instanceId === instanceId);
  if (!card) return null;
  return {
    ...cardState,
    hand: {
      ...cardState.hand,
      [player]: cardState.hand[player].filter((c) => c.instanceId !== instanceId),
    },
    trap: {
      ...cardState.trap,
      [player]: { instanceId: card.instanceId, defId: card.defId, owner: player },
    },
  };
}

// トラップ発火後の解除 (発火したトラップは消費される)
export function applyTrapClear(
  cardState: CardGameState,
  player: Player,
): CardGameState {
  if (!cardState.trap[player]) return cardState;
  return {
    ...cardState,
    trap: { ...cardState.trap, [player]: null },
  };
}

// 通常カード使用: マナ消費 + 手札からグレイブへ
export function consumeNormalCard(
  cardState: CardGameState,
  player: Player,
  instanceId: string,
  cost: number,
): CardGameState | null {
  const card = cardState.hand[player].find((c) => c.instanceId === instanceId);
  if (!card) return null;
  if (cardState.mana[player] < cost) return null;
  return {
    ...cardState,
    mana: { ...cardState.mana, [player]: cardState.mana[player] - cost },
    hand: {
      ...cardState.hand,
      [player]: cardState.hand[player].filter((c) => c.instanceId !== instanceId),
    },
    graveyard: {
      ...cardState.graveyard,
      [player]: [...cardState.graveyard[player], card],
    },
  };
}
