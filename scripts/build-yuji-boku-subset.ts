// Issue #155: yuji-boku フォントの自前サブセット (src/app/fonts/yuji-boku-subset.woff2)
// を再生成するスクリプト。
//
// なぜサブセット?
//   フルの Yuji Boku は約 3.5MB あり、display:"swap" でも初回切替がもたつく。
//   実際にユーザに見せる文字 (駒字・オーバーレイ・各種バッジ) のみを含む
//   サブセット (約 10KB 想定) を作って自己ホストする。
//
// 実行: `npx tsx scripts/build-yuji-boku-subset.ts`
//   - Google Fonts CSS API に必要文字 (text=...) を投げて URL を取得
//   - 返ってきた woff2 を src/app/fonts/yuji-boku-subset.woff2 に保存
//   - User-Agent を modern Chrome にすることで woff2 形式を確実に受け取る
//
// 文字を追加・削除する手順:
//   1. CHARSET_GROUPS の該当グループに文字を足す (新規 UI テキスト追加時)
//   2. このスクリプトを実行して woff2 を再生成
//   3. 差分の woff2 を git で commit (バイナリのため diff は出ないが OK)
//
// 注意: スクリプトを実行せずに UI 文字を増やすと、サブセットに含まれない
//   文字だけ別フォント (system fallback) で表示される (= フォントが効いて
//   いないように見える)。Issue #155 で「車・将・行」がフォールバックして
//   いた事象がこの典型例。
import fs from "node:fs/promises";
import path from "node:path";

// 各 UI 表現に出る yuji-boku 適用文字を、出現箇所ごとにグルーピングして
// 定義する。漏れの発見を容易にするため、新規グループ追加時はコメントで
// 出現ファイルの参照を併記すること。
const CHARSET_GROUPS: Record<string, string> = {
  // src/lib/shogi/variants/standard.ts: PIECE_DEF_MAP の kanji / kanjiPromoted
  pieces: "王玉飛竜角馬金銀全桂圭香杏歩と",
  // src/components/game/board-overlay.tsx: OVERLAY_CONFIG.text (通常イベント)
  overlay: "対局開始王手投了詰み",
  // src/components/game/board-overlay.tsx: OVERLAY_CONFIG.text (trap_trigger)
  trap: "トラップ発動!",
  // 全角感嘆符 (U+FF01) は trap の「!」とは別グリフ。明示的に含める。
  fullwidthExclamation: "!",
  // src/components/game/card-shogi/fast-move-badge.tsx: 早指し演出のラベル
  fastMove: "早指し",
  // src/components/loading/loading-card-visual.tsx: ローディング表面の正式名称
  // (歩・香車・桂馬・銀将・金将・飛車・角行・王将)。Issue #155 で追加された
  // 「車・将・行」が以前のサブセットに無く別フォントにフォールバックしていた。
  loadingPieceLabel: "歩香車桂馬銀将金飛角行王将",
};

async function main() {
  const charsetSet = new Set<string>();
  for (const group of Object.values(CHARSET_GROUPS)) {
    for (const ch of group) charsetSet.add(ch);
  }
  const charset = [...charsetSet].sort().join("");
  console.log(`Charset (${charsetSet.size} unique chars): ${charset}`);

  const cssUrl =
    "https://fonts.googleapis.com/css2?family=Yuji+Boku" +
    `&text=${encodeURIComponent(charset)}` +
    "&display=swap";
  const cssRes = await fetch(cssUrl, {
    headers: {
      // modern Chrome の User-Agent で叩くと woff2 を返す (古い UA だと TTF
      // にフォールバックされ、容量が膨らむ)。
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!cssRes.ok) {
    throw new Error(`CSS fetch failed: ${cssRes.status} ${cssRes.statusText}`);
  }
  const css = await cssRes.text();
  // Google Fonts の動的 subset URL は拡張子を持たず (`/l/font?kit=...&v=v8`)、
  // format('woff2') で形式判別される。format パラメータも一緒にマッチさせる。
  const match = css.match(
    /src:\s*url\((https:\/\/[^)\s]+)\)\s*format\(['"]woff2['"]\)/,
  );
  if (!match) {
    throw new Error(
      `Could not extract woff2 URL from CSS response:\n---\n${css}\n---`,
    );
  }
  const fontUrl = match[1];
  console.log(`Fetching woff2 from ${fontUrl}`);

  const fontRes = await fetch(fontUrl);
  if (!fontRes.ok) {
    throw new Error(`Font fetch failed: ${fontRes.status} ${fontRes.statusText}`);
  }
  const buf = Buffer.from(await fontRes.arrayBuffer());

  const outPath = path.resolve(
    process.cwd(),
    "src/app/fonts/yuji-boku-subset.woff2",
  );
  await fs.writeFile(outPath, buf);
  console.log(`Wrote ${buf.byteLength} bytes to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
