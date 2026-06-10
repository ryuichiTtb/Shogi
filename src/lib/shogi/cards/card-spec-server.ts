// Issue #235 S2a: L1 カードフレームワーク (CardSpec registry) の **サーバ専用 / 関数** 層。
//
// 目的 (S2 計画 docs/plans/issue-235-s2-cardspec.md §2/§5): card-spec.ts (meta-only) に対し、
//   関数 (effect.apply / useCondition / valueModel / onTrigger) を持つ `CardSpec` 本体 + registry
//   `CARD_SPECS` を定義する。effects.ts / world-kernel(WorldState 型) / heuristics 相当の
//   値付けを内包するため Client へ出してはならない (§5 R-2。S2d で ESLint により
//   `src/components/**`・`src/hooks/**` からの import を禁止する)。
//
// S2a の大前提 (§1): **production 未配線 (additive)**。挙動完全不変。
//   - effect.apply は既存 applyXxx を包む薄い wrapper (再実装しない → 構造的に等価)。
//   - 効果適用の dispatch (consumeNormalCard / mana 減算 / event 構築 / removeNoPromoteMark 等の
//     sideEffect) は kernel `applyCardEffectLogic` 側の汎用処理であり、本 registry は **盤面変更のみ**
//     を表現する (§2 / §9 B3)。registry を実際に dispatch へ繋ぐのは S2b。
//
// 設計判断 (M1 確定、§9):
//   - **multiPly は EffectSpec 共用体外** (CardSpec.multiPly?: number)。double_move は applyCardEffectLogic
//     対象外でフラグセットのみ、遅延消費は finalizeDoubleMoveLogic という S1d 既存 orchestration が担う。
//     registry は plies 数のメタのみ保持し effect は持たない (A1/A2)。
//   - **trap = Route B** (R-1): `setTrap` は **set のみ** registry 化。trigger (no_promote 成り抑止 /
//     check_break 王手崩し) は move-effects.ts インライン温存。`onTrigger` は型枠のみ (@deferred、実配線 S3)。
//   - **valueModel** (Issue #235 S3a): トラップ2枚 (check_break/no_promote) を局面依存値付け
//     (P_trigger × E_damage、gross 値) に実装。check_break = 自玉露出度 / no_promote = 相手成り脅威度 で
//     trigger 確率を算出する (D-KS=C: king-exposure / promotion-threat は moves / variants プリミティブで
//     自前計算し cards → ai の上向き依存を作らない。S3 計画 docs/plans/issue-235-s3-valuemodel.md §3/§5)。
//     残り5枚は静的 (mana_up は deprecated、盤面系4枚は 0 = 盤面 eval / super-action 探索が間接捕捉する
//     "別経路で捕捉" のセンチネル、§5 L-3)。**AI 側の評価切替 (TRAP_VALUE_* → valueModel) と依存反転は S3b、
//     PoC-2 仮係数の bench 校正は S3c**。S3a は production 未配線 (additive) のため挙動不変。

import type { GameState, Player, Position } from "@/lib/shogi/types";
import { findKing, isSquareAttackedByFast } from "@/lib/shogi/moves";
import { PIECE_DEF_MAP, STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import type { CardCheckUsage, CardGameState, CardId, CardTarget, CardTargeting, TrapTrigger } from "./types";
import type { CardEventKind, CardMeta } from "./card-spec";
import { CARD_META, deriveEventKind } from "./card-spec";
import { CARD_DEFS, CARD_USE_CONDITIONS } from "./definitions";
import { applyDoublePawn, applyPawnReturn, applyPieceReturn } from "./effects";

// L1 が参照するカード文脈の最小ビュー (gameState + cardState)。
// useCondition / onTrigger は二手指し継続状態 (doubleMove) を要さないため、kernel の WorldState 全体
// ではなく本最小型に縮約する。これにより cards/ → kernel/ の型依存を断つ (M2 D1-1: S2b で world-kernel が
// CARD_SPECS を value import するため、card-spec-server が WorldState を type import すると型レベル循環が
// 生じる)。world-kernel.WorldState ({gameState, cardState, doubleMove}) と ai の AiTurnState はいずれも
// 本型へ構造的に代入可能 (caller 側は従来どおり渡せる)。
export interface CardWorldView {
  gameState: GameState;
  cardState: CardGameState;
}

// ===== EffectSpec 判別共用体 (M1 §2) =====
// CONFIRM 時の効果適用を type 別テンプレで宣言する。新カードは type 選択 + パラメータ埋め (ビジョン⑥)。
export type EffectSpec =
  // modifyBoard: 盤面のみ変更し GameState | null を返す (pawn_return / piece_return / double_pawn)。
  //   持ち駒消費 (consumeNormalCard)・event 構築・removeNoPromoteMark 等の sideEffect は
  //   dispatcher (S2b の applyCardEffectLogic) が汎用処理する (§9 B3)。apply は applyXxx を包む薄い wrapper。
  | {
      type: "modifyBoard";
      apply: (gameState: GameState, player: Player, target: CardTarget) => GameState | null;
    }
  // setTrap: set のみ registry 化 (Route B、R-1)。trigger は「いつ発火するか」のメタ。
  //   onTrigger は **未配線 stub** (型枠のみ、@deferred、実配線 S3)。実 trigger は move-effects.ts インライン。
  | {
      type: "setTrap";
      trigger: TrapTrigger;
      onTrigger?: (world: CardWorldView) => CardWorldView;
    }
  // modifyResource: mana/draw のリソース変更を宣言的に (mana_up)。
  | { type: "modifyResource"; mana?: number; draw?: number };

// 使用条件 (マナ以外の独自条件)。CARD_USE_CONDITIONS を (world, player) シグネチャに統一して内包する
// (§8 / §B2。現行 CardUseCondition の 3 引数目 cardState は未使用)。
export type UseCondition = (world: CardWorldView, player: Player) => boolean;

// カード価値モデル (cp)。S2 は静的 stub、S3 で局面・コスト依存値付け (R-4)。シグネチャを固定する。
export type ValueModel = (gameState: GameState, player: Player) => number;

// 単一カード仕様 (epic §4 / M1 §2)。registry の値オブジェクト。
export interface CardSpec {
  meta: CardMeta; // client-safe (card-spec.ts)
  targeting: CardTargeting;
  // CONFIRM 時の効果。double_move は multiPly のみで本フィールドを持たない (effect 共用体外、A1/A2)。
  effect?: EffectSpec;
  // double_move 専用: 1 ターンに消費する ply 数 (= 2)。遅延消費/flip 抑止は既存 orchestration が担う。
  multiPly?: number;
  useCondition?: UseCondition;
  checkUsage: CardCheckUsage;
  valueModel: ValueModel;
  eventKind: CardEventKind;
}

// ===== valueModel: 静的値 (5枚) + 局面依存値 (トラップ2枚、S3a) =====

// 静的 per-card 価値 (cp)。トラップ2枚は S3a で局面依存 valueModel に移行したため本表から除外。
// mana_up は deprecated (AI 候補から除外済) だが registry 整合のため値を保持。盤面系4枚は 0 =
// 「価値ゼロ」ではなく「盤面 eval / super-action 探索が別経路で間接捕捉する」センチネル (§5 L-3)。
const STATIC_CARD_VALUE: Partial<Record<CardId, number>> = {
  mana_up: 30,
  pawn_return: 0,
  double_pawn: 0,
  piece_return: 0,
  double_move: 0,
};

// 静的値を返す valueModel (gameState/player は未使用)。
function staticValueModel(value: number): ValueModel {
  return (gameState, player) => {
    void gameState;
    void player;
    return value;
  };
}

// ===== トラップ局面依存値モデル (S3a 実装 / S3c 校正、PoC-2 docs/bench-results/issue-235-poc2.json) =====
// 価値 = P_trigger × E_damage の **gross 値** (cp)。カードのマナコストは AI 側の mana 会計
// (applyActionForLookahead → digest manaDelta) が別途反映するため、ここでは差し引かない (二重計上回避、§5 R-1)。
// 係数は **S3c で bench + 決定的 unit test で校正済の本採用値** (PoC-2 仮値からの確定経緯は計画 §12)。
//
// **S3c 校正 (TRAP_P_MIN 0.05 → 0.10)**: PoC-2 仮値 0.05 は「set 済の dormant トラップが生涯で
//   trigger する確率」を過小評価していた (王手/成りは 1 局を通じて高頻度で発生するため、置いた
//   トラップが将来発火する確率は 5% より明らかに高い)。0.10 へ引き上げることで:
//     - 静かな盤面 + マナ上限近接 (= dead マナ) では dormant トラップのセットが正 EV になる
//       (浪費されるはずのマナを option value に変換する好手。check_break floor 15→30cp / no_promote 8→16cp)。
//     - 静かな盤面 + 通常マナでは依然 move を選好 (P_MIN<0.127 でトラップの過剰セットを抑止)。
//     - 危険局面 (露出玉 / 相手成り脅威) では P_trigger が ratio で押し上がり高価値 = 挙動不変。
//   決定的検証は evaluate-action.test.ts「S3c calibration」(noise なし evaluateActionWithLookahead)。
const TRAP_P_MIN = 0.1; // trigger 確率の下限 (dormant トラップの生涯 trigger 確率、S3c 校正)
const TRAP_P_MAX = 0.9; // trigger 確率の上限 (最大露出/脅威時)
const CHECK_BREAK_E_DAMAGE = 300; // check_break 発動時の期待効果 (cp、王手駒の捕獲 = 大駒級)
const NO_PROMOTE_E_DAMAGE = 160; // no_promote 発動時の期待効果 (cp、成り阻止)
// D-KS=C: 自玉露出度 / 相手成り脅威度は moves / variants プリミティブで自前算出するため、
// 露出・脅威 → 確率の正規化基準も本実装独自 (PoC-2 の evaluateKingSafety スケールは非継承)。
const KING_EXPOSURE_REF = 6; // 自玉露出度がこの値で P_MAX に到達
const KING_IN_CHECK_WEIGHT = 3; // 王手中は露出度に加点 (現に王手される確率が高い)
const PROMO_THREAT_REF = 6; // 相手成り脅威度がこの値で P_MAX に到達
const PROMO_PROXIMITY_MAX = 3; // 相手の成り地点までの距離がこの値未満の駒を脅威として加点

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// 自玉露出度: 自玉の 8 近傍のうち相手の利きがあるマス数 + 王手中の加点。
// 玉不在 (異常局面) は露出度 0 (= 最小 trigger) を返す。
function kingExposure(gameState: GameState, player: Player): number {
  const board = gameState.board;
  const boardSize = { rows: board.length, cols: board[0]?.length ?? 0 };
  const kingPos = findKing(board, player, boardSize);
  if (!kingPos) return 0;
  const opponent: Player = player === "sente" ? "gote" : "sente";
  let exposure = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kingPos.row + dr;
      const c = kingPos.col + dc;
      if (r < 0 || r >= boardSize.rows || c < 0 || c >= boardSize.cols) continue;
      if (isSquareAttackedByFast(board, { row: r, col: c }, opponent, boardSize)) exposure++;
    }
  }
  if (isSquareAttackedByFast(board, kingPos, opponent, boardSize)) exposure += KING_IN_CHECK_WEIGHT;
  return exposure;
}

// check_break valueModel: 自玉露出度 → trigger 確率 → P_trigger × E_damage (gross)。
// 自玉が危ないほど王手 (= 発動) されやすく、王手崩しの価値が高い。
const checkBreakValueModel: ValueModel = (gameState, player) => {
  const ratio = clamp01(kingExposure(gameState, player) / KING_EXPOSURE_REF);
  const pTrigger = TRAP_P_MIN + ratio * (TRAP_P_MAX - TRAP_P_MIN);
  return pTrigger * CHECK_BREAK_E_DAMAGE;
};

// 相手駒の行 row から相手の成り地点までの距離 (0 = 既に成り地点内)。
function promotionDistance(row: number, opponent: Player, boardRows: number, pzDepth: number): number {
  if (opponent === "sente") {
    // sente の成り地点 = 上 pzDepth 段 (row < pzDepth)。
    return Math.max(0, row - (pzDepth - 1));
  }
  // gote の成り地点 = 下 pzDepth 段 (row >= boardRows - pzDepth)。
  return Math.max(0, boardRows - pzDepth - row);
}

// 相手の成り脅威度: 相手の「成り可能・未成り駒」が相手の成り地点へどれだけ接近しているか。
// 成り地点に近い駒ほど高重み (PROMO_PROXIMITY_MAX − 距離)。promoted_* は canPromote:false で自然に除外。
function promotionThreat(gameState: GameState, player: Player): number {
  const board = gameState.board;
  const boardRows = board.length;
  const opponent: Player = player === "sente" ? "gote" : "sente";
  const pzDepth = STANDARD_VARIANT.rules.promotionZoneRows;
  let threat = 0;
  for (let r = 0; r < boardRows; r++) {
    const rowArr = board[r];
    for (let c = 0; c < rowArr.length; c++) {
      const piece = rowArr[c];
      if (!piece || piece.owner !== opponent) continue;
      if (!PIECE_DEF_MAP.get(piece.type)?.canPromote) continue;
      const dist = promotionDistance(r, opponent, boardRows, pzDepth);
      threat += Math.max(0, PROMO_PROXIMITY_MAX - dist);
    }
  }
  return threat;
}

// no_promote valueModel: 相手成り脅威度 → trigger 確率 → P_trigger × E_damage (gross)。
// 相手が成りそうなほど発動しやすく、成り無効化の価値が高い (check_break と指標を明確に分離、D-NP=B)。
const noPromoteValueModel: ValueModel = (gameState, player) => {
  const ratio = clamp01(promotionThreat(gameState, player) / PROMO_THREAT_REF);
  const pPromo = TRAP_P_MIN + ratio * (TRAP_P_MAX - TRAP_P_MIN);
  return pPromo * NO_PROMOTE_E_DAMAGE;
};

// modifyBoard effect: applyXxx (Position 受け) を CardTarget (square) 受けに包む薄い wrapper。
function boardEffect(
  apply: (state: GameState, player: Player, target: Position) => GameState | null,
): EffectSpec {
  return {
    type: "modifyBoard",
    apply: (gameState, player, target) =>
      target.kind === "square"
        ? apply(gameState, player, { row: target.row, col: target.col })
        : null,
  };
}

// CARD_USE_CONDITIONS を (world, player) シグネチャに統一して内包 (§8)。
// 現行条件は gameState のみ参照 (cardState 未使用) のため、world.gameState への委譲で等価。
// 条件が未登録のカードは undefined (= 常に使用可)。
// 命名: `use` 始まりにすると react-hooks/rules-of-hooks が Hook と誤検知するため `resolve...` とする。
function resolveUseCondition(id: CardId): UseCondition | undefined {
  const fn = CARD_USE_CONDITIONS[id];
  return fn ? (world, player) => fn(world.gameState, player, world.cardState) : undefined;
}

// CardSpec 組み立て共通処理。targeting / checkUsage / eventKind / useCondition は CARD_DEFS・CARD_META
// から派生し (S2a additive = definitions.ts を SSOT 維持)、effect / valueModel / multiPly のみ registry が付与する。
function buildSpec(
  id: CardId,
  effect: EffectSpec | undefined,
  valueModel: ValueModel,
  opts: { multiPly?: number } = {},
): CardSpec {
  const def = CARD_DEFS[id];
  const meta = CARD_META[id];
  return {
    meta,
    targeting: def.targeting,
    effect,
    multiPly: opts.multiPly,
    useCondition: resolveUseCondition(id),
    checkUsage: def.checkUsage,
    valueModel,
    eventKind: deriveEventKind(meta),
  };
}

// ===== 7 カード registry (SSOT) =====
// 挿入順は CARD_DEFS / CARD_META と一致させる。
export const CARD_SPECS: Record<CardId, CardSpec> = {
  // 廃止 (status: "deprecated")。即時マナ +3 (上限 manaCap でクランプ)。
  mana_up: buildSpec(
    "mana_up",
    { type: "modifyResource", mana: 3 },
    staticValueModel(STATIC_CARD_VALUE.mana_up ?? 0),
  ),
  // 自盤上の歩 / と金 1 枚を持ち駒へ (unpromote)。
  pawn_return: buildSpec(
    "pawn_return",
    boardEffect(applyPawnReturn),
    staticValueModel(STATIC_CARD_VALUE.pawn_return ?? 0),
  ),
  // 持ち駒の歩 1 枚を自分の歩がいる列の空マスへ (二歩禁則の一時解除)。
  double_pawn: buildSpec(
    "double_pawn",
    boardEffect(applyDoublePawn),
    staticValueModel(STATIC_CARD_VALUE.double_pawn ?? 0),
  ),
  // 自盤上の駒 (玉以外) 1 枚を持ち駒へ (unpromote)。歩戻しの上位互換。
  piece_return: buildSpec(
    "piece_return",
    boardEffect(applyPieceReturn),
    staticValueModel(STATIC_CARD_VALUE.piece_return ?? 0),
  ),
  // トラップ: 相手の王手宣言時に王手駒を全て持ち駒化 (発火は move-effects インライン = Route B)。
  // S3a: valueModel を自玉露出度ベースの局面依存値に (危ない局面ほど高価値)。
  check_break: buildSpec(
    "check_break",
    { type: "setTrap", trigger: "check_declared" },
    checkBreakValueModel,
  ),
  // 二手指し: 1 ターンに続けて 2 手指す。effect なし・multiPly: 2 のみ (A1/A2)。
  double_move: buildSpec(
    "double_move",
    undefined,
    staticValueModel(STATIC_CARD_VALUE.double_move ?? 0),
    { multiPly: 2 },
  ),
  // トラップ: 相手の成り宣言を無効化し「成り不可」を永続付与 (発火は move-effects インライン = Route B)。
  // S3a: valueModel を相手成り脅威度ベースの局面依存値に (相手が成りそうなほど高価値)。
  no_promote: buildSpec(
    "no_promote",
    { type: "setTrap", trigger: "promotion_declared" },
    noPromoteValueModel,
  ),
};

// 単一カード仕様を取得。
export function getCardSpec(id: CardId): CardSpec {
  return CARD_SPECS[id];
}

// 全カード仕様 (挿入順)。
export function getAllCardSpecs(): CardSpec[] {
  return Object.values(CARD_SPECS);
}

// カードの局面依存価値 (cp、player 視点の gross 値) を取得する SSOT アクセサ (S3b 依存反転)。
// AI 側 (digest / search) はトラップ評価を本関数経由に統一し、固定係数 TRAP_VALUE_* を脱却する
// (ai → L1 の正方向依存。cost は AI の mana 会計が別途処理するため本値はコストを引かない gross)。
export function getCardValue(id: CardId, gameState: GameState, player: Player): number {
  return CARD_SPECS[id].valueModel(gameState, player);
}
