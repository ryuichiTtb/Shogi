// カード将棋の演出関連で使用される時間・寸法の集約定義。
// 各演出ファイル冒頭に散在していた数値を移管。
// 名前衝突回避のため、用途別に DRAW_*, PLAY_*, PIECE_*, MANA_FLIGHT_*,
// FAST_MOVE_*, MANA_GAUGE_* のプレフィクスを付与する。

// ===== Draw Flight (draw-flight-card.tsx) =====
// 山札 → 中央 → 手札 のドロー演出。
// CardView size="xl" の素サイズ (w-[36rem]=576, h-[22rem]=352)。
export const DRAW_CARD_W = 576;
export const DRAW_CARD_H = 352;
export const DRAW_FADE_IN_MS = 500;
export const DRAW_HOLD_MS = 1500;
export const DRAW_FADE_OUT_MS = 300;
export const DRAW_TOTAL_MS = DRAW_FADE_IN_MS + DRAW_HOLD_MS + DRAW_FADE_OUT_MS;
// Issue #82: 中央→手札の最終 100ms で一気にフェードアウト。
export const DRAW_FADE_OUT_TAIL_MS = 100;
// 中央到着直後にカード上を斜めに走るシマー (光) と黄金グロウ。
export const DRAW_FLASH_DELAY_S = DRAW_FADE_IN_MS / 1000;
export const DRAW_SHIMMER_DURATION_S = 0.7;
export const DRAW_GLOW_DURATION_S = 0.8;

// ===== Card Play Flight (card-play-flight.tsx) =====
// Issue #106 (修正後): 中央にパッと出現してキラッと光る短時間演出。
// 素サイズは DrawFlightCard と揃える。
export const PLAY_CARD_W = 576;
export const PLAY_CARD_H = 352;
export const PLAY_POP_IN_MS = 220;
export const PLAY_HOLD_MS = 700;
export const PLAY_FADE_OUT_MS = 320;
export const PLAY_TOTAL_MS = PLAY_POP_IN_MS + PLAY_HOLD_MS + PLAY_FADE_OUT_MS;
export const PLAY_FLASH_DELAY_S = PLAY_POP_IN_MS / 1000;
export const PLAY_SHIMMER_DURATION_S = 0.6;
export const PLAY_GLOW_DURATION_S = 0.75;

// ===== Piece Flight (piece-flight.tsx) =====
// Issue #82: カード使用後の駒移動演出。回転しながら from → to へ移動。
// 本番経路では呼び出し側で pieceSize={squareSize} を渡し、駒サイズを盤上の
// マスサイズに合わせる (PIECE_SIZE はフォールバック既定値 / dev 検証ページの
// 初期値として使用)。
export const PIECE_SIZE = 84;
// 移動速度 (px/sec)。dev /piece-flight で検証して 2000 を採用 (2026-05-04)。
export const PIECE_SPEED_PX_PER_SEC = 2000;
// 回転周期 (sec/回転)。dev 検証で 0.3 sec/turn ≈ 3.3 回転/秒 を採用 (2026-05-04)。
export const PIECE_ROTATION_SEC_PER_TURN = 0.3;
// 距離 0 付近でも瞬時にならないよう最小 duration を確保。
// dev 検証で 600ms を採用 (短距離でも視認性 + 回転量 1.5 周分が確保される)。
export const PIECE_MIN_DURATION_MS = 600;
// 保険タイマーの余裕
export const PIECE_FALLBACK_PADDING_MS = 500;

// ===== Mana Flight (mana-flight.tsx) =====
// マナ増減のフロート表示 (💎+N / 💎-N)。
export const MANA_FLIGHT_DURATION_S = 1.1;
export const MANA_FLIGHT_FLOAT_DISTANCE_PX = 60;
export const MANA_FLIGHT_BOX_W = 200;
export const MANA_FLIGHT_BOX_H = 56;

// ===== Fast Move Badge (fast-move-badge.tsx) =====
// 「早指し」ピル表示。
export const FAST_MOVE_DURATION_S = 1.0;
export const FAST_MOVE_BOX_W = 160;
export const FAST_MOVE_BOX_H = 48;
// 駒下端からの余白 (マナ +N の浮遊と被らないよう少し下に配置)
export const FAST_MOVE_OFFSET_BELOW_PIECE_PX = 4;

// ===== Mana Gauge (mana-gauge.tsx) =====
// マナ増減セグメントのフェード時間。
export const MANA_GAUGE_SEGMENT_DURATION_S = 2.4;

// ===== Auto Draw Ceremony (#130) =====
// 経過手数による自動ドロー専用の演出パラメータ。
// 既存 manual draw (DRAW_*) とは色味・前段 (Burst+Trail) が異なる。
export const AUTO_DRAW_BURST_DURATION_MS = 450;
export const AUTO_DRAW_TRAIL_DURATION_MS = 280;
export const AUTO_DRAW_RING_COLLAPSE_MS = 280;
// primed パルスの周期と最大ループ数 (= 1.4s × 6 = 8.4s でフォールバック停止)
export const AUTO_DRAW_PRIMED_PULSE_S = 1.4;
export const AUTO_DRAW_PRIMED_MAX_LOOPS = 6;
// リング進捗の補間時間 (stroke-dashoffset の transition)
export const AUTO_DRAW_RING_TRANSITION_MS = 320;
// firing → 0/5 復帰までの余韻時間
export const AUTO_DRAW_COOLDOWN_MS = 600;

// 演出フェーズ別の開始オフセット (ms)。AutoDrawBurst.tsx はこの object のみを参照し、
// 内部に ms リテラルを書かない。テンポ調整時はここだけ編集する。
// Phase 0 = reducer の prev=4 && next=0 検知 + displayProgress を 1 frame だけ
// 強制 5 にして「リング満タン」を 1 frame 描画する。
export const AUTO_DRAW_PHASE_OFFSETS = {
  ringCollapse: 16,    // Phase 1: リング崩壊開始
  burst: 96,           // Phase 2: 粒子バースト開始 (16 + 80)
  trail: 216,          // Phase 3: 中央へのトレイル開始 (16 + 200)
  cardFlight: 366,     // Phase 4: DrawFlightCard fade-in 開始 (16 + 350)
  cardHold: 866,       // Phase 5: 中央保持 開始 (16 + 850)
  cardFadeOut: 2366,   // Phase 6: 手札へのフェードアウト開始 (16 + 2350)
  cooldown: 2666,      // Phase 7: 演出全体終了 (= AUTO_DRAW_TOTAL_MS の同値)
} as const;
// 命名重複の防止 (二重メンテバグ回避): TOTAL_MS は cooldown の alias 再エクスポート。
export const AUTO_DRAW_TOTAL_MS = AUTO_DRAW_PHASE_OFFSETS.cooldown;
