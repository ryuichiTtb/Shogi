// Issue #245 Stage 2: 深さ5 ラベル付けバッチの進捗ビューア。
//
// 長時間 (数十時間) 走るバッチの進み具合を、いつでも 1 コマンドで確認するための道具。
// 「あと何時間か」「ワーカーは生きているか」「止まっていないか」が一目で分かることを狙う。
//
// 設計: 巨大な JSONL (入力 125MB / 出力 110MB+) を JSON.parse すると数十秒かかるため、
// **サンプル数は `"plyIndex":` の出現回数を数えて求める** (1 サンプル = 1 plyIndex、
// game 側には無いフィールド)。文字列走査だけなので 1 秒未満で終わる。
//
// 使い方 (リポジトリルートで):
//   npm run label:progress              1 回だけ表示
//   LABEL_WATCH=60 npm run label:progress   60 秒ごとに更新 (Ctrl+C で終了)
//
// env:
//   LABEL_PROGRESS_IN   入力 JSONL (既定 local-data/training/snap-selfplay.jsonl)
//   LABEL_PROGRESS_GLOB 出力ファイルの接頭辞 (既定 labeled-348-D5)
//   LABEL_WATCH         指定秒ごとに再描画 (未指定 = 1 回だけ)

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "local-data/training";
const IN = process.env.LABEL_PROGRESS_IN ?? join(DIR, "snap-selfplay.jsonl");
const PREFIX = process.env.LABEL_PROGRESS_GLOB ?? "labeled-348-D5";
const WATCH = Number(process.env.LABEL_WATCH ?? "0");

// 1 サンプル = 1 個の "plyIndex" フィールド。JSON.parse せずに数える。
function countSamples(text: string): number {
  let n = 0;
  let i = 0;
  const needle = '"plyIndex":';
  for (;;) {
    const hit = text.indexOf(needle, i);
    if (hit < 0) return n;
    n += 1;
    i = hit + needle.length;
  }
}

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1;
  // 末尾に改行が無い場合の 1 行を補う
  return text.length > 0 && text.charCodeAt(text.length - 1) !== 10 ? n + 1 : n;
}

interface Snapshot {
  totalGames: number;
  totalPos: number;
  doneGames: number;
  donePos: number;
  lastWrite: number | null; // 最後に成果が書かれた時刻 (epoch ms)
  workers: number;
  workerCpu: number;
  runSec: number; // 今回の実行で費やした採点時間の合計
  runPos: number; // 今回の実行で採点した局面数
  recent: string[];
}

function outputFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".jsonl"))
    // 結合済みファイル (labeled-348-D5.jsonl) は二重計上になるので除く
    .filter((f) => f !== `${PREFIX}.jsonl`)
    .map((f) => join(DIR, f));
}

function collect(): Snapshot {
  const input = readFileSync(IN, "utf8");
  const totalGames = countLines(input);
  const totalPos = countSamples(input);

  let doneGames = 0;
  let donePos = 0;
  let lastWrite: number | null = null;
  for (const f of outputFiles()) {
    const text = readFileSync(f, "utf8");
    doneGames += countLines(text);
    donePos += countSamples(text);
    const mt = statSync(f).mtimeMs;
    if (text.length > 0 && (lastWrite === null || mt > lastWrite)) lastWrite = mt;
  }

  // 今回の実行ぶんのペース。ログの最後の実行マーカー以降の "game N: X samples, Ys" を集計する。
  let runSec = 0;
  let runPos = 0;
  // ログ行に時刻が無いので、「ログファイルの更新時刻 → ファイル内の行順」で新しさを近似する。
  const events: { at: number; idx: number; text: string }[] = [];
  for (const f of readdirSync(DIR).filter((f) => f.startsWith(PREFIX) && f.endsWith(".log"))) {
    const mtime = statSync(join(DIR, f)).mtimeMs;
    const lines = readFileSync(join(DIR, f), "utf8").split("\n");
    let started = false;
    lines.forEach((l, idx) => {
      if (l.includes("===== ") && l.includes("run")) {
        started = true;
        return;
      }
      if (!started) return;
      const m = l.match(/^game \d+: (\d+) samples, ([\d.]+)s/);
      if (m) {
        runPos += Number(m[1]);
        runSec += Number(m[2]);
        const who = f.replace(`${PREFIX}.`, "").replace(".log", "");
        events.push({ at: mtime, idx, text: `${who}: ${l}` });
      }
    });
  }
  events.sort((a, b) => a.at - b.at || a.idx - b.idx);
  const recent = events.map((e) => e.text);

  // ワーカーの生存確認 (CPU をちゃんと使っているか)。ps が無い環境では 0 扱い。
  let workers = 0;
  let workerCpu = 0;
  try {
    const ps = execFileSync("ps", ["-eo", "pcpu,cmd"], { encoding: "utf8" });
    for (const l of ps.split("\n")) {
      if (!l.includes("label-search-score-245.ts")) continue;
      const cpu = Number(l.trim().split(/\s+/)[0]);
      if (Number.isFinite(cpu) && cpu > 20) {
        workers += 1;
        workerCpu += cpu;
      }
    }
  } catch {
    // ps が使えない環境では稼働状況を表示しないだけ
  }

  return { totalGames, totalPos, doneGames, donePos, lastWrite, workers, workerCpu, runSec, runPos, recent };
}

function bar(ratio: number, width = 32): string {
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function hhmm(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h} 時間 ${m} 分` : `${m} 分`;
}

function ago(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "1 分以内";
  if (min < 60) return `${min} 分前`;
  return `${Math.floor(min / 60)} 時間 ${min % 60} 分前`;
}

function render(s: Snapshot): string {
  const ratio = s.totalPos > 0 ? s.donePos / s.totalPos : 0;
  const remGames = s.totalGames - s.doneGames;
  const remPos = s.totalPos - s.donePos;
  const pace = s.runPos > 0 ? s.runSec / s.runPos : 0; // 秒/局面
  const out: string[] = [];

  out.push("━━━ 深さ5 ラベル付け 進捗 ━━━━━━━━━━━━━━━━━━━━━━━━");
  out.push(`  [${bar(ratio)}] ${(ratio * 100).toFixed(1)}%`);
  out.push("");
  out.push(`  局   : ${s.doneGames} / ${s.totalGames}  (残り ${remGames})`);
  out.push(
    `  局面 : ${s.donePos.toLocaleString()} / ${s.totalPos.toLocaleString()}  (残り ${remPos.toLocaleString()})`,
  );
  out.push("");

  if (s.workers > 0) {
    out.push(`  ワーカー : ${s.workers} 稼働  (CPU 合計 ${Math.round(s.workerCpu)}%)`);
  } else {
    out.push("  ワーカー : ★停止中 (動いているプロセスがありません)");
  }
  if (pace > 0) {
    out.push(`  ペース   : ${pace.toFixed(1)} 秒/局面 (直近の実行ぶんの実測)`);
    if (s.workers > 0 && remPos > 0) {
      const etaH = (remPos * pace) / s.workers / 3600;
      const done = new Date(Date.now() + etaH * 3600 * 1000);
      out.push(
        `  完了予想 : 約 ${hhmm(etaH)}後  (${String(done.getHours()).padStart(2, "0")}:${String(done.getMinutes()).padStart(2, "0")} ごろ)`,
      );
    }
  }
  if (s.lastWrite !== null) {
    const gap = Date.now() - s.lastWrite;
    // 1 局に 1 時間以上かかることがあるので、無反応 = 異常とは限らない。目安として出す。
    out.push(`  最終保存 : ${ago(gap)}${gap > 3 * 3600 * 1000 ? "  ★3時間以上動きなし。ログを確認してください" : ""}`);
  }

  if (remPos === 0) {
    out.push("");
    out.push("  ✅ 全局そろいました");
  } else if (s.recent.length > 0) {
    out.push("");
    out.push("  直近の完了:");
    for (const r of s.recent.slice(-4)) out.push(`    ${r}`);
  }
  out.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return out.join("\n");
}

function main() {
  if (WATCH > 0) {
    const tick = () => {
      process.stdout.write("\x1b[2J\x1b[H"); // 画面クリア
      console.log(render(collect()));
      console.log(`  (${WATCH} 秒ごとに更新 / Ctrl+C で終了)`);
    };
    tick();
    setInterval(tick, WATCH * 1000);
  } else {
    console.log(render(collect()));
  }
}

main();
