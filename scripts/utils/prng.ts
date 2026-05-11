// Issue #193 / PR1b (Phase 3): fixture 生成用の決定的 PRNG (Mulberry32)。
//
// 設計意図:
// JavaScript 組込 `Math.random` は seed 指定不可で、fixture を再現性をもって
// 生成できない。外部依存追加 (`seedrandom` 等) を避けるため、Mulberry32 を
// 自前実装で導入する。AGENTS.md ルール 7「外部通信・機密情報ポリシー」と整合。
//
// 用途: PR1b の `gen-fixture-legal-moves.ts` / PR1c の `gen-fixture-evaluate.ts`
// から共有 import。後続 PR (PR1c-2 strategy fixture / PR1d cardDigest fixture /
// PR2 evaluate fixture 再生成 / 観戦モード基準 fixture) でも再利用想定。
//
// 詳細: docs/plans/issue-193-pr1b-pr1c.md「## 共通設計指針 — Mulberry32 seed 管理」
// 参照。
//
// 品質: Mulberry32 は xorshift 派生の 32-bit PRNG。fixture 生成用途では十分な
// 品質 (周期 2^32、stationary distribution、衝突確率実用上問題なし)。暗号学的
// 用途には使用しないこと。

/**
 * Mulberry32 PRNG。
 *
 * @param seed 32-bit unsigned integer (0 以上)。負値や非整数を渡しても `>>> 0` で正規化される。
 * @returns 0 以上 1 未満の浮動小数点を返す関数。呼び出すたびに状態が更新される。
 *
 * @example
 * const rng = mulberry32(42);
 * rng(); // 0.123... (deterministic)
 * rng(); // 0.456... (deterministic)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 0 以上 max 未満の整数を返す (rng の結果を整数化)。
 * 配列インデックスのランダム選択等に使う。
 */
export function randomInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

/**
 * 配列からランダムに 1 要素を選んで返す。
 * 空配列を渡した場合は undefined を返す (呼び出し側で要 null チェック)。
 */
export function randomChoice<T>(rng: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[randomInt(rng, items.length)];
}

/**
 * コマンドライン引数から `--seed=N` を解析して seed 値を取得。
 * 未指定の場合は `defaultSeed` (= 42) を返す。
 *
 * @example
 * // node scripts/gen-fixture-legal-moves.ts --seed=123
 * const seed = parseSeedFromArgv(process.argv);  // 123
 */
export function parseSeedFromArgv(argv: readonly string[], defaultSeed = 42): number {
  for (const arg of argv) {
    const m = /^--seed=(\d+)$/.exec(arg);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return defaultSeed;
}
