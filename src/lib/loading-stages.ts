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
  // 各画面 → ホーム (/) への戻り遷移 (Issue #163)
  homeNavigate: ["ホームへ戻っています…"],
  // 対局終了画面の「もう一局」 (createGame Server Action 後 router.push)。
  // matchSetup と分けることで、ロビーから新規開始ではなく「次の対局」感を出す。
  matchRestart: ["次の対局を準備中…", "盤面をセットアップ中…"],
  // ログインボタン → Clerk OAuth ホストへの外部リダイレクト
  signIn: ["ログイン画面へ移動中…", "認証サービスに接続中…"],
  // 汎用フォールバック (resolveStages で個別のキーが見つからない場合)
  defaultNavigate: ["読み込み中…"],
  // 履歴 → /game/[id] の SSR 復元中 (棋譜デシリアライズ・盤面再構築・演出準備)
  gameRestore: ["棋譜を読み込み中…", "盤面を再構築中…", "演出を準備中…"],
  // ホーム → 開発者ツール一覧 (/dev) の遷移
  devNavigate: ["開発者ツールを開いています…"],
  // /dev → /dev/piece-flight (駒フライト調整)
  devPieceFlightNavigate: [
    "駒フライト調整を開いています…",
    "パラメータを読み込み中…",
  ],
  // /dev → /dev/sound-tuner (音源調整ツール一覧)
  devSoundTunerNavigate: [
    "音源調整ツールを開いています…",
    "音源プールを読み込み中…",
  ],
  // /dev/sound-tuner → /dev/sound-tuner/[eventKey] (個別音源調整)
  devSoundTunerDetailNavigate: [
    "個別音源調整を開いています…",
    "音源プールを読み込み中…",
  ],
  // /dev → /dev/card-shogi-layout (カード将棋レイアウト検証)
  devCardShogiLayoutNavigate: ["レイアウト検証を開いています…"],
  // /dev → /dev/loading-preview (ローディング演出プレビュー)
  devLoadingPreviewNavigate: ["ローディング演出プレビューを開いています…"],
} as const;

export type LoadingStageKey = keyof typeof LOADING_STAGES;

// Issue #163: <Link href> クリック時の遷移マスク stages を href から自動解決するヘルパー。
// MaskedLink および app/page.tsx の navigateTo から共通利用する。
// /cards/{id} のような動的 segment は cardDetail を返す (前方一致で判定)。
// /dev 配下は dev ツール毎に専用 stages を返す (前方一致で判定)。
export function resolveLoadingStages(href: string): readonly string[] {
  if (href === "/") return LOADING_STAGES.homeNavigate;
  if (href === "/play") return LOADING_STAGES.matchNavigate;
  if (href === "/classic") return LOADING_STAGES.classicNavigate;
  if (href === "/history") return LOADING_STAGES.historyNavigate;
  if (href === "/decks") return LOADING_STAGES.decksNavigate;
  if (href === "/cards") return LOADING_STAGES.cardsNavigate;
  if (href.startsWith("/cards/")) return LOADING_STAGES.cardDetail;
  if (href === "/card-design") return LOADING_STAGES.cardDesignNavigate;
  // /dev 配下 (Issue #79 統合): 各 dev ツールへの forward 遷移用 stages
  if (href === "/dev") return LOADING_STAGES.devNavigate;
  if (href === "/dev/piece-flight") return LOADING_STAGES.devPieceFlightNavigate;
  if (href === "/dev/sound-tuner") return LOADING_STAGES.devSoundTunerNavigate;
  if (href.startsWith("/dev/sound-tuner/"))
    return LOADING_STAGES.devSoundTunerDetailNavigate;
  if (href === "/dev/card-shogi-layout")
    return LOADING_STAGES.devCardShogiLayoutNavigate;
  if (href === "/dev/loading-preview")
    return LOADING_STAGES.devLoadingPreviewNavigate;
  return LOADING_STAGES.defaultNavigate;
}
