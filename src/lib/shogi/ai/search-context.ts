// Issue #176 Phase 2: 探索全体で共有する deadline / 停止フラグ / per-request stats を保持する。
//
// 設計:
// - `deadlineAt` を `performance.now()` ベースの絶対時刻で持ち、root / negamax /
//   quiescence のどこからでも同じ基準で停止判定できる
// - `signal` (AbortSignal) を持たせ、Route Handler の `request.signal` 経由で
//   client abort (待った / 終局 / unmount) を即時に探索へ伝播する
// - 停止判定 `shouldStop` は毎 node から呼ばれるため、performance.now() の呼び出しは
//   1024 node ごとに抑える。abort signal は同期チェックなので毎回見て良い
// - 停止後の探索結果は TT / killer / history に保存しない (上位で「未完了 depth は
//   採用しない」を実現するため、ノイズ書き戻しを避ける必要がある)
// - TT / killer / history はすべて per-request にする (Stage C)。Vercel の同一 Node
//   プロセスで複数 user が同時に AI 思考をトリガしたとき、相互上書き / 非決定性 /
//   メモリ膨張を避けるため

import type { Move } from "../types";
import { TranspositionTable } from "./transpositionTable";
import type { CardDigest } from "./cards/digest";

export const MAX_DEPTH = 64;

export type StopReason = "none" | "deadline" | "abort";

export interface SearchStats {
  elapsedMs: number;
  depthCompleted: number;
  nodes: number;
  timedOut: boolean;
  stoppedBy: StopReason;
  usedBook: boolean;
  usedFallback: boolean;
  // Issue #193 / PR1d-2: root で playCard / draw が選ばれたかを記録 (observability)。
  // findBestMoveWithStats 内の blunder guard 排他制御 (= playCard 選択時は skip) と
  // 同じローカル状態を SearchStats 経由で外部から観測可能にする。
  // 未指定時は false (= 振る舞いキープ、PR1d-1 完了時点と同等)。
  usedCardAction: boolean;
}

export interface SearchContext {
  startedAt: number;          // performance.now() 起点
  deadlineAt: number;         // performance.now() ベースの hard stop
  nodes: number;              // 探索した node 総数
  stopped: boolean;           // true なら以後の探索は早期 return
  stoppedBy: StopReason;      // 停止理由
  depthCompleted: number;     // root で完全に終わった最大 depth
  signal?: AbortSignal;       // client abort 用
  // per-request 探索状態 (Stage C: globalTT 等を ctx 配下へ移行)
  tt: TranspositionTable;
  killerMoves: (Move | null)[][];
  historyTable: number[][];
  // Issue #193 / PR1d-1: root で 1 回計算した cardDigest を子ノードに伝播 (W-1 root スカラー方式)。
  // 未指定時は cardDigest 加算 skip (= 既存挙動完全保持、PR1c の 1000 局面 evaluate fixture の
  // byte-level equality を維持)。指定時は quiescence / negamax 内の evaluate 呼出にそのまま渡す
  // (= ホットパスでの再計算を構造的に禁止)。
  cardDigest?: CardDigest;
  // Issue #235 S1b: AI root カード/ドロー評価を L0 カーネル applyTurnAction 経由に切替えるフラグ。
  // 既定 false (= 旧経路 applyActionForLookahead / 手動 wiring を使う = production 完全不変)。
  // true のとき evaluateActionWithLookahead / searchDoubleMoveSuperAction が kernel 経路に分岐する
  // (card-shogi のみ、DP-1〜7 を自動適用)。S1d cutover まで production は false 固定。
  useKernelSearch?: boolean;
  // Issue #235 S1b: kernel applyTurnAction へ渡す spectatorMode (DP-4 決定論化、早指し無効)。
  // 既定 false。AI 探索の lookahead は手番時間を持たないため manaCharge の早指し判定は
  // 本来不要だが、kernel の makeMoveWithEffects に正しく伝播するため保持する。
  spectatorMode?: boolean;
  // Issue #235 派生 (Vercel 504 対策、2026-06-10): root アクション評価フェーズ (カード/ドロー
  // lookahead + double_move super-action) 専用の hard deadline (performance.now() 基準)。
  // deep search は deadlineAt (= startedAt + timeLimitMs) を使い切ってから返るため、その後に
  // 走るアクション評価は別予算で bound しないと無制限になる (実測: 終盤の二手指し super-action
  // 1 回 ≈ 4s 超 → Vercel maxDuration 10s 超過で FUNCTION_INVOCATION_TIMEOUT)。
  // engine.ts が ACTION_PHASE_BUDGET_RATIO から設定する。未設定 (undefined) = 無制限
  // (既存テスト / fixture 生成 (maxDepth 指定) の決定論を保つ互換動作)。
  actionPhaseDeadlineAt?: number;
}

export interface CreateSearchContextOptions {
  timeLimitMs: number;
  signal?: AbortSignal;
  cardDigest?: CardDigest;
  // Issue #235 S1b: 下記 2 フラグ。既定 false (= 既存挙動完全保持)。
  useKernelSearch?: boolean;
  spectatorMode?: boolean;
}

export function createSearchContext(opts: CreateSearchContextOptions): SearchContext {
  const startedAt = performance.now();
  return {
    startedAt,
    deadlineAt: startedAt + opts.timeLimitMs,
    nodes: 0,
    stopped: false,
    stoppedBy: "none",
    depthCompleted: 0,
    signal: opts.signal,
    tt: new TranspositionTable(),
    killerMoves: Array.from({ length: MAX_DEPTH }, () => [null, null] as [Move | null, Move | null]),
    historyTable: Array.from({ length: 81 }, () => new Array<number>(81).fill(0)),
    cardDigest: opts.cardDigest,
    useKernelSearch: opts.useKernelSearch ?? false,
    spectatorMode: opts.spectatorMode ?? false,
  };
}

// 探索の停止判定。毎 node 冒頭で呼ぶ想定。
// nodes counter は呼び出し側で `ctx.nodes++` 済みであることを前提とする。
export function shouldStop(ctx: SearchContext): boolean {
  if (ctx.stopped) return true;
  if (ctx.signal?.aborted) {
    ctx.stopped = true;
    ctx.stoppedBy = "abort";
    return true;
  }
  // 1024 node ごとに wall clock check (performance.now() のコストを抑える)。
  // (nodes & 1023) === 0 は 0, 1024, 2048, ... で true になる。
  if ((ctx.nodes & 1023) === 0) {
    if (performance.now() >= ctx.deadlineAt) {
      ctx.stopped = true;
      ctx.stoppedBy = "deadline";
      return true;
    }
  }
  return false;
}

// root アクション評価フェーズの時間切れ判定 (Vercel 504 対策)。
// 呼び出し頻度は super-action の combo 単位 (~数百〜千回/手、1 combo ≈ ms 級) のため、
// node カウンタによる間引きは不要 (performance.now() 直呼びのコストは combo 処理の 1/10000 以下)。
// ctx 未渡し / actionPhaseDeadlineAt 未設定の経路 (テスト・fixture) では常に false = 無制限互換。
export function isActionPhaseTimeUp(ctx: SearchContext | undefined): boolean {
  return (
    ctx?.actionPhaseDeadlineAt !== undefined &&
    performance.now() >= ctx.actionPhaseDeadlineAt
  );
}

// 探索終了時に SearchStats を構築する。
export function finalizeStats(
  ctx: SearchContext,
  extras: { usedBook: boolean; usedFallback: boolean; usedCardAction?: boolean },
): SearchStats {
  return {
    elapsedMs: performance.now() - ctx.startedAt,
    depthCompleted: ctx.depthCompleted,
    nodes: ctx.nodes,
    timedOut: ctx.stoppedBy === "deadline",
    stoppedBy: ctx.stoppedBy,
    usedBook: extras.usedBook,
    usedFallback: extras.usedFallback,
    // PR1d-2 (W-6 整合): usedCardAction 未指定時は false (= 振る舞いキープ)
    usedCardAction: extras.usedCardAction ?? false,
  };
}
