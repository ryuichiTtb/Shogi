import type { GameState, Player } from "@/lib/shogi/types";
import type { CardDefinition, CardId, CardUseCondition } from "./types";

// ----- 共通 useCondition ヘルパ -----

// 自分の盤上に「歩 or と金」があるか (歩戻しの使用条件)
function hasOwnPawnOnBoard(gameState: GameState, player: Player): boolean {
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const piece = gameState.board[r][c];
      if (piece && piece.owner === player && (piece.type === "pawn" || piece.type === "promoted_pawn")) {
        return true;
      }
    }
  }
  return false;
}

// 自分の盤上に「未成り歩」があるか (二歩指しの対象列判定の前提)
function hasOwnUnpromotedPawnOnBoard(gameState: GameState, player: Player): boolean {
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const piece = gameState.board[r][c];
      if (piece && piece.owner === player && piece.type === "pawn") {
        return true;
      }
    }
  }
  return false;
}

// 自分の盤上に「玉以外の駒」が1枚以上あるか (駒戻しの使用条件)
function hasOwnNonKingPieceOnBoard(gameState: GameState, player: Player): boolean {
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const piece = gameState.board[r][c];
      if (piece && piece.owner === player && piece.type !== "king") {
        return true;
      }
    }
  }
  return false;
}

// Phase 0 暫定カード3種(設計ドキュメント 3.5)
// 「状態のみ」「ターゲット選択あり」「トラップ」の3パターンを最小被覆。
export const CARD_DEFS: Record<CardId, CardDefinition> = {
  // Issue #82 で廃止。「マナを使ってマナを増やす」という設計の意義が薄いと判断。
  // 効果コード(applyManaUp / use-card-shogi-game の effectId 分岐)の最終撤去は #80 で扱う。
  mana_up: {
    id: "mana_up",
    kind: "normal",
    name: "マナUP",
    description: "マナを3チャージする",
    cost: 2,
    rarity: "common",
    effectId: "mana_up",
    targeting: "none",
    icon: "💎",
    status: "deprecated",
    phase: "0",
    detailDescription:
      "使用すると即時にマナを +3 する。\n\n- ターゲット選択なし\n- マナ上限(現状20)を超えてチャージしない\n- 1ターン中の使用上限なし(マナ消費分は支払う必要あり)\n\n【廃止】Issue #82 のカード初版検討で廃止判断。マナ消費でマナを増やす設計の意義が薄いため。",
    addedAt: "2026-04-30",
    relatedIssues: [68, 80, 82],
  },
  pawn_return: {
    id: "pawn_return",
    kind: "normal",
    name: "歩戻し",
    description: "自分の盤上の歩を1枚、持ち駒に戻す",
    cost: 1,
    rarity: "common",
    effectId: "pawn_return",
    targeting: "ownPiece",
    icon: "↩️",
    status: "active",
    phase: "0",
    detailDescription:
      "自分の盤上の歩 / と金 1枚を選び、持ち駒に戻す。\n\n- ターゲット: 自盤上の歩(と金含む)\n- と金は成り解除されて「歩」として持ち駒になる(将棋ルール準拠)\n- 持ち駒に戻った歩は次ターン以降に通常通り打てる",
    useConditionDescription:
      "- 自分の盤上に歩 もしくは と金 が1枚以上ある",
    addedAt: "2026-04-30",
    relatedIssues: [68, 80, 82],
  },
  double_pawn: {
    id: "double_pawn",
    kind: "normal",
    name: "二歩指し",
    description: "持ち駒の歩 1枚を、自分の歩がいる列の空マスに打つ",
    cost: 2,
    rarity: "common",
    effectId: "double_pawn",
    targeting: "square",
    icon: "🎴",
    status: "active",
    phase: "A",
    detailDescription:
      "持ち駒の歩 1枚を、自分の未成り歩がいる列の空マスに打つことで、二歩禁則を一時的に解除して同列に2枚目の歩を打てるカード。\n\n【配置可能マス】\n- 自分の未成り歩がある列の空マス\n- 行きどころのない歩(後手側1段目 / 先手側9段目)は不可\n- 打ち歩詰めとなるマスは不可(将棋の根本ルールとして禁則維持)\n\n【その他】\n- 同列に既に複数の歩がある状態でも使用可能(2枚目以降も同列に打てる)\n- 配置先のマスに駒がある場合は不可(空マスのみ)",
    useConditionDescription:
      "- 持ち駒に歩がある\n- 盤上に自分の未成り歩がある(と金は条件に含まれない)",
    addedAt: "2026-05-02",
    relatedIssues: [82],
  },

  piece_return: {
    id: "piece_return",
    kind: "normal",
    name: "駒戻し",
    description: "自分の盤上の駒(玉以外)1枚を持ち駒に戻す",
    cost: 3,
    rarity: "rare",
    effectId: "piece_return",
    targeting: "ownPiece",
    icon: "↩️",
    status: "active",
    phase: "A",
    detailDescription:
      "自分の盤上の駒1枚を選び、持ち駒に戻す。歩戻しの上位互換。\n\n【対象】\n- 自分の盤上の駒(玉は対象外)\n- 成駒は成り解除されて元の駒種で持ち駒になる(と金→歩 / 成銀→銀 / 馬→角 / 龍→飛 等)\n\n【仕様】\n- 持ち駒に戻った駒は、次ターン以降に通常通り打てる\n- 「成り不可」状態(no_promote)が付与された駒を戻した場合、状態は失われる\n- 自玉が王手のまま放置になる手は実行不可(通常の指し手と同様、ピン駒の引き戻しは不可)\n- 王手中はカード使用不可(全カード共通の制約)",
    useConditionDescription:
      "- 自分の盤上に玉以外の駒が1枚以上ある\n- 戻したい駒を盤上から退かしたときに、自玉が王手になる場合は対象外\n  (例: 自玉と相手の飛車の間にいる金を戻すと、飛車の利きが通って王手になるためその金は戻せない)",
    addedAt: "2026-05-02",
    relatedIssues: [82],
  },

  check_break: {
    id: "check_break",
    kind: "trap",
    name: "王手崩し",
    description: "相手が王手してきたとき、王手駒をすべて持ち駒にする",
    cost: 5,
    rarity: "rare",
    effectId: "check_break",
    targeting: "none",
    icon: "⚔️",
    status: "active",
    phase: "A",
    detailDescription:
      "自分の盤面に1枚だけセットできるトラップカード。\n相手の手で自玉が王手になったとき、王手をかけている相手の駒をすべて自分の持ち駒に加えて発動する。\n\n【発動】\n- 自玉が王手された瞬間に自動発動\n- 1枚だけセット可\n- 自分の盤面に同種のトラップが既にセットされている間は使用不可 (Issue #105)\n\n【効果】\n- 王手をかけている相手の駒をすべて取り、自分の持ち駒に加える\n- 両王手・複数王手の場合は、王手している駒すべてが同時に対象\n  (例: 飛車と角の両王手なら、飛車も角も同時に持ち駒化)\n- 成駒は成り解除されて元の駒種で持ち駒になる(龍王→飛 / 龍馬→角 / と金→歩 など、通常の取り駒と同じ)\n- 「成り不可」状態 (no_promote) が付与された駒を取った場合、状態は失われる\n- 王手駒がすべて除去されるため、効果適用後は必ず王手解除されている\n- トラップ自体は発動と同時に破棄される",
    useConditionDescription:
      "- 自分の盤面に「王手崩し」トラップが既にセットされていない",
    addedAt: "2026-05-03",
    relatedIssues: [82, 105],
  },

  no_promote: {
    id: "no_promote",
    kind: "trap",
    name: "成り無効化",
    description: "相手の成り宣言を無効化し、その駒に「成り不可」状態を永続付与する",
    cost: 4,
    rarity: "rare",
    effectId: "no_promote",
    targeting: "none",
    icon: "🛡️",
    status: "active",
    phase: "0",
    detailDescription:
      "自分の盤面に1枚だけセットできるトラップカード。\n次に相手が成りを宣言したとき、その成りを無効化し、対象の駒に「成り不可」状態を永続付与する。トラップ自体は発動と同時に破棄される。\n\n【発動】\n- 相手が成りを宣言したタイミングで自動発動\n- 1枚だけセット可\n- 自分の盤面に同種のトラップが既にセットされている間は使用不可 (Issue #105)\n\n【「成り不可」状態】\n- 状態を付与された駒は、その後一切成ることができない(成らない通常移動は可)\n- 駒を取られた場合、状態は失われる(持ち駒に戻る時点でリセット)\n- 「歩戻し」等で持ち駒に戻った場合も同様に状態は失われる\n- 別途用意される「状態異常解除」系カードで解除可能(将来カード)\n\n【複数発動】\n- 複数の no_promote トラップを順に発動した場合、複数の相手駒に同時に「成り不可」状態が付与される",
    useConditionDescription:
      "- 自分の盤面に「成り無効化」トラップが既にセットされていない",
    addedAt: "2026-04-30",
    relatedIssues: [68, 80, 82, 105],
  },

  // --- サンプルカード (Issue #104 レア度ビジュアル検証用、status: "draft") ---
  // 通常×4 + トラップ×4 = 8 種。effectId/cost は仮で、プールには入らない。

  sample_normal_common: {
    id: "sample_normal_common",
    kind: "normal",
    name: "サンプル通常 ノーマル",
    description: "ノーマルレア度の通常カード見本",
    cost: 1,
    rarity: "common",
    effectId: "noop",
    targeting: "none",
    icon: "🟢",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_normal_rare: {
    id: "sample_normal_rare",
    kind: "normal",
    name: "サンプル通常 レア",
    description: "レアレア度の通常カード見本",
    cost: 3,
    rarity: "rare",
    effectId: "noop",
    targeting: "none",
    icon: "🔷",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_normal_super_rare: {
    id: "sample_normal_super_rare",
    kind: "normal",
    name: "サンプル通常 激レア",
    description: "激レアレア度の通常カード見本",
    cost: 5,
    rarity: "super_rare",
    effectId: "noop",
    targeting: "none",
    icon: "💎",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_normal_epic: {
    id: "sample_normal_epic",
    kind: "normal",
    name: "サンプル通常 究極",
    description: "究極レア度の通常カード見本",
    cost: 7,
    rarity: "epic",
    effectId: "noop",
    targeting: "none",
    icon: "👑",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_common: {
    id: "sample_trap_common",
    kind: "trap",
    name: "サンプルトラップ ノーマル",
    description: "ノーマルレア度のトラップカード見本",
    cost: 2,
    rarity: "common",
    effectId: "noop",
    targeting: "none",
    icon: "🪤",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_rare: {
    id: "sample_trap_rare",
    kind: "trap",
    name: "サンプルトラップ レア",
    description: "レアレア度のトラップカード見本",
    cost: 4,
    rarity: "rare",
    effectId: "noop",
    targeting: "none",
    icon: "🕸️",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_super_rare: {
    id: "sample_trap_super_rare",
    kind: "trap",
    name: "サンプルトラップ 激レア",
    description: "激レアレア度のトラップカード見本",
    cost: 6,
    rarity: "super_rare",
    effectId: "noop",
    targeting: "none",
    icon: "☠️",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_epic: {
    id: "sample_trap_epic",
    kind: "trap",
    name: "サンプルトラップ 究極",
    description: "究極レア度のトラップカード見本",
    cost: 8,
    rarity: "epic",
    effectId: "noop",
    targeting: "none",
    icon: "🌟",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
};

export const ALL_CARD_DEFS: CardDefinition[] = Object.values(CARD_DEFS);

// カード使用条件 (Issue #82)。
// 関数フィールドは Server→Client 境界で serialize できないため CardDefinition 本体には含めず
// 別 Map で管理する。未登録の defId は常に使用可と見なす。
export const CARD_USE_CONDITIONS: Partial<Record<CardId, CardUseCondition>> = {
  // 自分の盤上に歩 or と金が1枚以上あれば使用可 (歩戻しは と金も対象、unpromote して持ち駒の歩になる)
  pawn_return: (gameState, player) => hasOwnPawnOnBoard(gameState, player),
  // 持ち駒に歩あり & 盤上に自分の未成り歩あり (と金は対象列の起点にならない)
  double_pawn: (gameState, player) => {
    const handPawnCount = gameState.hand[player]["pawn"] ?? 0;
    if (handPawnCount <= 0) return false;
    return hasOwnUnpromotedPawnOnBoard(gameState, player);
  },
  // 自分の盤上に玉以外の駒が1枚以上あれば使用可。
  // ※ ピン駒しか残っていない極限状況では選択肢ゼロになるが、その判定は SELECT_SQUARE 側で行う。
  piece_return: (gameState, player) => hasOwnNonKingPieceOnBoard(gameState, player),
};

// マナ・ドローコストの確定値(Issue #81 / 2026-05-01 確定)
export const INITIAL_MANA: Record<"sente" | "gote", number> = {
  sente: 2,
  gote: 3,
};

// 将来カード効果(自分UP/相手DOWN)で動的化する想定。state 側で保持する初期値として参照する。
export const MANA_CAP = 20;

// マナを消費して山札からドロー
export const DRAW_COST = 3;

// 1ターン消費すると +1、早指し(FAST_THRESHOLD_MS 以内)で +2
export const MANA_PER_TURN = 1;
export const MANA_FAST_BONUS = 1; // 早指し時の追加分(合計+2)
export const FAST_THRESHOLD_MS = 3000;
