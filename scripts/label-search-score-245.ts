// Issue #245 Stage 2 P2-0: search-score ラベル生成 (Pass 1)。
// 設計: docs/plans/issue-245-stage2-learned-eval-design.md §3.1 / §6 P2-0。
//
// 収集済み対局 JSONL の各サンプル局面を World 探索 (findBestMoveWorld) で深さ D まで読み、
// **move-only backed-up score (先手絶対視点 cp)** を searchScore として各サンプルへ付与した
// 「拡張対局 JSONL」を書き出す。α 混合 + tanh squash は encode 段 (encode-training-245.ts、
// 安価・α 再校正で再実行可) が行う。本 Pass は α 非依存ゆえ 1 度だけ走らせてキャッシュする。
//
// ★iteration-0 のラベルは **move-only** (rootMoveScores の max)。理由:
//  - Stage 1 で判明した真因 = 盤面評価 pieceSafety の 1 手先しか見ない浅さ。move-only の深読み
//    (D≥4) が「飛車が深入りして捕まる」を解決し、その backed-up 値が過大評価を排除する (本丸)。
//  - draw を採点に含めない = 山札順序 (encoder 非符号化の隠れ状態) への label 依存を断つ (M1 MAJOR)。
//  - カード価値は leaf cardDigest (手札がリーフ評価に効く) + encoder 特徴で label に残る。
//  - card 行動を探索木で展開して採点するのは Stage 2 で評価が改善されてから (§4.4 deep-node と対)。
//
// ★重い (局面数 × D 探索)。smoke で 1 局あたりの所要を実測し D を 4↔5 で確定する (§8)。
//
// 使い方 (リポジトリルートで):
//   LABEL_IN=local-data/training/human-245.jsonl LABEL_OUT=local-data/training/labeled-human-D4.jsonl \
//     LABEL_DEPTH=4 LABEL_MAX_GAMES=1 npx tsx scripts/label-search-score-245.ts
//
// env:
//   LABEL_IN        入力対局 JSONL (カンマ区切りで複数可、既定 local-data/training/human-245.jsonl)
//   LABEL_OUT       出力拡張 JSONL (既定 local-data/training/labeled-245.jsonl)
//   LABEL_DEPTH     探索深さ D (既定 4)。1 以上の整数のみ。★不正値は起動時に停止する
//                   (NaN は JSON 往復で null に化けてレシピ識別が壊れ、0 は全局面が採点不能になるため)
//   LABEL_TIME_MS   1 局面あたりの安全網時間上限 (既定 600000 = 探索が D で完了し切れる十分大)
//   LABEL_EXPAND_CARDS  "1" (既定) = ラベル探索の root で playCard を展開する (教材多様化 段2 の本命)。
//                   "0" = move-only の A/B 対照。それ以外の値は起動時に停止する。
//                   ★draw は恒久的に展開しない (山札順への依存を断つ)
//   LABEL_MAX_GAMES 処理する試合数の上限 (全入力横断・shard 適用前に先頭から切出。既定 = 全件)
//   LABEL_SHARD_COUNT / LABEL_SHARD_INDEX  並列分散 (8 コア活用)。COUNT 分割の INDEX 番目の試合のみ
//     処理する (試合 i を i%COUNT===INDEX のシャードが担当)。既定 1/0 = 分散なし。各シャードは別 OUT
//     を指定し、完了後に concat する (シェルの起動側が担う)。production 非依存のデータ準備スクリプト。
//   LABEL_RESUME    "1" で再開モード (既定 "0" = 従来どおり OUT を作り直す)。
//     ★D=5 は 1 局に数十分かかりうる長時間バッチのため、途中停止 (kill / マシン再起動) から
//     「済んだ試合を採点し直さずに続ける」手段が必要。OUT を truncate せず追記し、既に OUT に
//     入っている試合をスキップする。突合は **searchScore を除いた行の正規形 (内容キー)** で行うので、
//     行番号や shard 設定に依存しない (= 入力順序が変わっても既済判定が壊れない)。
//     同一内容の試合が入力に複数ある場合も多重集合で数を合わせるため取りこぼさない。
//     途中 kill で最終行が途切れている場合はその行を破棄してから再開する (壊れた行の再利用防止)。
//     OUT 全行を parse するので巨大 OUT (数百 MB) では起動が数秒〜数十秒重くなる。再開時のみ有効化する。
//   LABEL_DONE_KEYS 既済試合の識別ハッシュ一覧ファイル (1 行 1 ハッシュ)。ここに載る試合は
//     採点せずスキップする。★用途: 複数ワーカーが**別々の OUT** に書きながら「全体で何が済んだか」を
//     共有するため。OUT 全行の parse (数百 MB) を避けられるので起動が軽い。
//     生成は scripts/label-done-keys-245.ts。
//   LABEL_CLAIM_DIR 先着で 1 試合ずつ確保する「取り合い方式」を有効化する (指定時のみ)。
//     ★背景: shard 分割 (i%COUNT) は対局の重さ (27局面40秒 〜 232局面2時間超) を考慮しないため
//     偏りが出て、遅いシャードが律速する一方で速いシャードのコアが遊ぶ。取り合い方式なら
//     空いたワーカーが次の未着手試合を取るので自然に均される。
//     実装: 試合を処理する前に <CLAIM_DIR>/<hash>.claim を O_EXCL で作成し、既存なら他ワーカーが
//     担当中とみなして skip する (ファイル作成の排他性が唯一の同期点 = ロック機構不要)。
//     ワーカーが途中で死ぬと claim が残り、その試合が誰にも処理されない穴になりうる。
//     → 全ワーカー終了後に CLAIM_DIR を外した「取りこぼし検査パス」を 1 本流すこと (ランチャの責務)。
//   ★winner=null (中断) の試合は採点せず除外する (encode 段でも除外され学習に使われないため、
//     高コストな探索を無駄打ちしない)。
//
// ★ラベル生成レシピ (教材多様化 段1)
//   探索深さや root のカード展開が違えば searchScore は**別物**なので、新旧が 1 ファイルに混ざると
//   学習が静かに壊れる。本バッチは出力する試合メタへ labelMeta (= レシピ) を刻み、
//   (a) 再開時に OUT が別レシピなら起動時に停止 / (b) 既済ハッシュ・claim にレシピを混ぜて
//   旧レシピの成果を既済扱いしない、の二段で混在を防ぐ。encode 段が最後の関門になる。
//   ワーカー出力の結合は scripts/merge-labeled-245.ts を使うこと (同一性キーの実装を一元化するため。
//   結合側で独自に重複判定を書くと labelMeta を含めてしまい、同一局の新旧が両方残る)。
//
// ★終了コード
//   0 = 正常。1 = **ラベル品質の警告**(深さ D 未達 / 採点不能が発生した) であって、クラッシュではない。
//   採点結果は OUT に書き込み済みなので破棄しないこと。再実行するときは必ず LABEL_RESUME=1 を付ける
//   (付けないと OUT を作り直すため、そのワーカーの成果が消える)。
//   起動時の設定エラー (env 不正 / OUT のレシピ不一致) は例外で落ちるので、OUT には何も書かれない。

import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  evaluatePositionWorldMoveOnly,
  evaluatePositionWorldWithCards,
} from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { deserializeGameState } from "@/lib/shogi/board";
import { deserializeCardState } from "@/lib/shogi/cards/state";
import { parseTrainingRecordLine, trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import type { LabelMeta, TrainingGameRecord } from "@/lib/shogi/training/types";
import type { GameState } from "@/lib/shogi/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import {
  CURRENT_LABEL_RECIPE_VERSION,
  labelIdentityKey,
  labelKeyHash,
  recipeKey,
} from "./utils/label-identity";

const IN = (process.env.LABEL_IN ?? "local-data/training/human-245.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.LABEL_OUT ?? "local-data/training/labeled-245.jsonl";
const DEPTH = Number(process.env.LABEL_DEPTH ?? "4");
const TIME_MS = Number(process.env.LABEL_TIME_MS ?? "600000");
// env の取り違え (typo / 未定義変数の展開) を起動時に止める。放置すると
// NaN → JSON 往復で null に化けてレシピ識別が往復不安定になり、自分が書いた OUT を
// 「別レシピ」と誤認して停止する。0 や負なら全局面が採点不能 (null) になる。
if (!Number.isInteger(DEPTH) || DEPTH < 1) {
  throw new Error(`LABEL_DEPTH は 1 以上の整数で指定してください (受け取った値: ${process.env.LABEL_DEPTH})`);
}
if (!Number.isFinite(TIME_MS) || TIME_MS <= 0) {
  throw new Error(`LABEL_TIME_MS は正の数で指定してください (受け取った値: ${process.env.LABEL_TIME_MS})`);
}
// 教材多様化 段2: root で playCard を展開するか。既定 "1" (= 段2 の本命)。
// "0" は move-only の A/B 対照。曖昧な値はレシピを取り違えたまま数時間走るので起動時に止める。
const EXPAND_CARDS_RAW = process.env.LABEL_EXPAND_CARDS ?? "1";
if (EXPAND_CARDS_RAW !== "0" && EXPAND_CARDS_RAW !== "1") {
  throw new Error(`LABEL_EXPAND_CARDS は "0" か "1" で指定してください (受け取った値: ${EXPAND_CARDS_RAW})`);
}
const EXPAND_CARDS = EXPAND_CARDS_RAW === "1";
const MAX_GAMES = Number(process.env.LABEL_MAX_GAMES ?? String(Number.MAX_SAFE_INTEGER));
const SHARD_COUNT = Math.max(1, Number(process.env.LABEL_SHARD_COUNT ?? "1"));
const SHARD_INDEX = Math.max(0, Number(process.env.LABEL_SHARD_INDEX ?? "0"));
const RESUME = (process.env.LABEL_RESUME ?? "0") === "1";
const DONE_KEYS_FILE = process.env.LABEL_DONE_KEYS ?? "";
const CLAIM_DIR = process.env.LABEL_CLAIM_DIR ?? "";

// 今回の実行が生成するラベルのレシピ。出力へ刻み、既済判定のハッシュにも混ぜる。
// ★depth は「要求値」であって「到達値」ではない。到達値は ctx.depthCompleted で実測し
//   shallow カウンタとして別途監視する (深さ D 未達の浅いラベルを沈黙させないため)。
const RECIPE: LabelMeta = {
  version: CURRENT_LABEL_RECIPE_VERSION,
  depth: DEPTH,
  expandCards: EXPAND_CARDS,
  // draw は恒久的に展開しない (deck 先頭を引くので、山札順 = encoder が符号化しない隠れ状態が
  // ラベルへ漏れて純ノイズになる)。計画書 §2 B-2。
  expandDraw: false,
};
const RECIPE_KEY = recipeKey(RECIPE);

// 学習用 boardState は moveHistory / positionHistory を除外している (serializeBoardForTraining)。
// 探索は両者を参照しうる (千日手検出等) ため空配列で補って GameState を復元する。局面を独立採点
// するゆえ履歴空でも採点の妥当性は保たれる (千日手は発火しないだけ)。
function reconstructState(boardState: unknown): GameState {
  return deserializeGameState({
    ...(boardState as Record<string, unknown>),
    moveHistory: [],
    positionHistory: [],
  });
}

// 既存 OUT を読み、既済試合の内容キー多重集合 (キー -> 残件数) を返す。
// 途中 kill で最終行が JSON 途切れになっている場合はその行以降を破棄して OUT を書き戻す。
//
// ★別レシピの行が 1 つでもあれば起動時に停止する (教材多様化 段1)。ここに追記すると
// 「深さ4 のラベルと深さ5 のラベルが同じファイルに同居する」状態が生まれ、下流の学習が静かに壊れる。
// 別レシピで採点し直したいときは LABEL_OUT に別ファイルを指定する (旧成果は残す)。
function loadCompletedKeys(): Map<string, number> {
  const done = new Map<string, number>();
  let raw: string;
  try {
    raw = readFileSync(OUT, "utf8");
  } catch {
    return done; // OUT 未作成 = 既済ゼロ (初回相当)
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const kept: string[] = [];
  const foreignRecipes = new Map<string, number>(); // 別レシピキー -> 行数
  for (const line of lines) {
    let record: TrainingGameRecord;
    try {
      record = parseTrainingRecordLine(line);
    } catch {
      // 不完全行 (kill で書き込み途中)。以降の行も信用できないので打ち切り、ここまでを残す。
      break;
    }
    const key = recipeKey(record.game.labelMeta);
    if (key !== RECIPE_KEY) {
      foreignRecipes.set(key, (foreignRecipes.get(key) ?? 0) + 1);
      kept.push(line);
      continue;
    }
    const contentKey = labelIdentityKey(record);
    done.set(contentKey, (done.get(contentKey) ?? 0) + 1);
    kept.push(line);
  }
  if (foreignRecipes.size > 0) {
    // 中断するので OUT には一切手を触れない (理解できないファイルを書き換えない)。
    const detail = [...foreignRecipes].map(([k, n]) => `${k}: ${n} 行`).join(" / ");
    throw new Error(
      `${OUT} には今回のレシピ (${RECIPE_KEY}) と違うラベルが含まれています [${detail}]。\n` +
        `  新旧のラベルが混ざると学習が静かに壊れます。LABEL_OUT に別ファイルを指定してください。`,
    );
  }
  if (kept.length !== lines.length) {
    writeFileSync(OUT, kept.length > 0 ? kept.join("\n") + "\n" : "");
    console.warn(
      `[label] 不完全な末尾 ${lines.length - kept.length} 行を破棄して再開します: ${OUT}`,
    );
  }
  return done;
}

// 他ワーカーの成果を含む「既済ハッシュ一覧」を読む (1 行 1 ハッシュ、# 始まりはコメント)。
// OUT 全行 (数百 MB) を parse せずに済むので、多ワーカー起動時のメモリ・時間を節約できる。
function loadDoneKeyHashes(): Set<string> {
  if (!DONE_KEYS_FILE) return new Set();
  const raw = readFileSync(DONE_KEYS_FILE, "utf8");
  return new Set(
    raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#")),
  );
}

// 取り合い方式の確保。O_EXCL でファイルを作れたワーカーだけがその試合を担当する。
// 作成済み (= 他ワーカーが担当中 or 担当済み) なら false を返して譲る。
function tryClaim(hash: string): boolean {
  if (!CLAIM_DIR) return true; // 取り合い無効時は常に自分が担当
  try {
    closeSync(openSync(join(CLAIM_DIR, `${hash}.claim`), "wx"));
    return true;
  } catch {
    return false;
  }
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  if (CLAIM_DIR) mkdirSync(CLAIM_DIR, { recursive: true });
  // 再開モードでは OUT を残して追記する。通常モードは Pass 1 が α 非依存ゆえ毎回作り直してよい。
  const completed = RESUME ? loadCompletedKeys() : new Map<string, number>();
  const doneHashes = loadDoneKeyHashes();
  if (!RESUME) writeFileSync(OUT, ""); // truncate

  // 全入力ファイルの行を結合 → MAX_GAMES で先頭から切出 (shard 適用前) → このシャード担当行のみ抽出。
  // 全シャードが同じ「先頭 MAX_GAMES 試合」の窓を見るよう、切出はシャード分割の前に行う。
  let allLines: string[] = [];
  for (const file of IN) {
    try {
      allLines.push(...readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0));
    } catch {
      console.warn(`[label-search-score-245] 入力が読めません (skip): ${file}`);
    }
  }
  if (Number.isFinite(MAX_GAMES)) allLines = allLines.slice(0, MAX_GAMES);
  const myLines = allLines.filter((_, i) => i % SHARD_COUNT === SHARD_INDEX);
  // ★レシピは起動時に出す。完了時だけだと、取り違えたまま数時間走り切ってから気づくことになる。
  console.log(
    `shard ${SHARD_INDEX}/${SHARD_COUNT}: 全 ${allLines.length} 試合中 ${myLines.length} 試合を担当 ` +
      `(recipe=${RECIPE_KEY} = 深さ${DEPTH}・カード展開${EXPAND_CARDS ? "あり" : "なし"})`,
  );

  let games = 0;
  let samples = 0;
  let skipped = 0; // winner=null (中断) で採点除外した試合
  let resumed = 0; // 既済としてスキップした試合 (自分の OUT / 既済ハッシュ一覧)
  let yielded = 0; // 取り合いで他ワーカーに譲った試合
  let nearTimeout = 0; // 時間上限に迫った局面 (= 時間切れが近かった疑い)
  let shallow = 0; // 深さ D に到達しなかった局面 (ctx.depthCompleted の実測)
  let unscored = 0; // 深さ1 すら完了せず採点不能 (searchScore=null) だった局面
  const startedAll = performance.now();

  for (const line of myLines) {
    const record = parseTrainingRecordLine(line);
    // winner=null (中断) は encode 段でも除外される → 高コストな探索を無駄打ちせず skip。
    if (record.game.winner == null) {
      skipped += 1;
      continue;
    }
    if (RESUME) {
      const key = labelIdentityKey(record);
      const left = completed.get(key) ?? 0;
      if (left > 0) {
        completed.set(key, left - 1); // 同一内容の試合が複数あっても件数分だけスキップする
        resumed += 1;
        continue;
      }
    }
    // 他ワーカーが別 OUT に採点済み。自分の OUT には無いので RESUME では拾えない。
    // ★ハッシュにレシピを混ぜるので、別レシピ (深さ違い等) の成果は既済扱いにならず再採点される。
    const hash = doneHashes.size > 0 || CLAIM_DIR ? labelKeyHash(record, RECIPE) : "";
    if (doneHashes.has(hash)) {
      resumed += 1;
      continue;
    }
    // 取り合い: 先に確保できたワーカーだけが採点する。
    if (!tryClaim(hash)) {
      yielded += 1;
      continue;
    }
    const gStart = performance.now();

    for (const sample of record.samples) {
      const state = reconstructState(sample.boardState);
      const cardState = deserializeCardState(sample.cardState);
      const ctx = createSearchContext({ timeLimitMs: TIME_MS, useLearnedEval: false });
      // backed-up 評価値 (先手絶対視点 cp)。終局/合法手なしでも negamaxWorld が確定値を
      // 返す (詰み ±MATE / ステールメイト 0) ため、時間切れ以外で null にはならない。
      const pStart = performance.now();
      const score = EXPAND_CARDS
        ? evaluatePositionWorldWithCards(state, cardState, DEPTH, CARD_SHOGI_VARIANT, ctx)
        : evaluatePositionWorldMoveOnly(state, cardState, DEPTH, CARD_SHOGI_VARIANT, ctx);
      // 時間上限に達すると反復深化が D 未満で打ち切られ、ラベルが静かに浅くなる。
      // 到達深さは ctx.depthCompleted で**実測**できるのでそれを主指標にし、
      // 経過時間の 90% 超過 (= 上限に迫った) は補助指標として残す (計測コストは 1 回の now())。
      if (performance.now() - pStart >= TIME_MS * 0.9) nearTimeout += 1;
      if (ctx.depthCompleted < DEPTH) shallow += 1;
      // 採点不能は null のまま刻む。0 (互角) を書くと「互角が正解」という嘘を学習させてしまう。
      if (score === null) unscored += 1;
      sample.searchScore = score;
      samples += 1;
    }

    // レシピを刻んでから書き出す (末尾に付くので labelIdentityKey の内容キーは入力行と一致し続ける)。
    record.game = { ...record.game, labelMeta: RECIPE };
    appendFileSync(OUT, trainingRecordToJsonl(record) + "\n");
    games += 1;
    const gMs = performance.now() - gStart;
    console.log(
      `game ${resumed + games}: ${record.samples.length} samples, ${(gMs / 1000).toFixed(1)}s ` +
        `(${(gMs / record.samples.length).toFixed(0)} ms/局面), source=${record.game.source}`,
    );
  }

  const totalMs = performance.now() - startedAll;
  console.log(`\nDone (shard ${SHARD_INDEX}/${SHARD_COUNT}). ${games} 試合 / ${samples} サンプル (中断除外 ${skipped}) -> ${OUT}`);
  console.log(`  recipe=${RECIPE_KEY}, 総時間 ${(totalMs / 1000).toFixed(1)}s, 平均 ${(totalMs / Math.max(1, samples)).toFixed(0)} ms/局面`);
  if (CLAIM_DIR) {
    console.log(`  取り合い: 既済 ${resumed} 試合 / 他ワーカーへ譲った ${yielded} 試合 / 自分が採点 ${games} 試合`);
  }
  if (RESUME) {
    const orphans = [...completed.values()].reduce((a, b) => a + b, 0);
    console.log(`  再開: 既済 ${resumed} 試合をスキップ (このシャード担当分の通算 ${resumed + games} 試合)`);
    if (orphans > 0) {
      console.warn(
        `  ⚠ OUT に入力側と対応しない ${orphans} 行があります。LABEL_IN / LABEL_SHARD_* の取り違えを確認してください`,
      );
    }
  }
  // ★ラベルの品質劣化は「静かに」起きる (深く読めなかっただけで値は返る) ため、
  //   完了時に必ず目立たせ、終了コードも非ゼロにして 20 時間バッチの最後で沈黙させない。
  if (shallow > 0 || unscored > 0) {
    process.exitCode = 1;
    if (unscored > 0) {
      console.warn(
        `  ⚠ ${unscored} 局面が採点不能 (深さ1 も完了せず searchScore=null)。LABEL_TIME_MS (${TIME_MS} ms) を上げて再採点してください`,
      );
    }
    if (shallow > 0) {
      console.warn(
        `  ⚠ ${shallow} 局面が深さ ${DEPTH} に到達しませんでした (実測)。ラベルが浅い = 教材の質が落ちます。LABEL_TIME_MS を上げて再採点を検討してください`,
      );
    }
    if (nearTimeout > 0) {
      console.warn(`  (うち ${nearTimeout} 局面は時間上限の 90% を超過 = 時間切れが原因)`);
    }
  } else if (nearTimeout > 0) {
    // 深さ D には届いたが予算をほぼ使い切った局面。今回のラベルは正常だが、
    // 次に深さを上げると浅くなる先行指標なので軽く残す (終了コードは変えない)。
    console.log(
      `  参考: ${nearTimeout} 局面が時間上限 (${TIME_MS} ms) の 90% を超えました (深さ ${DEPTH} には到達)`,
    );
  }
}

main();
