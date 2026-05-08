# Issue #189 音源再生最適化計画

作成日: 2026-05-09

## 目的

Issue #189 では、音源 (BGM・SFX) 再生に発生しているラグ・ズレと、モバイル環境でのバックグラウンド時 BGM 残留問題を解消する。

達成したい状態は次の通り。

- **必須要件**: モバイル iPhone Safari で別タブを開いた時、ブラウザがバックグラウンドに移った時、画面ロック時に BGM が再生され続けない (停止する)
- バックグラウンド復帰時には BGM が自動でフェードイン再開する
- 設計は SPA (Next.js App Router の client transition) 遷移前提とする。hard navigation (history.go / 外部リンク) では AudioContext が再生成されるが、初回 user gesture で再 unlock される設計のため新規問題は発生しない (既存 Howler 構成でも同条件)
- ホーム画面到達直後の BGM 再生ラグが体感で短縮される
- 駒指し・画面遷移などの SFX が初回からラグなく鳴る (現状はモバイル初回 unlock 不発による無音/遅延の症状あり)
- 現行実装の妥当性を再検証し、必要なら根本的な実装方式の見直しも辞さない
- ミュート設定がリロード後も保持される
- BGM・SFX の操作互換 API は維持し、既存呼出箇所の書換コストを最小化する
- PC・モバイル双方で動作・体感を改善し、計算量・メモリ・電池消耗を悪化させない

## 過去の経緯 (Issue #79)

本計画の前提として、Issue #79 当時に行った BGM 実装の切替経緯を引き継ぐ。

- 元々 BGM/SFX とも Howler を利用していたが、BGM 側で Howler html5 mode の連鎖トラブルが発生
  - `HTMLAudioElement.loop` 属性の非伝播による `onend` 誤発火
  - `onplayerror` が autoplay block と file error を区別できない
  - html5 pool 枯渇 (`HTML5 Audio pool exhausted`) によるリーク
  - autoplay block 後の二重再生
  - モバイル Safari の audio element 単位 unlock の不透明さ
- BGM を **HTMLAudioElement 直接利用** に切り替えて解決済み (commit `317987f`)
- 当時 SFX は Howler のまま残されたが、Issue #79 のコメントで「**モバイル初回の SFX/対局画面 BGM 不発症状の原因を特定しきれていない。同様の問題が継続する場合は SFX も HTMLAudioElement 直接化を検討する余地あり**」として保留扱いになっていた
- 今回 Issue #189 の調査で、`prepareAudio()` の呼び出しがホーム経路では行われておらず、**Howler の AudioContext が初回 user gesture で resume されない症状**が原因の有力候補と判明した

## 現状認識

調査の結果、以下の問題が確認された。

### BGM (`src/hooks/use-bgm.ts`)

- HTMLAudioElement 直接利用 / `audio.loop = true` ネイティブループ / `play()` Promise reject による autoplay block 検知 / `pageshow.persisted` での bfcache 復帰対応は妥当な設計
- **可視性監視 (`visibilitychange` / `pagehide`) が未実装** → Issue #189 必須要件の直接の原因
- `audio.playsInline` 属性が未指定 (Mobile Safari の PiP / メディアセッション干渉の余地)
- BGM は先読みされておらず、ホーム到達直後は SW cache miss だと初回 fetch + decode 待ちが発生する

### SFX (`src/hooks/use-sound.ts`)

- Howler 利用が二系統に分裂している
  - `useSound()` 経路: mount 時に SFX_FILES 全件 (~30 個) を Howl で preload
  - `playSfxOnce()` 経路: lazy create + module-level singleton cache
  - mute 状態を `setSfxOnceMuted()` で二重同期する必要があり保守性が低い
- `prepareAudio()` (Howler.ctx.resume) は実装されているが、**呼び出し箇所がホーム経路に存在しない** (`match-setup.tsx` の対局開始ボタンと `/dev/sound-tuner` のみ)
  - ホームの `navigateTo()` で `playSfxOnce("nav_forward")` する時点では AudioContext が suspended のまま → 初回無音/遅延の根本原因
- ミュート設定が React state のみで永続化されていない (リロードで毎回音あり)

### プリロード (`src/hooks/use-asset-preloader.ts`)

- SFX は `<audio>.load()` で fetch するが decode はしていないため、Howler 側で改めて `decodeAudioData` する → 初回再生時の decode 遅延が残る
- BGM は先読み対象外

## 実装方針

過去の Issue #79 の学び「抽象化ライブラリの不透明性に悩むより標準シグナル (`Promise reject` / Web Audio API の Promise) を直接握る」を SFX 側にも適用し、**SFX を Web Audio API 直接実装に置き換える**。BGM は単一・長尺・ループ用途で HTMLAudioElement のストリーミング再生が最適なため**現行設計を維持**し、可視性監視と `playsInline` 属性を補強するに留める。

### BGM: 現行 (HTMLAudioElement 直接利用) を維持 + 補強

| 項目 | 内容 |
|---|---|
| 既存 | 単一インスタンス / ネイティブループ / `play()` Promise / bfcache 対応 |
| 追加 | `visibilitychange` / `pagehide` で fade-out + pause、`visible` 復帰で fade-in 再開 |
| 追加 | `bgm_home` の URL を asset preloader に追加して fetch + cache に乗せる |

`playsInline` は HTMLVideoElement 専用属性で `<audio>` に代入しても無視されるため、計画から除外する。iOS Safari のロック画面メディアコントロール制御が必要になった場合は `navigator.mediaSession` API を別途検討する (本 Issue ではスコープ外)。

### SFX: Web Audio API 直接実装に置換 (Howler を本番経路から外す)

| 項目 | 採用案 |
|---|---|
| 実装 | `AudioContext` + `decodeAudioData` で AudioBuffer をプリ decode、`AudioBufferSourceNode` で発火 |
| 利点 | 再生レイテンシ最小 (decode 済み = 数 ms) / 同時再生無制限 / `AudioContext.resume()` Promise で iOS unlock タイミングが明示的 / 連打が完璧 / Howler 二系統と mute 二重同期を解消 / バンドル -21KB |
| 注意 | AudioBuffer 常駐メモリ ≒ 10〜20 MB (モダン端末で許容範囲。Howler も内部で同等の AudioBuffer を持つため実質変化なし) |
| 例外 | `dev/sound-tuner` 経路は seek/duration UI を使うため **Howler 維持** (本番経路と隔離) |

### 採用しなかった案

- **案 A (Howler 維持 + prepareAudio 強化)**: `prepareAudio()` を全クリックに乗せても、Howler 側の lock 状態判定が `playing()` 内部フラグベースで実 audio と乖離するケースを完全には埋められない。Issue #79 の学びを活かすなら抽象化を剥がす方が筋が通る
- **案 C (HTMLAudioElement プールでシンプル化)**: 連打時の要素プール枯渇リスクと低レイテンシ性で Web Audio に劣る

## 実装ステップ

### Phase 1: 必須対応 (Issue #189 直結)

#### Step 1-1. `src/hooks/use-bgm.ts` に可視性監視を追加

- module-level の `wasPlayingBeforeHidden: boolean` フラグを導入
- `document.addEventListener("visibilitychange", ...)` を module-init 時に登録
  - `hidden`: 再生中なら `wasPlayingBeforeHidden = true` → 200ms `fadeVolume` → `audio.pause()`
  - `visible`: `wasPlayingBeforeHidden && currentAudio` なら `audio.play()` → 成功で 500ms フェードイン、reject 時は既存 `scheduleRetryOnUserGesture()` 経路に乗せる
- `window.addEventListener("pagehide", ...)` も併用 (iOS Safari 補完)
  - `e.persisted === false` のときだけ pause (bfcache 経路は既存 `pageshow.persisted` ハンドラに任せる)
- 復帰時 `audio.currentTime` は触らない (頭から戻さない)
- `currentAudio === a` チェックで自分が破棄済みなら no-op (audio 差替えとの競合回避)

#### Step 1-2. ユニットテスト追加

- `src/hooks/__tests__/use-bgm-visibility.test.ts` (新規)
- jsdom + `Object.defineProperty` で `document.visibilityState` 切替、`dispatchEvent` で hidden ↔ visible 再現、`pause()` / `play()` のスパイで呼び出しを検証
- mute=true 状態で hidden に入った場合の挙動 (`audio.paused === false` で `volume=0` 継続中 → pause → 復帰時 fade 0→0) も検証

### Phase 2-A: BGM プリロード強化

- `src/hooks/use-asset-preloader.ts` に `BGM_FILES["bgm_home"]` の URL を追加
- 既存 SFX preloader と同一ロジック (`<audio preload="auto">.load()`) で Map に保持
- `bgm_match_setup` は同一ファイルのため URL 重複排除

### Phase 2-B: SFX を Web Audio API 直接に置換

#### Step 2-B-1. 新規 `src/lib/audio/audio-engine.ts` を作成

- `getAudioCtx()`: module-level `AudioContext` シングルトン (lazy 生成 / Webkit prefix 対応)
- `unlockAudio()`: `ctx.state === "suspended"` で `ctx.resume()` を await し Promise を返す
- `loadSfxBuffer(path)`: `fetch → arrayBuffer → ctx.decodeAudioData` を Map に cache
  - `path` が空文字 (`""`) の場合は no-op (`SFX_FILES` の `game_over` / `game_start` 等の未割当キー対策。現行 `playSfx` の `if (!src) return` ガードを踏襲)
  - decode 失敗時は当該 key のみ skip し他 SFX に影響しない
- `playSfxBuffer(path, { volume })`: 内部で load 待ち → `AudioBufferSourceNode` + `GainNode` を作って `start()` (連打 OK / fire-and-forget で source は GC 任せ)
  - **冒頭で `void unlockAudio()` を呼ぶ** (suspended のときのみ resume)。これにより SFX 呼び出し自体が user gesture なら AudioContext 同期 unlock が成立 → 別途 `prepareAudio()` の事前呼出は不要
- `playSfxBufferOnce(path, { volume })`: 直前同 path source があれば `stop()` してから新 source を `start()` (現行 `playSfxOnce` 互換)。同様に冒頭で `unlockAudio()` を内包
- `setSfxMuted(muted)`: マスタ `GainNode` の値を 0 / 1 に切替
- `AudioContext.statechange` を購読し interrupted → 即 resume 試行 + 失敗時は **次の user gesture 待ちフォールバック** (BGM 側 `scheduleRetryOnUserGesture` と同じパターン: `click` / `touchstart` / `keydown` を捕まえて再試行)
  - iOS では `resume()` を user gesture 外で呼ぶと resolve するが実際には resume されないケースがあるため、user gesture 同期実行をフォールバック経路で必ず確保する

#### Step 2-B-2. `src/hooks/use-sound.ts` を全面書換

- `useSound()`: mount 時の Howler 初期化を撤去。`playSfx` / `stopAll` / `prepareAudio` / `isReady` / `toggleMute` / `isMuted` を audio-engine ベースで再実装
- module-level の `playSfxOnce()` も audio-engine 経由に切替
- `setSfxOnceMuted` を削除し audio-engine の `setSfxMuted` に統合
- `prepareAudio()` は `audio-engine.unlockAudio()` のラッパとして互換 API を維持 (await して unlock 完了を保証したい用途 = 対局開始ボタンなど のために残す)
- 既存呼び出し API (`playSfx` / `toggleMute` / `isMuted` / `prepareAudio` / `stopAll` / `isReady`) は全て維持

#### Step 2-B-2'. ユニットテスト追加

- `src/lib/audio/__tests__/audio-engine.test.ts` (新規)
  - `loadSfxBuffer`: 同一 path への 2 回呼び出しで cache hit (fetch が 1 回しか走らないこと)
  - `loadSfxBuffer`: decode 失敗時に reject せず skip (他 key への影響なし)
  - `loadSfxBuffer`: 空文字 path は no-op
  - `playSfxBuffer`: 同 path 連打で複数 `AudioBufferSourceNode` が並行 start すること
  - `playSfxBufferOnce`: 直前同 path source が `stop()` されてから新 source が start されること
  - `setSfxMuted`: GainNode の値が 0 / 1 に追従すること
  - `unlockAudio`: `ctx.state === "suspended"` のとき `resume()` が呼ばれること / `running` のとき no-op
  - `statechange interrupted`: 即 resume 失敗時に user gesture (`click`) で再試行されること
- `src/hooks/__tests__/use-sound-compat.test.ts` (新規)
  - 既存呼出元 7 ファイルの API シグネチャ (`playSfx` / `toggleMute` / `isMuted` / `prepareAudio` / `stopAll` / `isReady`) が破壊されていないこと
  - `playSfxOnce` が module-level 関数として export されており Howler 時代と同じシグネチャで呼べること

#### Step 2-B-3. `src/hooks/use-asset-preloader.ts` を Web Audio 対応に書換

- SFX: `audio-engine.loadSfxBuffer(url)` を `Promise.allSettled` で並列実行 (decode 失敗は当該 key のみ skip)
- BGM: 既存 `<audio>.load()` 方式を維持

#### Step 2-B-4. `prepareAudio()` 呼出位置の整理

`playSfx` / `playSfxOnce` 内部で `unlockAudio()` を統合 (Step 2-B-1) するため、SFX 呼出経路では別途 `prepareAudio()` を呼ぶ必要は無い。残す呼出位置は以下のみとする。

- `src/components/home/match-setup.tsx` の `handleStart` (await で unlock 完了を保証してから対局画面に遷移したい用途) — **既存維持**
- `src/app/dev/sound-tuner/[eventKey]/page.tsx` (dev tool プレビュー前 unlock) — **既存維持**
- `src/app/page.tsx` の `navigateTo()` および `src/components/navigation/masked-link.tsx` の `handleClick` には**追加しない** (これらは内部で `playSfxOnce` を呼んでおり、その内部で `unlockAudio()` が同期発火するため冗長)

効果: ホーム到達直後の最初の SFX 呼び出し自体が user gesture 同期で AudioContext を unlock する。SFX を呼ばない経路 (キーボード遷移など) でも次に SFX が呼ばれた時点で unlock が成立するため、初回無音/遅延は発生しない。

#### Step 2-B-5. dev/sound-tuner 系は Howler 維持

- `src/hooks/dev/use-preview-player.ts` は seek/duration を使うため Howler のまま
- 本番経路と完全分離するため `package.json` から `howler` は削除しない

### Phase 3: 品質改善

#### Step 3-1. ミュート設定の localStorage 永続化

- キー: `shogi-sound:muted`
- 既存 `src/components/theme-provider.tsx` のパターン (`useSyncExternalStore` + storage event) に倣う
- 初期値: storage が無いなら `false` (音あり)
- **Singleton への初期同期**: `useSound` の初回 mount 時 (storage 値が読めた直後) に `audio-engine.setSfxMuted(stored)` と `setBgmMuted(stored)` を呼び、`audio-engine` のマスタ `GainNode` と `use-bgm.ts` の `currentAudio.volume` に値を反映させる。これを行わないと UI 上は muted でも音が鳴る/鳴らない不一致が起こる
- storage event (他タブからの変更) も同様に singleton へ伝播させる

### スコープ外 (派生扱い・別 Issue 化候補)

- **SW PRECACHE_ASSETS 自動同期**: `public/sw.js` の `PRECACHE_ASSETS` が `manifest.ts` の SFX_FILES と手動同期している点。本 Issue と論理結合がないため別 Issue 化を提案
- **レイテンシ計測 (dev only)**: `performance.now()` で BGM start → playing までの ms を `console.debug` 出力する観測ロギング。観測専用のため別 Issue 化を提案

## 主要ファイル

### 変更

- `src/hooks/use-bgm.ts` — 可視性監視追加 (`visibilitychange` / `pagehide`)
- `src/hooks/use-sound.ts` — 全面書換 (Web Audio 化 + `unlockAudio()` 内包 + mute localStorage 永続化)
- `src/hooks/use-asset-preloader.ts` — SFX を `decodeAudioData` まで実行 / `bgm_home` プリロード追加

### 新規

- `src/lib/audio/audio-engine.ts` — AudioContext 管理 + decode キャッシュ + 再生 API + `statechange` フォールバック
- `src/hooks/__tests__/use-bgm-visibility.test.ts` — 可視性監視のユニットテスト
- `src/lib/audio/__tests__/audio-engine.test.ts` — Web Audio エンジンのユニットテスト
- `src/hooks/__tests__/use-sound-compat.test.ts` — `useSound` 互換 API のユニットテスト

### 変更しないが検証必須 (既存呼出元)

- `src/components/game/shogi-game.tsx`
- `src/components/game/card-shogi/card-shogi-game.tsx`
- `src/components/decks/deck-editor-pane.tsx`
- `src/components/navigation/masked-link.tsx`
- `src/app/page.tsx`
- `src/components/home/match-setup.tsx` (`prepareAudio` await 用途は維持)
- `src/app/dev/sound-tuner/[eventKey]/page.tsx`

### 参照のみ (変更不要)

- `src/components/audio/bgm-provider.tsx`
- `src/components/home/match-setup.tsx`
- `src/lib/audio/manifest.ts`
- `src/lib/dev/sound-overrides.ts`
- `src/hooks/dev/use-preview-player.ts` (Howler 維持)

## 影響範囲・リスク

| リスク | 対策 |
|---|---|
| `visibilitychange` と `pageshow.persisted` のダブル fire | visibilitychange ハンドラは `currentAudio === a` で自分が破棄済みなら no-op。pageshow 経路は audio 再構築する別系統 |
| pause 直後の play() が iOS で `NotAllowedError` | 既存 `scheduleRetryOnUserGesture()` 経路に乗せて吸収 |
| `setBgmMuted(true)` 中の visibility ロジック干渉 | mute は `volume=0` で再生継続する仕様。`audio.paused` を見るので mute 状態と独立 |
| AudioBuffer 常駐 (10〜20MB) | モダンスマホで許容範囲。Howler も内部で同等の AudioBuffer を持つため実質変化なし |
| iOS の `AudioContext interrupted` (通話着信等) | `statechange` 購読で resume 試行 |
| 連打で `AudioBufferSourceNode` 大量生成 | `playSfxBufferOnce` は同 key の `stop()` ガード付き / `playSfxBuffer` は使い捨てで GC 安価 |
| decode 失敗 | `decodeAudioData` reject を catch して当該 key のみ skip |
| `useSound` API 互換性 | 既存呼び出し (`playSfx` / `toggleMute` / `isMuted` / `prepareAudio` / `stopAll` / `isReady`) を全て維持 |
| dev/sound-tuner と本番経路の AudioContext が同一タブで並立 | dev tool は本番ユーザー導線から到達不能 (`/dev/*`)。本番経路への副作用なし → **許容**。dev タブで両経路を行き来した場合の AudioContext 増殖は dev チューニング中のみの一時的事象として無視 |
| mute=true 状態で hidden に入った場合 | `audio.paused === false` (volume=0 で再生継続中) → 「再生中扱い」と判定し pause、復帰時に fade 0→0 で再生継続。意図通り (mute 中も BGM は仮想的に再生継続している扱い) |
| hard navigation (history.go / 外部リンク経由) | AudioContext は再生成されるが、初回 user gesture で再 unlock される設計のため新規問題なし (既存 Howler 構成でも同条件)。SPA (Next.js client transition) 前提で十分 |

### デグレ確認観点

- ホーム → /play → /game → 投了 → ホーム の BGM 切替えが正常動作する
- `useBgm(null)` で停止する
- `bgm_game` → `bgm_game_over` のクロスフェードが動作する
- `bgm_home` ↔ `bgm_match_setup` 同 path 早期 return (リスタートしない)
- ミュート切替が BGM・SFX 両方に効く
- bfcache 復帰
- 全 SFX (駒系 6 / 対局系 4 / カード系 19) が引き続き鳴る

## 検証方法

### ローカル

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm build
```

### Vercel preview (実機)

| シナリオ | 期待動作 |
|---|---|
| iPhone Safari でホーム → ロック画面 | 200ms フェードアウト後 BGM 停止 |
| ロック解除 (visible 復帰) | 500ms フェードインで BGM 再開 (currentTime 維持) |
| ホーム → ホームボタンで Safari バックグラウンド化 | BGM 停止 |
| Safari に戻る | フェードイン再開 |
| 別タブを新規作成 | 元タブの BGM 停止 |
| 元タブに戻る | 再開 |
| Android Chrome でも同等 | 停止/再開 |
| デスクトップ Chrome タブ切替 | 停止/再開 |
| 通話着信中 (iOS) | OS が pause、復帰で AudioContext interrupted から resume |
| ホーム着地直後の最初のボタン押下 | SFX `nav_forward` が初回からラグなく鳴る |
| 駒移動 SFX | 体感レイテンシ < 50ms |
| ホーム到達直後の BGM | 体感ラグが従来より短縮 |

## ブランチ運用

- ブランチ名: `feature/#189`
- 起点: `origin/main`
- 作業スペース: Worktree (`.claude/worktrees/issue-189`) で切り出し
- マイルストーン: 計画策定直後 / 実装完了時 / マージ前 の 3 段階で Issue #109 の徹底レビューを実施
- **コミット粒度**: Phase 単位で分割する (AGENTS.md ルール 7「意味のある単位で分割」)
  - C1. Phase 1 (BGM 可視性監視 + テスト)
  - C2. Phase 2-A (BGM プリロード)
  - C3. Phase 2-B (SFX Web Audio 化 + audio-engine.ts 新設 + テスト + 既存 use-sound.ts 全面書換)
  - C4. Phase 3-1 (mute localStorage 永続化)
  - 各コミットの Phase 単独で revert 可能とすることでデグレ追跡を容易化する
- AGENTS.md ルール 1: PR 作成 / マージ / Issue クローズは明示指示があるまで実施しない
- AGENTS.md ルール 9: 完了時に Worktree・ローカルブランチ・origin ブランチの削除をユーザー確認の上で実施

## スコープ確認 (ユーザー回答)

- Phase 1 + 2-A + 2-B + 3-1 を **1 PR にまとめる** (SFX 全面書換含む)
- バックグラウンド復帰時は **自動でフェードイン再開**
- SFX は可視性で抑制せず BGM のみ停止
- 作業スペースは Worktree

## レビュー指摘の反映履歴

[Issue #189 レビューコメント](https://github.com/ryuichiTtb/Shogi/issues/189#issuecomment-4408336725) に基づき、計画書を以下のように更新済み。

| 指摘 | 反映内容 |
|---|---|
| N1: `audio.playsInline` は `<audio>` で無効 | Phase 1 から削除。代替として `mediaSession` API は本 Issue スコープ外と明記 |
| N2: SFX 全面書換に対するテスト不足 | Step 2-B-2' を追加し `audio-engine.test.ts` / `use-sound-compat.test.ts` を計画に含めた |
| R1: `prepareAudio()` 呼出位置の冗長化 | 案 A 採用: `playSfxBuffer` / `playSfxBufferOnce` 内部で `unlockAudio()` を統合し、`navigateTo` / `masked-link` への追加は不要に変更 |
| R2: `interrupted` から user gesture 待ち復帰 | Step 2-B-1 の `statechange` 購読に user gesture フォールバックを追記 |
| R3: localStorage 永続化の singleton 同期 | Step 3-1 に singleton 初期同期と storage event 連動を追記 |
| R4: コミット粒度を Phase 単位に分割 | ブランチ運用にコミット計画 (C1〜C4) を追加 |
| Q1: dev / 本番の AudioContext 並立 | リスク表に「dev のみの一時事象として許容」と明記 |
| Q2: `SFX_FILES` 内の空文字ガード | Step 2-B-1 `loadSfxBuffer` に空文字 no-op を明記 |
| Q3: mute=true で hidden に入る挙動 | リスク表に「pause + 復帰時 fade 0→0 で意図通り」と明記。テストでも検証 |
| Q4: hard navigation の AudioContext 引継ぎ | 目的セクションに「SPA 遷移前提・hard navigation でも初回 user gesture で再 unlock される」と明記 |
