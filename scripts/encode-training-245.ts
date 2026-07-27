// 対局 JSONL → 学習用特徴 JSONL への変換 (Issue #245 フェーズ1 P1-1→P1-2 連結)。
//
// 収集済みの対局 (1 行 = 1 試合 TrainingGameRecord) を読み、各サンプルを encodePosition で
// 疎特徴 + 勝敗ラベル (先手絶対視点 z) へ変換して特徴 JSONL (1 行 = 1 サンプル) を書き出す。
// 学習側 (Python) はこの特徴 JSONL を読むだけで、encoder を再実装しない (スキューゼロ)。
//
// 変換は純関数 gameToSparseRows (learned/feature-export.ts) に委譲し、本スクリプトは I/O のみ。
// 出力と同名 + .meta.json に featureDim / 件数 / ラベル分布を書く (Python が密次元を知るため)。
//
// 使い方 (リポジトリルートで):
//   ENCODE_IN=local-data/training/human-245.jsonl,local-data/training/selfplay-advanced-245.jsonl \
//     ENCODE_OUT=local-data/training/features-245.jsonl npx tsx scripts/encode-training-245.ts
//
// env:
//   ENCODE_IN   入力 JSONL (カンマ区切り、既定 local-data/training/human-245.jsonl)
//   ENCODE_OUT  出力特徴 JSONL (既定 local-data/training/features-245.jsonl)

import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_BOOTSTRAP_PARAMS } from "@/lib/shogi/ai/learned/bootstrap-label";
import { FEATURE_DIM } from "@/lib/shogi/ai/learned/encoder";
import { gameToBootstrapRows, gameToSparseRows } from "@/lib/shogi/ai/learned/feature-export";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";

import { BRANCH_SOURCE_PREFIX, familyIdFor } from "./utils/corpus-family";
import { recipeKey } from "./utils/label-identity";

const IN = (process.env.ENCODE_IN ?? "local-data/training/human-245.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.ENCODE_OUT ?? "local-data/training/features-245.jsonl";
// Issue #245 Stage 2: ENCODE_BOOTSTRAP=1 で search-score bootstrapping ラベル (§3.4 squash) を使う。
// 既定 (=0) は outcome ラベル (フェーズ1 PoC 互換)。α は ENCODE_ALPHA (既定 §8 決定 = 0.5)。
// ★bootstrap には label-search-score-245.ts (Pass 1) で searchScore を付与済の入力が必要。
// ★教材多様化 段1: bootstrap では**全入力のラベル生成レシピが一致していること**を検査する。
//   深さ4 と深さ5 のラベルが混ざると、モデルは「同じ局面に別々の正解がある」と教わることになり
//   学習が静かに壊れる。ここが学習前の最後の関門 (train-245.ts は単一ファイルしか受けない)。
//   outcome モードは searchScore を一切使わないので検査しない。
const BOOTSTRAP = process.env.ENCODE_BOOTSTRAP === "1";
const BOOTSTRAP_PARAMS = {
  ...DEFAULT_BOOTSTRAP_PARAMS,
  alpha: Number(process.env.ENCODE_ALPHA ?? String(DEFAULT_BOOTSTRAP_PARAMS.alpha)),
};

// ★検査に落ちたときに「中途半端な特徴ファイル」を残さないため、いったん一時ファイルへ書き、
//   全ての検査を通ってから OUT へ差し替える (rename は同一ディレクトリならアトミック)。
//   これをしないと、途中で停止しても前半だけ書かれた OUT と前回実行の古い .meta.json が残り、
//   学習側 (train-245.ts は .meta.json を読まない) がそれを正常なデータとして食べてしまう。
const TMP = `${OUT}.tmp`;

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(TMP, ""); // truncate

  let games = 0;
  let samples = 0;
  let skippedGames = 0; // winner=null 等で行ゼロの試合
  // train/val 分割のキー。**試合単位ではなく family (同じ出どころのまとまり) 単位**に振る。
  // 分岐棋譜は親と分岐点まで同じ道を通るので、別々に採番すると片方が val に入り、
  // 「学習で見たのとほぼ同じ局面」で検証してしまう (val リーク)。
  const familyIndex = new Map<string, number>();
  const familyOrder: string[] = []; // 連番 → family 鍵 (診断が保留集合を鍵で復元できるようにする)
  const rootedFamilies = new Set<string>(); // 分岐でない棋譜を含む family
  const branchFamilies = new Set<string>(); // 分岐棋譜を含む family
  let branchRows = 0; // 分岐棋譜の行数
  const labelCounts: Record<string, number> = { "1": 0, "0": 0, "-1": 0 }; // outcome 用
  // bootstrap (連続ラベル [-1,1]) 用の統計。labelCounts は bucket が無数になるため使わない。
  let labelSum = 0;
  let labelMin = Infinity;
  let labelMax = -Infinity;
  const sources: Record<string, number> = {};
  // 段1: ラベルのレシピ (bootstrap の一致検査用) と採点率 (静かな劣化の検知用)。
  let firstRecipe: { key: string; file: string } | null = null;
  let scored = 0;
  let unscored = 0;

  for (const file of IN) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      console.warn(`[encode-training-245] 入力が読めません (skip): ${file}`);
      continue;
    }
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    let chunk = "";
    for (const line of lines) {
      const record = parseTrainingRecordLine(line);
      if (BOOTSTRAP) {
        // レシピ一致の検査。混在を見つけた時点で止める (これ以上エンコードしても捨てる出力なので)。
        const key = recipeKey(record.game.labelMeta);
        if (firstRecipe === null) {
          firstRecipe = { key, file };
        } else if (key !== firstRecipe.key) {
          throw new Error(
            `ラベル生成レシピが混在しています。学習前に 1 レシピへ揃えてください。\n` +
              `  ${firstRecipe.file}: ${firstRecipe.key}\n  ${file}: ${key}`,
          );
        }
      }
      // family 鍵 (clean が刻んだもの。無ければ内容から導く) ごとに連番を振る。
      // ★採番は「行を出した試合」だけに与える。中断などで 0 行の試合に番号を配ると
      //   番号に穴が開き、この番号で保留集合を復元する診断がずれる。
      const family = familyIdFor(record);
      const isBranch = record.game.sourceGameId?.startsWith(BRANCH_SOURCE_PREFIX) === true;
      const rows = BOOTSTRAP
        ? gameToBootstrapRows(record, BOOTSTRAP_PARAMS, familyIndex.get(family) ?? familyIndex.size)
        : gameToSparseRows(record, familyIndex.get(family) ?? familyIndex.size);
      games += 1;
      if (rows.length === 0) {
        skippedGames += 1;
        continue;
      }
      if (!familyIndex.has(family)) {
        familyIndex.set(family, familyIndex.size);
        familyOrder.push(family);
      }
      if (isBranch) {
        branchRows += rows.length;
        branchFamilies.add(family);
      } else {
        rootedFamilies.add(family);
      }
      if (BOOTSTRAP) {
        // 採点率は「実際に学習へ渡る行」だけで数える (除外された試合を混ぜると率が意味を失う)。
        // searchScore が無い/null のサンプルは outcome のみのラベルへ静かに降格するため、
        // どれだけ降格したかを .meta.json に残して後から追跡できるようにする。
        for (const s of record.samples) {
          if (s.searchScore === undefined || s.searchScore === null) unscored += 1;
          else scored += 1;
        }
      }
      sources[record.game.source] = (sources[record.game.source] ?? 0) + 1;
      for (const r of rows) {
        chunk += JSON.stringify(r) + "\n";
        samples += 1;
        if (BOOTSTRAP) {
          labelSum += r.label;
          if (r.label < labelMin) labelMin = r.label;
          if (r.label > labelMax) labelMax = r.label;
        } else {
          labelCounts[String(r.label)] = (labelCounts[String(r.label)] ?? 0) + 1;
        }
      }
    }
    if (chunk) appendFileSync(TMP, chunk);
    console.log(`  読込: ${file}`);
  }

  // 分岐棋譜を含む family のうち、親 (分岐でない棋譜) も同じ組に居るものを数える。
  const orphanBranchFamilies = { merged: 0, orphan: 0 };
  for (const f of branchFamilies) {
    if (rootedFamilies.has(f)) orphanBranchFamilies.merged += 1;
    else orphanBranchFamilies.orphan += 1;
  }

  const totalScored = scored + unscored;
  const coverage = totalScored > 0 ? scored / totalScored : 0;

  // 1 件も採点されていない = bootstrap のつもりが実質 outcome ラベルで学習していた、という
  // 最悪の取り違え。ここで止めないと「深く読んだラベルで学習した」と誤認したまま先へ進む。
  // ★成果物を差し替える**前**に検査する (差し替えた後だと使えてしまう)。
  if (BOOTSTRAP && totalScored > 0 && scored === 0) {
    throw new Error(
      `ENCODE_BOOTSTRAP=1 ですが searchScore が 1 件もありません (全行が outcome ラベルに降格します)。\n` +
        `  先に scripts/label-search-score-245.ts で採点した JSONL を ENCODE_IN に指定してください。`,
    );
  }

  const labelStats = BOOTSTRAP
    ? {
        mode: "bootstrap",
        alpha: BOOTSTRAP_PARAMS.alpha,
        cpRef: BOOTSTRAP_PARAMS.cpRef,
        cpScale: BOOTSTRAP_PARAMS.cpScale,
        labelMin,
        labelMax,
        labelMean: samples ? labelSum / samples : 0,
        // 来歴: どのレシピで採点されたラベルか / どれだけ採点済みか。
        labelRecipe: firstRecipe?.key ?? null,
        searchScoreCoverage: { scored, unscored, ratio: coverage },
      }
    : { mode: "outcome", labelCounts };
  const meta = {
    featureDim: FEATURE_DIM,
    sampleCount: samples,
    games,
    skippedGames,
    // train/val はこの単位で分ける。
    families: familyIndex.size,
    // 連番 → family 鍵。診断 (diag-learned-245.ts) が「どの棋譜が保留だったか」を
    // 位置合わせでなく鍵で復元するために要る。
    familyIds: familyOrder,
    branchRows,
    // 分岐棋譜が**親と同じ組に入れたか**。親が入力に居なければ枝は単独 family になり、
    // リーク対策が空振りする (それでも families / branchRows は正常値に見えてしまう)。
    mergedFamilies: orphanBranchFamilies.merged,
    orphanBranchFamilies: orphanBranchFamilies.orphan,
    sources,
    ...labelStats,
  };
  // 全検査を通ったのでここで初めて本番の成果物にする (特徴 → meta の順。meta が新しければ
  // 特徴も新しい、という関係を保つ)。
  renameSync(TMP, OUT);
  writeFileSync(`${OUT}.meta.json`, JSON.stringify(meta, null, 2));

  console.log(`\nDone. ${games} 試合 (除外 ${skippedGames}) / ${samples} サンプル -> ${OUT}`);
  console.log(`  train/val の分割単位: ${familyIndex.size} family`);
  if (branchFamilies.size > 0) {
    console.log(
      `  分岐棋譜: ${branchRows} 行 / ${branchFamilies.size} family ` +
        `(親と同じ組 ${orphanBranchFamilies.merged} / 親が入力に居ない ${orphanBranchFamilies.orphan})`,
    );
    if (orphanBranchFamilies.orphan > 0) {
      console.warn(
        `  ⚠ ${orphanBranchFamilies.orphan} family は分岐棋譜だけで親が居ません。` +
          `親の棋譜を ENCODE_IN に含めないと、親が学習・枝が検証に散って検証が甘くなります` +
          `(clean を通した棋譜を使う場合は、clean が familyId を刻んだ後のものであること)。`,
      );
    }
  }
  console.log(`  featureDim: ${FEATURE_DIM}`);
  if (BOOTSTRAP) {
    console.log(`  bootstrap ラベル (α=${BOOTSTRAP_PARAMS.alpha}): min=${labelMin.toFixed(3)} max=${labelMax.toFixed(3)} mean=${(samples ? labelSum / samples : 0).toFixed(3)}`);
    console.log(`  ラベルのレシピ: ${firstRecipe?.key ?? "(入力なし)"}`);
    console.log(`  採点率: ${scored} / ${totalScored} (${(coverage * 100).toFixed(1)}%)`);
    if (unscored > 0) {
      console.warn(
        `  ⚠ ${unscored} サンプルは searchScore が無く outcome のみのラベルになりました (深く読んだラベルではありません)`,
      );
    }
  } else {
    console.log(`  label 分布 (先手+1/引分0/後手-1): ${JSON.stringify(labelCounts)}`);
  }
  console.log(`  source 内訳: ${JSON.stringify(sources)}`);
}

try {
  main();
} catch (e) {
  // 検査に落ちた = この実行の成果は使えない。書きかけの一時ファイルを残さない
  // (既存の OUT / .meta.json は前回のまま無傷 = 中途半端な差し替えが起きない)。
  rmSync(TMP, { force: true });
  throw e;
}
