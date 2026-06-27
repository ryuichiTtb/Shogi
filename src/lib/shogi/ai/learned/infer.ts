// 学習型評価の推論 (Issue #245 フェーズ1 P1-3)。
//
// 学習済み重み (mlp.ts の SerializedMlp) を読み込み、World 探索のリーフで局面を採点する。
// ★符号化・forward は学習側 (encoder.ts / mlp.ts) と同一実装を共有 = train/inference スキューゼロ。
//
// 出力スケール (M1 MAJOR-1): NN の生出力は tanh ∈ [-1,1] (先手絶対視点の勝敗見込み)。これを
// CP_SCALE 倍して cp スケールへ較正し、既存 evaluate (material 等の cp) と同じ土俵に乗せる。
// 探索の futility margin (300/500) / delta pruning (+200) は cp 前提ゆえ、較正なしでは枝刈りが
// 歪む。CP_SCALE は P1-4 で bench 校正する暫定値 (gap>0 の戦術局面での損得が cp で表現されるよう調整)。
//
// 終局は evaluate と同じ規約 (checkmate=±100000 / 非 active=0) を返し、探索の mate 判定 (MATE_SCORE)
// と整合させる。本番は useLearnedEval OFF ゆえ本モジュールは呼ばれない (production 完全無影響)。

import type { CardGameState } from "@/lib/shogi/cards/types";
import type { GameState } from "@/lib/shogi/types";

import { encodePosition } from "./encoder";
import { deserializeModel, predictSparse, type MlpModel, type SerializedMlp } from "./mlp";

// tanh∈[-1,1] → cp 換算の基準。+1 (確実な先手勝ち) ≈ +1000cp (= 決定的優勢の人手 eval と同程度)。
// MATE_SCORE / ±100000 (詰み) より十分小さく、非終局リーフ評価の値域として cp 前提と両立する。
// P1-4 で bench 校正する暫定値。
export const CP_SCALE = 1000;

// 読み込み済みモデル (プロセス内シングルトン)。production は未ロード = null。
// bench / test が loadLearnedModel で注入し、useLearnedEval ON 経路でのみ参照される。
let LEARNED_MODEL: MlpModel | null = null;

// 重みを注入する。serialized=null でアンロード (テスト後始末 / 明示無効化)。
export function loadLearnedModel(serialized: SerializedMlp | null): void {
  LEARNED_MODEL = serialized ? deserializeModel(serialized) : null;
}

export function getLearnedModel(): MlpModel | null {
  return LEARNED_MODEL;
}

export function hasLearnedModel(): boolean {
  return LEARNED_MODEL !== null;
}

// 学習評価: 局面 → 先手絶対視点の cp スコア。モデル未ロード時は呼び出し側が evalLeafWorld で
// ガードする前提だが、防御的に未ロードなら例外を投げる (静かな 0 評価で探索が壊れるのを防ぐ)。
export function evaluateLearned(state: GameState, cardState: CardGameState): number {
  // 終局は evaluate と同一規約 (探索の mate 判定と整合)。
  if (state.status === "checkmate") {
    return state.winner === "sente" ? 100000 : -100000;
  }
  if (state.status !== "active") return 0;

  const model = LEARNED_MODEL;
  if (model === null) {
    throw new Error("evaluateLearned: モデル未ロード (loadLearnedModel を先に呼ぶこと)");
  }
  // encodePosition は EncoderPosition (= GameState が構造的に満たす) + CardGameState を受ける。
  // 特徴は疎 (盤面 one-hot 等で非ゼロ ~2%) ゆえ predictSparse (第1層 O(hidden×nnz)) を使う。
  // dense predict (O(hidden×featureDim)) より ~20倍速く、探索ホットパス (1手数千評価) の負荷を抑える。
  // 疎/密は数値的に一致 (mlp.test の保証)。
  const f = encodePosition(state, cardState);
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < f.length; i++) {
    if (f[i] !== 0) {
      idx.push(i);
      val.push(f[i]);
    }
  }
  const y = predictSparse(model, idx, val);
  return y * CP_SCALE;
}
