// Issue #245 教材多様化 段3: 自己対戦を「まだ見ていない局面・行動」へ寄せるための多様化コア。
//
// 背景 (計画書 §1.1 の実測): 教材 348 局のうち **初手はわずか 2 通り**、完全同一棋譜が 68 局 (19.5%)、
// 0-15 手帯のサンプルは 66〜87% が他局と完全一致していた。根因は `advanced` 難易度が
// `addNoise = 0` = 完全決定的で、乱数源がデッキシャッフルだけに縮退していたこと。
// 同じ強さのまま多様な局面を作るには「**互角に近い候補の中から、まだ選んでいない手を優先する**」
// のが素直で、棋力を落とさずに分岐を増やせる。
//
// 設計の要点:
// - **ハード ban にしない**。既出手を禁止すると候補が枯渇したときに手が無くなる。
//   「出現回数が最小の層から一様抽選」に一本化すれば、全部既出でも必ず 1 手選べる。
// - **同一性は "モデルから見た同じ" で定義する**。行動は instanceId (使い捨ての識別子) を除き、
//   局面は encoder が実際に見る入力で見る (盤面が同じでもマナ・手札が違えば別局面)。
// - **決定的**。seed を固定すれば同じ教材が再生成できる (Math.random は使わない)。
//
// 純粋関数のみ (fs / AI 探索に非依存)。実 I/O と探索との配線は段4 の
// scripts/selfplay-245.ts / scripts/build-seen-index-245.ts が担う。

import { deserializeCardState } from "@/lib/shogi/cards/state";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import { encodePosition, type EncoderPosition } from "@/lib/shogi/ai/learned/encoder";

import type { TrainingSampleData } from "./types";

// ---------------------------------------------------------------------------
// 同一性キー
// ---------------------------------------------------------------------------

/**
 * 行動の同一性キー。
 *
 * instanceId は「同じカードの何枚目か」を表す使い捨ての識別子で、盤面への効果は同じなので除く
 * (含めると "同じ手" が別扱いになり、多様化が空回りする)。
 * move は type / from / to / promote / dropPiece で一意 (piece と captured は局面から決まる従属情報)。
 */
export function actionKey(action: TurnAction): string {
  switch (action.kind) {
    case "draw":
      return "d";
    case "move": {
      const m = action.move;
      const from = m.from ? `${m.from.row}.${m.from.col}` : "-";
      return `m|${m.type}|${from}|${m.to.row}.${m.to.col}|${m.promote ? 1 : 0}|${m.dropPiece ?? "-"}`;
    }
    case "playCard": {
      const t = action.target;
      const target =
        t === undefined ? "-" : t.kind === "square" ? `s${t.row}.${t.col}` : `h${t.pieceType}`;
      return `c|${action.defId}|${target}`;
    }
  }
}

// FNV-1a (32bit)。文字列を安定した整数へ潰す。暗号用途ではない。
function fnv1a32(s: string, basis: number, backward: boolean): number {
  let h = basis >>> 0;
  if (backward) {
    for (let i = s.length - 1; i >= 0; i--) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  } else {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/**
 * 64bit 相当の短縮ハッシュ (16 hex)。前向き / 後ろ向きの 2 パスを連結する
 * (同じ漸化式で basis だけ変えると相関が残るため、走査方向を変えて独立性を得る)。
 * node:crypto を使わないのは、本モジュールを client 同居ディレクトリに置くため。
 * 衝突は「別局面が同一視されて多様化カウントが混ざる」だけで壊れないが、
 * 64bit なら 100 万件でも衝突確率は 10^-8 以下。
 */
function hash64(s: string): string {
  const a = fnv1a32(s, 0x811c9dc5, false);
  const b = fnv1a32(s, 0x9e3779b9, true);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * 局面の同一性キー = **encoder が実際に見る入力**のハッシュ。
 *
 * 盤面が同じでもマナ・手札・トラップが違えばモデルには別入力なので別局面として数える
 * (逆に、手札の並び順が違うだけなら encoder は defId 別の枚数しか見ないので同一になる)。
 * scripts/clean-training-245.ts の重複判定と同じ「同一性の定義」を共有する
 * (ハッシュ関数自体は別。あちらは fs 側で sha1 を使う)。
 */
export function positionKey(pos: EncoderPosition, card: CardGameState): string {
  const f = encodePosition(pos, card);
  const parts: string[] = [];
  for (let i = 0; i < f.length; i++) {
    if (f[i] !== 0) parts.push(`${i}:${f[i].toFixed(4)}`);
  }
  return hash64(parts.join(","));
}

/**
 * 教材サンプル 1 件から (局面キー, 行動キー) を取り出す。
 *
 * 「保存済みサンプル → キー」の変換は段4 (既存教材からの索引生成)・段5 (分岐生成)・段7 (集計) で
 * 何度も要る。各所で `boardState as EncoderPosition` + `deserializeCardState` を書き直すと
 * 定義がズレるので、ここに 1 本化する
 * (boardState は serializeBoardForTraining の出力で、構造的に EncoderPosition を満たす)。
 */
export function seenKeysFromSample(sample: TrainingSampleData): { posKey: string; actKey: string } {
  return {
    posKey: positionKey(
      sample.boardState as EncoderPosition,
      deserializeCardState(sample.cardState),
    ),
    actKey: actionKey(sample.action),
  };
}

// ---------------------------------------------------------------------------
// 出現回数の索引
// ---------------------------------------------------------------------------

/** 「どの局面でどの行動を何回選んだか」。多様化の唯一の状態。 */
export interface SeenIndex {
  counts: Map<string, Map<string, number>>;
}

export function createSeenIndex(): SeenIndex {
  return { counts: new Map() };
}

export function getSeenCount(index: SeenIndex, posKey: string, actKey: string): number {
  return index.counts.get(posKey)?.get(actKey) ?? 0;
}

/** 選んだ行動を記録する。`times` は既済ファイルの取り込み用 (通常は 1)。 */
export function recordSeen(index: SeenIndex, posKey: string, actKey: string, times = 1): void {
  let byAction = index.counts.get(posKey);
  if (byAction === undefined) {
    byAction = new Map();
    index.counts.set(posKey, byAction);
  }
  byAction.set(actKey, (byAction.get(actKey) ?? 0) + times);
}

/**
 * 1 出現ぶんの行 (追記専用フォーマット)。**改行は含まない** (付けるのは呼び出し側の責務)。
 * ワーカーが並列に append するので、read-modify-write が要らない「1 行 = 1 回」にする。
 */
export function formatSeenLine(posKey: string, actKey: string): string {
  return `${posKey} ${actKey}`;
}

/** 索引を圧縮した行列 (`posKey actKey count`)。再配布・スナップショット用。 */
export function serializeSeenIndex(index: SeenIndex): string[] {
  const out: string[] = [];
  for (const [posKey, byAction] of index.counts) {
    for (const [actKey, count] of byAction) out.push(`${posKey} ${actKey} ${count}`);
  }
  return out;
}

/**
 * 行列から索引を復元する。`posKey actKey [count]` の 2 形式を受ける
 * (count 省略 = 1 回 = 追記フォーマット)。空行・壊れた行は無視する
 * (数十時間かけた生成を 1 行の破損で失わないため)。
 */
export function parseSeenIndexLines(lines: Iterable<string>): SeenIndex {
  const index = createSeenIndex();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(" ");
    if (parts.length < 2) continue;
    const times = parts.length >= 3 ? Number(parts[2]) : 1;
    if (!Number.isFinite(times) || times <= 0) continue;
    recordSeen(index, parts[0], parts[1], times);
  }
  return index;
}

// ---------------------------------------------------------------------------
// 抽選
// ---------------------------------------------------------------------------

export interface DiversifyOptions {
  /** 最善からこの cp 以内の候補だけを対象にする (棋力を落とし過ぎないための帯)。負値・NaN は 0 に丸める。 */
  marginCp: number;
  /** スコア上位この件数までを対象にする (帯が広くても候補を絞る)。1 未満は 1 に丸める。 */
  topN: number;
}

/** 候補行動とその評価値。score は**手番側視点** (大きいほど手番側に良い)。 */
export interface ScoredAction {
  action: TurnAction;
  score: number;
}

/**
 * 「互角に近い候補のうち、これまで選んだ回数が最小の層」から一様抽選する。
 *
 * - 未出の手が 1 つでもあれば、必ずその中から選ばれる (count 0 が最小層になるため)
 * - 全部既出でも最小回数の層から選ぶので**候補が枯渇しない** (ハード ban との違い)
 * - 同じ rng (同 seed) なら結果は完全に再現する
 *
 * 契約:
 * - `rng` は `[0, 1)` を返すこと (1.0 を返す実装だと範囲外参照になる)
 * - `opts` の異常値は丸める (env 由来の NaN でバッチが落ちないように)
 * - 選んだ結果の**記録は行わない** (純粋関数のまま保つ)。呼び出し側が `recordSeen` すること
 * - 候補が空なら null を返す
 */
export function pickDiverseAction(
  candidates: readonly ScoredAction[],
  posKey: string,
  seen: SeenIndex,
  opts: DiversifyOptions,
  rng: () => number,
): TurnAction | null {
  if (candidates.length === 0) return null;

  let best = -Infinity;
  for (const c of candidates) if (c.score > best) best = c.score;

  // env 由来の NaN / 負値でバッチ全体が落ちないよう丸める (marginCp=0 は「最善と同値のみ」)。
  const margin = Number.isFinite(opts.marginCp) ? Math.max(0, opts.marginCp) : 0;
  const topN = Number.isFinite(opts.topN) ? Math.max(1, Math.floor(opts.topN)) : 1;

  // 最善から margin 以内 → スコア降順 → 上位 topN。
  // filter が新配列を返すので sort は呼び出し側の候補順 (探索が決めた順序) を壊さない。
  // sort は ES2019 以降**安定**なので、同値スコアのときは探索順が保たれ再現性も崩れない。
  const eligible = candidates
    .filter((c) => c.score >= best - margin)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  let minCount = Infinity;
  const counts = eligible.map((c) => {
    const n = getSeenCount(seen, posKey, actionKey(c.action));
    if (n < minCount) minCount = n;
    return n;
  });
  const tier = eligible.filter((_, i) => counts[i] === minCount);

  return tier[Math.floor(rng() * tier.length)].action;
}
