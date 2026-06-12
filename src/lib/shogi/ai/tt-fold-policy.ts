// Issue #235 S4b-1b: TT (置換表) が cardState の各 slice をどう fold するかの方針宣言。
//
// 背景 (S4c で消費):
//   カード将棋を TurnAction 単一探索木へ移す S4c-2 では TT key = boardHash ^ cardFold。
//   cardState のどの slice を hash に畳み込む (fold) かを slice ごとに **型強制で宣言** し、
//   宣言漏れ (CardGameState への slice 追加時) をコンパイルエラー + 網羅 unit test で検出する。
//   本ファイルは「宣言 + 網羅性ガード」のみで、実 fold 計算 (slice 正規化 + hash 合成) は S4c-2。
//
// FoldPolicy の3値:
//   - "fold":           slice 内容 (正規化後) を TT key に畳み込む。同一局面性 (transposition) に影響。
//   - "foldLength":     配列の length のみ畳み込む (内容/順序は無視)。deck 専用。
//   - "evalIrrelevant": TT key に無関係。畳み込むと同一局面が分散し hit 率を無駄に下げるだけ。
//
// 分類根拠 (M1 レビューでコード read 実測、計画 doc §11 確定表):
//   fold 系は digest / canDraw / getCardActions / mark-aware 合法手生成が参照する slice。
//   evalIrrelevant は探索経路で read されない slice。

import type { CardGameState } from "@/lib/shogi/cards/types";

export type FoldPolicy = "fold" | "foldLength" | "evalIrrelevant";

// keyof CardGameState を Record で型強制 → CardGameState に slice を追加すると、ここへの宣言を
// 忘れた時点でコンパイルエラーになる (網羅性の第一防御)。実行時網羅は tt-fold-policy.test.ts。
export const CARD_STATE_FOLD_POLICY: Record<keyof CardGameState, FoldPolicy> = {
  mana: "fold", // digest + canDraw + getCardActions が参照
  hand: "fold", // getCardActions が hand の defId を読む (合法 card action が内容依存)。fold 時は defId 多重集合で正規化
  trap: "fold", // digest.trapValueDelta + 同種トラップ抑止
  noPromoteMarks: "fold", // digest + mark-aware 合法手生成に影響
  drawProgress: "fold", // digest.drawProgressDelta + canDraw 閾値
  deck: "foldLength", // canDraw は deck.length のみ参照。内容 fold は断片化 (R-9 悪化)、完全無視は auto-draw 後の手札差を誤 hit → length 一致で同一視が正
  graveyard: "evalIrrelevant", // ai/kernel 探索で read ゼロ。fold は hit 率を無駄に落とすだけ
  manaCap: "evalIrrelevant", // 現状 MANA_CAP 定数。S4d で動的マナ上限を入れたら "fold" へ昇格要
  pendingCard: "evalIrrelevant", // UI 専用、探索未参照
  lastTurnStartedAt: "evalIrrelevant", // 探索は spectatorMode=true 固定 (search.ts) で早指し無効。spectatorMode を可変化したら再検討要
};
