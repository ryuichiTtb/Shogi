// Issue #155: ローディングマスクのステージ文言を一元管理する。
// 各画面のローディング体験を統一し、文言が画面間で散らばってメンテ性が低下するのを
// 防ぐ。新しいローディング箇所を追加するときも、まずここに stages を定義してから
// 各画面で参照する流れにする。
//
// stages は LoadingOverlay (loading-overlay.tsx) の `stages` props に渡し、
// stageIntervalMs (既定 1200ms) ごとにフェード切替で順送り表示される。

export const LOADING_STAGES = {
  // デッキ編成: 保存中 (DB 検証 → 送信 → 反映までを擬似的に分割表示)
  deckSaving: ["デッキ構成を検証中…", "サーバへ送信中…", "反映中…"],
  // デッキ編成: 初期ロード (Skeleton 中)
  deckLoading: ["デッキを読み込み中…"],
  // カードカタログ: 詳細遷移
  cardDetail: ["カード詳細を読み込み中…"],
  // ホームの「対局相手選ぶ」遷移後 (MatchSetup)
  matchSetup: ["対局を準備中…", "AI を初期化中…", "盤面をセットアップ中…"],
  // ホーム → カード将棋対局画面の遷移
  matchNavigate: ["対局画面を開いています…", "盤面を準備中…"],
  // ホーム → 通常将棋対局画面の遷移
  classicNavigate: ["通常将棋を開いています…", "盤面を準備中…"],
  // ホーム → 履歴一覧の遷移
  historyNavigate: ["履歴を読み込んでいます…"],
  // ホーム → デッキ編成画面の遷移
  decksNavigate: ["デッキ編成を開いています…"],
  // ホーム → カード一覧の遷移
  cardsNavigate: ["カード一覧を開いています…"],
  // ホーム → カードデザイン画面の遷移
  cardDesignNavigate: ["カードデザインを開いています…"],
  // 汎用フォールバック (resolveStages で個別のキーが見つからない場合)
  defaultNavigate: ["読み込み中…"],
  // 履歴 → /game/[id] の SSR 復元中 (棋譜デシリアライズ・盤面再構築・演出準備)
  gameRestore: ["棋譜を読み込み中…", "盤面を再構築中…", "演出を準備中…"],
} as const;

export type LoadingStageKey = keyof typeof LOADING_STAGES;
