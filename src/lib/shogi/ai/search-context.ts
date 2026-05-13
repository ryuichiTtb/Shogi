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
}

export interface CreateSearchContextOptions {
  timeLimitMs: number;
  signal?: AbortSignal;
  cardDigest?: CardDigest;
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
