// Preview 実機検証用の学習脳ロード (Issue #245 Preview 配線)。
//
// 目的: env ENABLE_LEARNED_EVAL=1 の Vercel Preview デプロイでのみ、AI が学習評価 (NN) で指すように
// する。route.ts が **動的 import** でこのモジュールを読む (= 本モジュール + 1.67MB 重み JSON は
// フラグ ON 経路でのみバンドルロード/parse され、production/main の cold-start は完全不変)。
//
// ★重み bootstrap-small.json は元 { model, meta } から .model のみ抽出したフラット SerializedMlp
//   (M1 B-1: loadLearnedModel はフラット形式を要求。既存ローダ winrate-245.ts:98 等と一致)。
// ★featureDim スキュー検知 (M1 N-1: encoder レイアウト変更後に古い複製を載せると silent に壊れる)。
// ★ロード成否を console.info (M1 M-1: 未ロードで人手 eval へ silent fallback すると「検証したつもり」
//   で baseline と同挙動になり空振り。Vercel Function ログで NN 有効化を確認できるようにする)。

import { FEATURE_DIM } from "../encoder";
import { hasLearnedModel, loadLearnedModel } from "../infer";
import type { SerializedMlp } from "../mlp";

import flatModel from "./bootstrap-small.json";

let attempted = false;

// 学習モデルを 1 回だけロードする (冪等)。serverless の各インスタンス cold-start で 1 回呼ばれる。
// 失敗 (featureDim スキュー) 時も attempted を立て再試行しない (決定論)。呼び出し側は本関数後に
// hasLearnedModel() が true なら NN 経路、false なら従来の人手 eval が使われる (search.ts:898 のガード)。
export function ensureLearnedModelLoaded(): void {
  if (attempted) return;
  attempted = true;
  const model = flatModel as unknown as SerializedMlp;
  if (model.featureDim !== FEATURE_DIM) {
    console.error(
      `[learned-eval] featureDim スキュー: model=${model.featureDim} encoder=${FEATURE_DIM}。` +
        `重み複製が encoder と不整合ゆえロード中止 (人手 eval で継続)。`,
    );
    return;
  }
  loadLearnedModel(model);
  console.info(
    `[learned-eval] 学習脳ロード成功 (featureDim=${model.featureDim}, hidden=${model.hidden})。` +
      `useLearnedEval=ON、hasLearnedModel=${hasLearnedModel()}。`,
  );
}
