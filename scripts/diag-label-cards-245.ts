// Issue #245 教材多様化 段2: 「ラベル探索の root カード展開」の効果と安全性を実測する診断。
//
// 段2 は**ラベルがカードの種類を区別できるようにする**ための変更で、失敗しても例外は出ず
// 「ラベルが静かに変わらないだけ」なので、専用の物差しが要る。計画書 §4 段2 の検証 5 項目を出す:
//
//   ① バイト一致  : カードアクション 0 件の局面で move-only と完全一致すること (1 件でも違えば異常)
//   ② 速度        : ms/局面・到達深さを両方式で比較 (2.5 倍超なら設計見直し)
//   ③ 手番別の差  : delta = withCards - moveOnly を手番別に n/平均/中央値/p90/delta≠0 率で集計。
//                   root は手番側しかカードを展開しないので、先手番は +・後手番は − へ系統的に振れる。
//                   **手番別の中央値 |delta| が 50cp を超えたらユーザー判断へ上げる** (計画書 §4 段2)
//   ④ 符号規約    : カードは root の**追加選択肢**なので、手番側視点でラベルは原則下がらない。
//                   下がったら符号反転か探索の異常を疑う (#235 で繰り返しバグった最危険領域)。
//                   ※カード部分木が killer/history/TT を汚すため move 側も動きうる = 即バグ断定でなく要調査。
//                   同時にカード枝が値を更新した件数と更新幅を出す (0 なら段2 は無効。①②③では検知できない)
//   ⑤ 一致率      : 同一盤面・別手札グループのラベル一致率を before(move-only)/after(withCards) で比較。
//                   §6 の達成ゲート。絶対値ではなく同一スクリプト・同一キーの before/after で判定する
//
// ★①②④ (④' の残差・カード更新 0 件を含む) に反したら**終了コード 1** で落ちる。
//   目視前提だと見落とすうえ、段2 のバグは「エラーも出ず値が静かに変わらないだけ」で現れる。
//
// 使い方 (リポジトリルートで、深さを変えて複数回まわすこと):
//   DIAG_IN=local-data/training/snap-selfplay.jsonl DIAG_DEPTH=4 DIAG_MODE=groups \
//     npx tsx scripts/diag-label-cards-245.ts
//
// env:
//   DIAG_IN            入力対局 JSONL (カンマ区切り可)
//   DIAG_DEPTH         探索深さ (既定 5 = 本番レシピ。速く回したいときは 3〜4)
//   DIAG_TIME_MS       1 局面あたりの時間上限 (既定 600000)
//   DIAG_MODE          "positions" (既定) = 先頭から順に局面を取る / "groups" = ⑤ 用に
//                      「同一盤面・別手札」のグループを作って取る
//   DIAG_MAX_POSITIONS positions モードで採点する局面数 (既定 30)
//   DIAG_STRIDE        positions モードの間引き幅 (既定 = 教材全体を等間隔で舐める幅)。
//                      教材は 1 行 = 1 試合で 1 試合に数十〜200 局面あるため、先頭から連番で
//                      取ると**1 試合の序盤しか見ない**。飛ばして試合と手数を横断させる
//   DIAG_GROUPS        groups モードで使うグループ数 (既定 20)
//   DIAG_GROUP_MEMBERS 1 グループから取る局面数の上限 (既定 3)
//   ★入力は読み取り専用。ファイルは一切書かない。

import { readFileSync } from "node:fs";

import {
  evaluatePositionWorldMoveOnly,
  evaluatePositionWorldWithCards,
  getLabelCardActions,
} from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { deserializeGameState } from "@/lib/shogi/board";
import { deserializeCardState } from "@/lib/shogi/cards/state";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";
import type { TrainingSampleData } from "@/lib/shogi/training/types";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { GameState, Player } from "@/lib/shogi/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

const IN = (process.env.DIAG_IN ?? "local-data/training/snap-selfplay.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEPTH = Number(process.env.DIAG_DEPTH ?? "5");
const TIME_MS = Number(process.env.DIAG_TIME_MS ?? "600000");
const MODE = process.env.DIAG_MODE ?? "positions";
const MAX_POSITIONS = Number(process.env.DIAG_MAX_POSITIONS ?? "30");
const STRIDE_ENV = process.env.DIAG_STRIDE;
const GROUPS = Number(process.env.DIAG_GROUPS ?? "20");
const GROUP_MEMBERS = Number(process.env.DIAG_GROUP_MEMBERS ?? "3");
// ③ の escalation 閾値 (計画書 §4 段2)。既存のテンポ項 ±15cp・futility margin 300/500cp・
// ラベルが tanh(·/1000) であることから、50cp ≒ ラベル空間 0.025 = 許容できる帯。
const SIDE_BIAS_ESCALATION_CP = 50;
// ② の許容減速 (move-only 比)。当初 2.0 は実装前の見込み値だったが、実測でカード枝の探索窓を
// 絞ると「カードが効く局面の 4/7 しか拾えない」と分かり、full-window (×2.21) を採ることにした。
// 深さ5 で全教材を採点しても 8 並列で 2 日弱 = 計画 §5 のラベル予算に収まる (計画書 §4 段2)。
const MAX_SLOWDOWN = 2.5;
// 「カード更新 0 件」を失敗と断じるのに要する母集団の下限。これ未満は正しい実装でも 0 件になりうる。
const MIN_CARD_ROWS_FOR_GATE = 10;

if (!Number.isInteger(DEPTH) || DEPTH < 1) {
  throw new Error(`DIAG_DEPTH は 1 以上の整数で指定してください (受け取った値: ${process.env.DIAG_DEPTH})`);
}
if (MODE !== "positions" && MODE !== "groups") {
  throw new Error(`DIAG_MODE は "positions" か "groups" で指定してください (受け取った値: ${MODE})`);
}

// 学習用 boardState は moveHistory / positionHistory を除外しているので空配列で補う
// (label-search-score-245.ts と同じ復元。局面を独立採点するので履歴は要らない)。
function reconstructState(boardState: unknown): GameState {
  return deserializeGameState({
    ...(boardState as Record<string, unknown>),
    moveHistory: [],
    positionHistory: [],
  });
}

// ★キーは**生の JSON から**作る。グループ探索は教材の全局面 (数万件) を走査するので、
//   ここで GameState / CardGameState へ復元すると時間もメモリも桁違いに膨らむ。
//   復元は「実際に採点する局面」だけに絞る。
interface RawCardState {
  hand: Record<Player, { defId: string }[]>;
  mana: Record<Player, number>;
}

/** 手札の中身 (defId 別枚数)。instanceId や並び順は無視する = 学習上「同じ手札」の定義。 */
function handKeyOf(cs: RawCardState, player: Player): string {
  const counts = new Map<string, number>();
  for (const c of cs.hand[player] ?? []) counts.set(c.defId, (counts.get(c.defId) ?? 0) + 1);
  return [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, n]) => `${d}:${n}`).join(",");
}

/** 盤面の同一性 (盤 + 持駒 + 手番)。カード状態は含めない。 */
function boardKey(sample: TrainingSampleData): string {
  const b = sample.boardState as { board: unknown; hand: unknown; currentPlayer: unknown };
  return JSON.stringify({ board: b.board, hand: b.hand, currentPlayer: b.currentPlayer });
}

interface Position {
  state: GameState;
  cardState: CardGameState;
  sideToMove: Player;
  boardKey: string;
  /** ⑤ 用: 手番側 / 非手番側の手札キー。 */
  ownHandKey: string;
  oppHandKey: string;
  mana: string;
  groupId?: number;
}

function loadSamples(): TrainingSampleData[] {
  const out: TrainingSampleData[] = [];
  for (const file of IN) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.warn(`[diag] 入力が読めません (skip): ${file}`);
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        out.push(...parseTrainingRecordLine(line).samples);
      } catch {
        // 壊れた行は無視 (診断なので中断しない)
      }
    }
  }
  return out;
}

/** 生サンプル → 採点用の Position (復元を伴うのでここが重い。採点する局面だけに使う)。 */
function toPosition(sample: TrainingSampleData, meta?: Omit<Position, "state" | "cardState">): Position {
  const state = reconstructState(sample.boardState);
  const cardState = deserializeCardState(sample.cardState);
  if (meta !== undefined) return { ...meta, state, cardState };
  const side = state.currentPlayer;
  const opp: Player = side === "sente" ? "gote" : "sente";
  const raw = sample.cardState as unknown as RawCardState;
  return {
    state,
    cardState,
    sideToMove: side,
    boardKey: boardKey(sample),
    ownHandKey: handKeyOf(raw, side),
    oppHandKey: handKeyOf(raw, opp),
    mana: `${raw.mana.sente}/${raw.mana.gote}`,
  };
}

/** ⑤ 用: 「盤面が同じで手札の中身が違う」グループを作る (キーは生 JSON から = 復元しない)。 */
function selectGroups(samples: TrainingSampleData[]): { positions: Position[]; ceiling: string } {
  interface Light {
    sample: TrainingSampleData;
    meta: Omit<Position, "state" | "cardState">;
  }
  const byBoard = new Map<string, Light[]>();
  for (const s of samples) {
    const raw = s.cardState as unknown as RawCardState;
    if (!raw?.hand || !raw?.mana) continue;
    const side = s.sideToMove;
    const opp: Player = side === "sente" ? "gote" : "sente";
    const meta = {
      sideToMove: side,
      boardKey: boardKey(s),
      ownHandKey: handKeyOf(raw, side),
      oppHandKey: handKeyOf(raw, opp),
      mana: `${raw.mana.sente}/${raw.mana.gote}`,
    };
    const arr = byBoard.get(meta.boardKey);
    if (arr === undefined) byBoard.set(meta.boardKey, [{ sample: s, meta }]);
    else arr.push({ sample: s, meta });
  }

  let ownDiff = 0; // 手番側の手札が違うグループ (段2 で動きうる)
  let oppOnlyDiff = 0; // 非手番側の手札だけが違うグループ (段2 では原理的に動かない = 構造的上限)
  const picked: Position[] = [];
  let groupId = 0;
  for (const [, members] of byBoard) {
    const handKeys = new Set(members.map((m) => `${m.meta.ownHandKey}|${m.meta.oppHandKey}`));
    if (handKeys.size < 2) continue;
    const ownKeys = new Set(members.map((m) => m.meta.ownHandKey));
    if (ownKeys.size >= 2) ownDiff += 1;
    else oppOnlyDiff += 1;

    if (groupId >= GROUPS || ownKeys.size < 2) continue;
    // 手番側の手札が違う代表を最大 GROUP_MEMBERS 件まで取る (同一手札の重複は取らない)。
    const seen = new Set<string>();
    for (const m of members) {
      if (seen.has(m.meta.ownHandKey)) continue;
      seen.add(m.meta.ownHandKey);
      picked.push(toPosition(m.sample, { ...m.meta, groupId }));
      if (seen.size >= GROUP_MEMBERS) break;
    }
    groupId += 1;
  }

  const total = ownDiff + oppOnlyDiff;
  const ceiling =
    total > 0
      ? `手札が違うグループ ${total} 件中 ${oppOnlyDiff} 件 (${((oppOnlyDiff / total) * 100).toFixed(1)}%) は` +
        `**非手番側の手札だけ**が違う = root 片側展開では原理的に割れない (段2 の構造的上限)`
      : "手札が違うグループが見つかりませんでした";
  return { positions: picked, ceiling };
}

interface Scored {
  pos: Position;
  moveOnly: number;
  withCards: number;
  cardActions: number;
  msMoveOnly: number;
  msWithCards: number;
  depthMoveOnly: number;
  depthWithCards: number;
}

// 計測順を局面ごとに入れ替える。同一プロセス内で常に move-only → withCards の順に測ると、
// JIT ウォームアップと GC の効果が後発の withCards に有利に働き、倍率が実際より小さく出る。
function score(pos: Position, withCardsFirst: boolean): Scored | null {
  const ctxA = createSearchContext({ timeLimitMs: TIME_MS, useLearnedEval: false });
  const ctxB = createSearchContext({ timeLimitMs: TIME_MS, useLearnedEval: false });
  let moveOnly: number | null;
  let withCards: number | null;
  let msMoveOnly: number;
  let msWithCards: number;
  if (withCardsFirst) {
    const t0 = performance.now();
    withCards = evaluatePositionWorldWithCards(pos.state, pos.cardState, DEPTH, CARD_SHOGI_VARIANT, ctxB);
    const t1 = performance.now();
    moveOnly = evaluatePositionWorldMoveOnly(pos.state, pos.cardState, DEPTH, CARD_SHOGI_VARIANT, ctxA);
    msWithCards = t1 - t0;
    msMoveOnly = performance.now() - t1;
  } else {
    const t0 = performance.now();
    moveOnly = evaluatePositionWorldMoveOnly(pos.state, pos.cardState, DEPTH, CARD_SHOGI_VARIANT, ctxA);
    const t1 = performance.now();
    withCards = evaluatePositionWorldWithCards(pos.state, pos.cardState, DEPTH, CARD_SHOGI_VARIANT, ctxB);
    msMoveOnly = t1 - t0;
    msWithCards = performance.now() - t1;
  }
  if (moveOnly === null || withCards === null) return null; // 採点不能は診断対象外

  // ★母集団を本体と揃えるため、本体と同じ getLabelCardActions を使う (終局ガード込み)。
  const world = { gameState: pos.state, cardState: pos.cardState, doubleMove: null };
  const cardActions = getLabelCardActions(world, CARD_SHOGI_VARIANT).length;

  return {
    pos, moveOnly, withCards, cardActions, msMoveOnly, msWithCards,
    depthMoveOnly: ctxA.depthCompleted, depthWithCards: ctxB.depthCompleted,
  };
}

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// 線形補間つき分位点。偶数長で上側の値に張り付くと、値の半分が 0 の小標本で
// 「中央値 = 最小の非ゼロ」に化けて escalation 判定を誤らせる (実際に踏んだ)。
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : String(n));

/** ⑤ グループ内でラベルが全員一致している割合。 */
function agreementRate(rows: Scored[], pick: (r: Scored) => number): { groups: number; agreed: number } {
  const byGroup = new Map<number, number[]>();
  for (const r of rows) {
    if (r.pos.groupId === undefined) continue;
    const arr = byGroup.get(r.pos.groupId);
    if (arr === undefined) byGroup.set(r.pos.groupId, [pick(r)]);
    else arr.push(pick(r));
  }
  let agreed = 0;
  let groups = 0;
  for (const [, labels] of byGroup) {
    if (labels.length < 2) continue;
    groups += 1;
    if (labels.every((l) => l === labels[0])) agreed += 1;
  }
  return { groups, agreed };
}

function main() {
  const samples = loadSamples();
  if (samples.length === 0) {
    console.error("採点できる局面がありません (DIAG_IN を確認してください)");
    process.exit(1);
  }

  let positions: Position[];
  let ceiling = "";
  if (MODE === "groups") {
    const sel = selectGroups(samples);
    positions = sel.positions;
    ceiling = sel.ceiling;
    if (positions.length === 0) {
      console.error("同一盤面・別手札のグループが見つかりませんでした (positions モードを試してください)");
      process.exit(1);
    }
  } else {
    // ★間引いて拾う。先頭から連番だと 1 試合の序盤だけを見ることになり、
    //   「深さ依存・局面依存で出る欠陥」を構造的に取りこぼす (#235 の小サンプル誤判断と同型)。
    // 既定は「教材全体を MAX_POSITIONS 点で等間隔に舐める」幅。固定値だと先頭の数十試合しか
    // 触らず、試合の偏りが残る (段2 の 120.3cp 取りこぼしは偏った母集団では見えなかった)。
    const stride = STRIDE_ENV !== undefined
      ? Math.max(1, Number(STRIDE_ENV))
      : Math.max(1, Math.floor(samples.length / Math.max(1, MAX_POSITIONS)));
    const picked: TrainingSampleData[] = [];
    for (let i = 0; i < samples.length && picked.length < MAX_POSITIONS; i += stride) {
      picked.push(samples[i]);
    }
    positions = picked.map((s) => toPosition(s));
  }

  console.log(
    `=== 段2 診断 (深さ${DEPTH} / ${MODE} モード / ${positions.length} 局面 / 入力 ${samples.length} 局面) ===\n`,
  );

  // ウォームアップ (JIT の立ち上がりを ② の倍率へ混ぜない)。結果は捨てる。
  score(positions[0], false);

  const rows: Scored[] = [];
  for (let i = 0; i < positions.length; i++) {
    const r = score(positions[i], i % 2 === 1); // 計測順を交互に入れ替える
    if (r !== null) rows.push(r);
    if ((i + 1) % 5 === 0 || i === positions.length - 1) {
      console.log(`  採点 ${i + 1}/${positions.length} ...`);
    }
  }
  if (rows.length === 0) {
    console.error("全局面が採点不能でした");
    process.exit(1);
  }
  let failed = false; // ①②④ のいずれかに反したら終了コード 1

  // ① バイト一致 (カードアクション 0 件)
  const noCard = rows.filter((r) => r.cardActions === 0);
  const noCardMismatch = noCard.filter((r) => r.withCards !== r.moveOnly);
  if (noCardMismatch.length > 0) failed = true;
  console.log("\n① カードが 1 件も無い局面のバイト一致");
  console.log(`   対象 ${noCard.length} 局面 / 不一致 ${noCardMismatch.length} 件 ` +
    `${noCardMismatch.length === 0 ? "✅" : "❌ 異常 (カードと無関係な局面のラベルが動いている)"}`);

  // ② 速度
  const msA = mean(rows.map((r) => r.msMoveOnly));
  const msB = mean(rows.map((r) => r.msWithCards));
  const ratio = msA > 0 ? msB / msA : 0;
  if (ratio > MAX_SLOWDOWN) failed = true;
  console.log("\n② 速度と到達深さ");
  console.log(`   move-only : ${fmt(msA)} ms/局面, 到達深さ平均 ${fmt(mean(rows.map((r) => r.depthMoveOnly)))}`);
  console.log(`   withCards : ${fmt(msB)} ms/局面, 到達深さ平均 ${fmt(mean(rows.map((r) => r.depthWithCards)))}`);
  console.log(`   倍率 ×${ratio.toFixed(2)} ${ratio <= MAX_SLOWDOWN ? `✅ (${MAX_SLOWDOWN} 倍以内)` : `❌ ${MAX_SLOWDOWN} 倍超 = 設計見直し`}`);
  console.log(`   root のカードアクション数: 平均 ${fmt(mean(rows.map((r) => r.cardActions)))} / 最大 ${Math.max(...rows.map((r) => r.cardActions))}`);

  // ③ 手番別のラベル差
  console.log("\n③ 手番別のラベル差 (delta = withCards − moveOnly、先手絶対視点 cp)");
  for (const [label, subset] of [
    ["全局面", rows],
    ["カードが 1 件以上ある局面", rows.filter((r) => r.cardActions > 0)],
  ] as const) {
    console.log(`   [${label}]`);
    for (const side of ["sente", "gote"] as const) {
      const d = subset.filter((r) => r.pos.sideToMove === side).map((r) => r.withCards - r.moveOnly);
      if (d.length === 0) { console.log(`     ${side}: 対象なし`); continue; }
      const absMedian = quantile(d.map(Math.abs), 0.5);
      const changed = d.filter((x) => x !== 0).length;
      console.log(
        `     ${side}: n=${d.length} 平均 ${fmt(mean(d))} / 中央値 ${fmt(quantile(d, 0.5))} / ` +
          `|delta| 中央値 ${fmt(absMedian)} / p90 ${fmt(quantile(d.map(Math.abs), 0.9))} / 変化 ${changed} 件 ` +
          `(${((changed / d.length) * 100).toFixed(1)}%)` +
          `${absMedian > SIDE_BIAS_ESCALATION_CP ? `  ★|delta| 中央値が ${SIDE_BIAS_ESCALATION_CP}cp 超 = ユーザー判断へ` : ""}`,
      );
    }
  }

  // ④ 符号規約: カードは root の追加選択肢なので、手番側視点でラベルは下がりえない。
  console.log("\n④ 符号規約 (カードは追加選択肢 = 手番側視点で下がることはありえない)");
  const violations = rows.filter((r) => {
    const sign = r.pos.sideToMove === "sente" ? 1 : -1;
    return (r.withCards - r.moveOnly) * sign < 0;
  });
  if (violations.length > 0) failed = true;
  console.log(
    `   符号違反 ${violations.length} / ${rows.length} 件 ` +
      `${violations.length === 0 ? "✅" : "❌ 探索または符号反転の実装バグ"}`,
  );
  for (const v of violations.slice(0, 5)) {
    console.log(`     side=${v.pos.sideToMove} moveOnly=${fmt(v.moveOnly)} withCards=${fmt(v.withCards)} cards=${v.cardActions}`);
  }

  // カード枝が実際にラベルを動かした件数 (0 なら段2 は無効)
  const withCardRows = rows.filter((r) => r.cardActions > 0);
  const moved = withCardRows.filter((r) => r.withCards !== r.moveOnly);
  const gains = moved.map((r) => Math.abs(r.withCards - r.moveOnly));
  console.log(
    `   カード枝がラベルを更新: ${moved.length} / ${withCardRows.length} 局面 ` +
      `(${withCardRows.length > 0 ? ((moved.length / withCardRows.length) * 100).toFixed(1) : "0.0"}%)` +
      `${gains.length > 0 ? ` / 更新幅 中央値 ${fmt(quantile(gains, 0.5))}cp・p90 ${fmt(quantile(gains, 0.9))}cp・最大 ${fmt(Math.max(...gains))}cp` : ""}`,
  );
  // ★これがゲートに無いと、1 巡目に見つかった「カードの価値が丸ごと消える」バグを
  //   診断が ✅ で通してしまう (①④ は「等しいだけ」なら合格してしまうため)。
  //   ただしサンプルが少ないと正しい実装でも 0 件になりうるので、母集団が十分なときだけ落とす。
  if (withCardRows.length >= MIN_CARD_ROWS_FOR_GATE && moved.length === 0) {
    failed = true;
    console.error("   ❌ 1 件も更新されていません = 段2 が効いていない (カードの価値がラベルへ入っていない)");
  } else if (moved.length === 0) {
    console.warn(`   ⚠ 更新 0 件だがカード枝のある局面が ${withCardRows.length} 件しかない = 判定にはサンプル不足`);
  }
  // ★母集団を本体と同じ getLabelCardActions で決めているので、その関数が壊れて常に空を返すと
  //   ①④ も更新ゲートもすべて素通りする (循環)。カード枝が 1 件も無い教材はありえないので落とす。
  if (withCardRows.length === 0) {
    failed = true;
    console.error("   ❌ カード枝のある局面が 1 件もありません = 母集団の生成 (getLabelCardActions) を疑う");
  }

  // ⑤ 一致率の before/after
  if (MODE === "groups") {
    console.log("\n⑤ 同一盤面・別手札グループのラベル一致率 (低いほどカードを区別できている)");
    for (const [name, key] of [
      ["盤面+持駒+手番+マナ", (r: Scored) => `${r.pos.boardKey}|${r.pos.mana}`],
      ["マナ無視", (r: Scored) => r.pos.boardKey],
    ] as const) {
      // キーが違うグループは別扱いにするため groupId を key ごとに振り直す。
      const idOf = new Map<string, number>();
      const remapped = rows.map((r) => {
        const k = key(r);
        if (!idOf.has(k)) idOf.set(k, idOf.size);
        return { ...r, pos: { ...r.pos, groupId: idOf.get(k)! } };
      });
      const before = agreementRate(remapped, (r) => r.moveOnly);
      const after = agreementRate(remapped, (r) => r.withCards);
      const pct = (a: { groups: number; agreed: number }) =>
        a.groups > 0 ? ((a.agreed / a.groups) * 100).toFixed(1) : "—";
      console.log(
        `   [${name}] ${before.groups} グループ: before(move-only) ${pct(before)}% → after(withCards) ${pct(after)}%` +
          `${after.agreed < before.agreed ? "  ✅ 下がった" : "  ⚠ 下がっていない"}`,
      );
    }
    console.log(`\n   構造的上限: ${ceiling}`);
  }

  console.log("");
  if (failed) {
    console.error("✗ ①②④ のいずれかに反しました (上記の ❌ を確認してください)");
    process.exit(1);
  }
}

main();
