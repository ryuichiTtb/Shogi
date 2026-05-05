# カード将棋 UI/UX 精密配置基盤

Issue #134 の配置・検証基準。iPhone17e は所有実機で確認できる代表端末として扱うが、設計は特定端末に固定しない。viewport 実寸、DPR、safe area、DOM 実測を基準に、iPhone 15/16/17 系、Android 小型〜大型端末、PC 代表解像度で破綻しないことを目標にする。

## Viewport Matrix

| 種別 | Viewport | DPR | 用途 |
|---|---:|---:|---|
| mobile | 320x568 | 2 | 最小幅・低縦幅の下限確認 |
| mobile | 360x640 | 3 | Android 小型相当 |
| mobile | 360x740 | 3 | Android 標準縦長 |
| mobile | 375x812 | 3 | iPhone 標準幅 |
| mobile | 390x844 | 3 | iPhone 15/16 系代表 |
| mobile | 393x852 | 3 | Android / iPhone 近似代表 |
| mobile | 414x896 | 3 | 大きめ iPhone |
| mobile | 430x932 | 3 | 大型 iPhone / Android |
| desktop | 1280x800 | 1 | 小型ノート |
| desktop | 1366x768 | 1 | 低縦幅 PC |
| desktop | 1440x900 | 1 | 標準デスクトップ |
| desktop | 1920x1080 | 1 | 大型デスクトップ |

headless Chrome では mobile viewport に `mobile: true` と DPR を設定する。実機と完全一致するものではないため、safe area とブラウザ UI 差は下記の実機測定で補完する。

## iPhone17e / 実機測定欄

実測値は推測で埋めない。`/dev/card-shogi-layout?scenario=progress4` を実機で開き、Safari / Chrome / PWA それぞれ必要に応じて DevTools console で以下を記録する。

```js
JSON.stringify({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio,
  visualViewport: window.visualViewport && {
    width: window.visualViewport.width,
    height: window.visualViewport.height,
    offsetTop: window.visualViewport.offsetTop,
    offsetLeft: window.visualViewport.offsetLeft,
    scale: window.visualViewport.scale,
  },
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  safeAreaProbe: {
    note: "safe-area は CSS env のため、必要なら一時 probe 要素で computed style を測る",
  },
}, null, 2)
```

| 端末 | 表示形態 | innerWidth | innerHeight | DPR | visualViewport | safe area / 備考 |
|---|---|---:|---:|---:|---|---|
| iPhone17e | Safari | 未測定 | 未測定 | 未測定 | 未測定 | 実機確認後に追記 |
| iPhone17e | Chrome | 未測定 | 未測定 | 未測定 | 未測定 | 実機確認後に追記 |
| iPhone17e | PWA | 未測定 | 未測定 | 未測定 | 未測定 | 実機確認後に追記 |
| その他 iPhone | Safari / Chrome | 未測定 | 未測定 | 未測定 | 未測定 | 必要に応じて追記 |
| Android | Chrome | 未測定 | 未測定 | 未測定 | 未測定 | 必要に応じて追記 |

## 検証状態

`/dev/card-shogi-layout` は DB に触らない fixture でカード将棋画面を表示する。

| scenario | 内容 |
|---|---|
| `initial` | 初期状態 |
| `progress1` | 自動ドロー進捗 1/5 |
| `progress4` | 自動ドロー進捗 4/5 |
| `many-hands` | 自分 / 相手の手札が多い状態 |
| `captured` | 持ち駒あり |
| `trap` | トラップあり |
| `drawer` | モバイル手札ドロワー開 |
| `end` | 終局カード表示 |

機械監査は dev server 起動後に実行する。

```bash
pnpm dev
CARD_SHOGI_LAYOUT_BASE_URL=http://localhost:3000 pnpm test:layout:card-shogi
```

チェック内容:

- `document.documentElement.scrollWidth <= window.innerWidth`
- 主要 UI (`data-card-shogi-*`) が viewport 外へ出ていない
- 盤面が上端カードエリア / 下端操作エリアと重ならない
- `progress4` の進捗リングが山札 button の外縁と 1px 以内で一致する

## 精密配置原則

- スケーラブル座標系 (`viewBox` / `%`) と固定ピクセル量 (`non-scaling-stroke` / px border) を 1 要素内で混在させない。
- DOM に重ねる装飾は、対象要素の実 px を `getBoundingClientRect` / `ResizeObserver` で測ってから描画する。
- 「サイズが小さいほど顕著」「特定 viewport でだけ目立つ」ズレは、% 比率差や座標系の目盛り差を疑う。
- 微調整を繰り返しても直らない場合は、座標系・スケーリング・基準点を見直す。
- モバイル下端 UI など、safe area の影響を受ける要素は固定 px 前提にせず、表示中 DOM の実測値を CSS variable に反映する。

## SVG / CSS 棚卸し結果

| 対象 | 状態 | 対応 |
|---|---|---|
| 山札自動ドローリング | #130 で是正済み | button 実 px を SVG viewBox に反映 |
| 王手崩し ghost slash | #134 で是正 | ghost rect 実 px を SVG viewBox に反映し、`non-scaling-stroke` を撤去 |
| ShogiPiece 五角形 | 保留 | viewBox マージンで stroke 外縁を吸収。DOM 境界に重ねる装飾ではないため今回の是正対象外 |
| CardBack 内側枠 / 四隅装飾 | 保留 | card 内部装飾で外縁整合には直結しない。将来カード裏面調整時に共通 size token 化を検討 |
| 盤面 hint / no_promote ring | 保留 | CSS `ring-inset` で DOM box 内に収まる。機械監査で横見切れ・重なりを監視 |
