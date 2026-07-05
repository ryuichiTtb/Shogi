// Issue #245 派生 (検証デバッグ): CPU エンジン選択の実効判定 (route から分離した純関数)。
//
// master switch = サーバ env ENABLE_LEARNED_EVAL (Preview のみ設定)。
// - env OFF (production): request の engine が何であれ **false** = 従来 bolt-on 固定 (バイト不変)。
// - env ON (Preview): engine 未指定 / "learned" = 学習エンジン (後方互換 = 現 Preview 挙動)、
//   "legacy" 明示指定時のみ旧版 bolt-on へ (龍王(旧) vs 龍王(新) の比較検証用)。
//
// route ファイルは Next.js が export を制限するため別モジュールに置き、ユニットテストで
// 「env OFF では param に依らず false」(production 無回帰の核心) を pin する。

import type { EngineId } from "@/lib/shogi/variants/types";

export function resolveWantsLearned(
  learnedEnabled: boolean,
  engine: EngineId | undefined,
): boolean {
  return learnedEnabled && engine !== "legacy";
}
