// Issue #176 Phase 1 Stage B: AI 思考専用 Route Handler。
//
// 設計:
// - 純粋計算なので Server Action ではなく Route Handler に切り出し、保存系
//   Server Action との直列化や cold-start 待ち合わせを避ける
// - runtime: nodejs (重い CPU 計算 + Prisma 利用のため Node 必須)
// - maxDuration: 10 秒 (Vercel Hobby 上限 60s に対する余裕大)。
//   Issue #176 timeout-fix で 5→10 に拡大し、cold start spike + Neon DB resume
//   + Prisma init + TT alloc の累積を 5s 以内に詰め込めない問題を解消。
//   内部探索 deadline (engine.ts の timeLimitMs) は最大 3500ms (expert)。
//   Issue #235 派生 (2026-06-10 Vercel 504 対策): deep search 後の root アクション評価
//   フェーズ (カード/ドロー lookahead + double_move super-action) は従来 unbounded で、
//   終盤の高分岐局面で 10s を超過し FUNCTION_INVOCATION_TIMEOUT が発生していた。
//   ACTION_PHASE_BUDGET_RATIO (engine.ts、timeLimitMs × 0.4 = expert 1400ms) で hard bound し、
//   最悪総時間 ≈ deep 3.5s + アクション評価 1.4s + blunder guard 0.2s ≈ 5.1s に収まる
//   (maxDuration 10s に対し約 2 倍の安全余裕)。
//   Vercel Pro upgrade 後 (Issue #190) は 15〜30s に再調整可。
// - request.signal を SearchContext.signal に伝播し、client abort (待った /
//   終局 / unmount) を即時に探索へ伝える
// - 同 user × gameId の多重 request は in-memory map で抑制 (新 request 到着
//   時に既存を abort)。Vercel 複数 instance では完全な排他にならないが、
//   instance ローカルの safety net として機能する
// - session は既存 helper getCurrentAppUser() を再利用 (Server Action と
//   同一経路)。Clerk 直叩きと混在させず、guest cookie 経路も同 helper 経由

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAppUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { findBestMoveWithStats } from "@/lib/shogi/ai/engine";
// Issue #245 Preview 配線: 学習 NN の呼出カウンタ (silent fallback 検知)。infer.ts は production 探索
// 経路 (evalLeafWorld) が既に import 済ゆえ新規バンドル増なし。1.67MB 重み JSON は preview-model の
// 動的 import 側にのみ含まれ、本 import には含まれない。
import { getInferenceCount, resetInferenceCount } from "@/lib/shogi/ai/learned/infer";
// Issue #245 派生 (エンジン選択): env × request engine の実効判定 (純関数、production 無回帰を test で pin)。
import { resolveWantsLearned } from "./engine-flags";
// Issue #193 / PR1c-2 Phase B: SPECTATOR_TIME_LIMIT_MS import 削除。
// engine 内で createStrategy({ spectator }) 経由で Strategy 構築時に Math.min override 処理される。
import { getVariantById } from "@/lib/shogi/variants";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";

export const runtime = "nodejs";
export const maxDuration = 10;

// Issue #245 Preview 実機検証 配線 (計画 docs/plans/issue-245-preview-playtest-wiring.md)。
// env ENABLE_LEARNED_EVAL=1 を設定した Vercel Preview デプロイでのみ、AI が学習評価 (NN) の world
// 単一木で指す (useTurnActionSearch + useLearnedEval 両 ON)。**未設定 (= production/main の既定) は
// 両フラグ未伝播 = worldPathActive=false (engine.ts) = 従来 bolt-on 経路でバイト不変**。Vercel は
// per-environment env ゆえ Preview のみ設定 → production 環境は影響ゼロ。可逆 (env 削除 or 本行削除)。
// ★効くのは card-shogi + cardState 供給時のみ (world 経路の前提、M1 M-2)。standard 将棋は従来どおり。
const LEARNED_EVAL_ENABLED = process.env.ENABLE_LEARNED_EVAL === "1";

const VALID_DIFFICULTIES = new Set<Difficulty>([
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);
const VALID_PLAYERS = new Set<Player>(["sente", "gote"]);
const VALID_VARIANT_IDS = new Set<string>(["standard", "card-shogi"]);
const MAX_PAYLOAD_BYTES = 100 * 1024;

interface AiMoveRequestBody {
  gameId: string;
  requestId: string;
  gameState: GameState;
  player: Player;
  difficulty: Difficulty;
  variantId: string;
  clientMoveCount: number;
  // PR1a (E-2): cardState は optional。PR1a では受け取るだけで使わない (silent ignore)。
  // 不正な構造でも 400 にはせず、cardState なし扱いとして扱う。深い検証は PR1d で導入。
  cardState?: CardGameState;
  // PR1a (E-1): CPU vs CPU 観戦モード。client 側 (useCardShogiGame) で両プレイヤー
  // それぞれに正しい difficulty / spectatorMode を渡す前提で、route 側は spectatorMode
  // フラグを受け取り timeLimitMs を SPECTATOR_TIME_LIMIT_MS で短縮する。
  spectatorMode?: boolean;
  // Issue #245 派生 (検証デバッグ): CPU エンジン選択。resolveWantsLearned が env と合成して実効を
  // 決める (env OFF=production では値に依らず bolt-on 固定)。不正値は undefined (silent ignore 流儀)。
  engine?: "legacy" | "learned";
}

// 同 user × gameId の探索を 1 本に制限する。新 request 到着で既存を abort。
const inFlightRequests = new Map<string, AbortController>();

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function validateBody(raw: unknown): AiMoveRequestBody | null {
  if (!isObject(raw)) return null;
  if (typeof raw.gameId !== "string" || raw.gameId.length === 0 || raw.gameId.length > 100) return null;
  if (typeof raw.requestId !== "string" || raw.requestId.length === 0 || raw.requestId.length > 100) return null;
  if (typeof raw.player !== "string" || !VALID_PLAYERS.has(raw.player as Player)) return null;
  if (typeof raw.difficulty !== "string" || !VALID_DIFFICULTIES.has(raw.difficulty as Difficulty)) return null;
  if (typeof raw.variantId !== "string" || !VALID_VARIANT_IDS.has(raw.variantId)) return null;
  if (typeof raw.clientMoveCount !== "number" || !Number.isFinite(raw.clientMoveCount) || raw.clientMoveCount < 0) return null;
  if (!isObject(raw.gameState)) return null;
  const gs = raw.gameState;
  if (!Array.isArray(gs.board)) return null;
  if (!isObject(gs.hand)) return null;
  if (typeof gs.currentPlayer !== "string" || !VALID_PLAYERS.has(gs.currentPlayer as Player)) return null;
  if (typeof gs.moveCount !== "number") return null;
  if (typeof gs.status !== "string") return null;

  // PR1a (E-2): cardState は浅い検査のみで silent ignore。型不一致 / 構造欠落でも
  // 400 返却せず undefined として扱う (= cardState なしリクエストと同等)。
  // 深い検証は PR1d 着手時に src/lib/shogi/cards/validate.ts で zod-like に整備し、
  // 不正時は 400 返却に格上げする。
  const cardState =
    raw.cardState !== undefined && isObject(raw.cardState)
      ? (raw.cardState as unknown as CardGameState)
      : undefined;

  // PR1a (E-1): spectatorMode は boolean のみ許容、それ以外は false 扱い (silent ignore)。
  const spectatorMode = raw.spectatorMode === true;

  // Issue #245 派生: engine は "legacy"/"learned" のみ許容、それ以外 undefined (silent ignore 流儀)。
  const engine =
    raw.engine === "legacy" || raw.engine === "learned" ? raw.engine : undefined;

  return {
    gameId: raw.gameId as string,
    requestId: raw.requestId as string,
    gameState: raw.gameState as unknown as GameState,
    player: raw.player as Player,
    difficulty: raw.difficulty as Difficulty,
    variantId: raw.variantId as string,
    clientMoveCount: raw.clientMoveCount as number,
    cardState,
    spectatorMode,
    engine,
  };
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ---- Origin チェック (CSRF 対策、同一 origin のみ受け付ける) ----
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return jsonError(403, "Forbidden origin");
      }
    } catch {
      return jsonError(400, "Invalid origin header");
    }
  }

  // ---- Content-Type / Content-Length 検証 ----
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonError(415, "Unsupported Media Type");
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > MAX_PAYLOAD_BYTES) {
      return jsonError(413, "Payload too large");
    }
  }

  // ---- JSON parse + 構造検証 ----
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }
  const body = validateBody(raw);
  if (!body) {
    return jsonError(400, "Invalid request body");
  }

  // ---- session ----
  let userId: string;
  try {
    const user = await getCurrentAppUser();
    userId = user.id;
  } catch {
    return jsonError(401, "Unauthorized");
  }

  // ---- 所有者 + active 確認 (最小 DB read) ----
  // Issue #193 / PR1a (E-1): 観戦モード (CPU vs CPU) は揮発モードのため Game レコードが
  // DB に存在しない。spectatorMode=true の場合は DB lookup と所有者検証をスキップする
  // (gameId は "spectator-{uuid}" 形式の揮発 ID)。
  // セキュリティ: 観戦モードは DB 書き込みなしのため悪用リスクは AI 計算リソース消費のみ。
  // 1 ユーザー 1 観戦のレートリミットは next.config.mjs で別途実装予定 (進行中チェックリスト)。
  // 認証 (userId 取得) は前段で完了済のため、ログインユーザーのみ観戦可能。
  if (!body.spectatorMode) {
    const game = await prisma.game.findUnique({
      where: { id: body.gameId },
      select: { id: true, playerId: true, status: true },
    });
    if (!game) return jsonError(404, "Game not found");
    if (game.playerId !== userId) return jsonError(403, "Forbidden");
    if (game.status !== "active") return jsonError(409, "Game not active");
  }

  // ---- 多重 request 抑制 ----
  const flightKey = `${userId}:${body.gameId}`;
  const prev = inFlightRequests.get(flightKey);
  if (prev) prev.abort();
  const controller = new AbortController();
  inFlightRequests.set(flightKey, controller);

  // request.signal (client が fetch を abort) も SearchContext へ伝播。
  const onClientAbort = () => controller.abort();
  request.signal.addEventListener("abort", onClientAbort);

  try {
    const variant = getVariantById(body.variantId);
    // Issue #245 派生 (エンジン選択): env が master switch、request の engine="legacy" で旧版へ。
    // env OFF (production) では engine が何であれ false = bolt-on 固定 (バイト不変、engine-flags.ts)。
    const wantsLearned = resolveWantsLearned(LEARNED_EVAL_ENABLED, body.engine);
    // Issue #245 Preview 配線: 学習脳を 1 回ロード (動的 import ゆえ production=本ブロック非実行=
    // preview-model + 1.67MB 重み JSON は本番 cold-start に一切載らず完全隔離)。ロード成否は
    // preview-model 内で console.info、この手の NN 呼出は下記 getInferenceCount で検知 (M1 M-1)。
    // legacy 選択時もロード自体不要 (useLearnedEval OFF で NN 分岐しない)。
    if (wantsLearned) {
      const { ensureLearnedModelLoaded } = await import("@/lib/shogi/ai/learned/preview-model");
      ensureLearnedModelLoaded();
      resetInferenceCount();
    }
    // PR1a (E-1): 観戦モード時のみ timeLimitMs を SPECTATOR_TIME_LIMIT_MS で短縮。
    // それ以外は既存挙動 (DIFFICULTY_PARAMS[difficulty].timeLimitMs)。
    const result = findBestMoveWithStats(
      body.gameState,
      body.player,
      body.difficulty,
      variant,
      {
        signal: controller.signal,
        // Issue #193 / PR1c-2 Phase B (MM-1 反映): timeLimitMs 経路から spectator フラグ経由に切替。
        // engine 内で createStrategy(difficulty, { spectator }) で Strategy 構築時に
        // Math.min(base, SPECTATOR_TIME_LIMIT_MS) で短縮処理される。
        spectator: body.spectatorMode,
        // Issue #193 / PR1d-1 (ZZ-2 反映): cardState を engine に正式伝播。
        // engine 内で options.cardState !== undefined && variant.id === "card-shogi"
        // のとき root で computeCardDigest を呼び、SearchContext 経由で子ノードに伝播 (W-1)。
        // 上位 L88-91 で silent ignore (PR1a E-2) されているため undefined or 不正値を
        // 渡しても安全 (undefined → cardDigest 計算 skip → 既存挙動完全保持)。
        // 深い zod-like 検証 (型不一致時 400 返却) は PR1d-2/3/4 のいずれかで
        // `src/lib/shogi/cards/validate.ts` 新規追加時に格上げ予定。
        cardState: body.cardState,
        // Issue #235 S1d (cutover): production AI 探索を L0 カーネル applyTurnAction 経由に切替
        // (root カード/ドロー評価を単一権威カーネルへ統一、DP-1〜7 適用)。engine 既定は OFF のままで
        // production 入口の本 route のみ明示 ON にする (案B = default 依存 test/bench の baseline を不変に保つ)。
        // rollback は本行削除のみ。探索は仮想局面評価のため kernel 内で spectatorMode=true 固定 (search.ts、決定論化)。
        useKernelSearch: true,
        // Issue #235 S4e: WorldState 単一木の production 活性化 (`useTurnActionSearch:true`) は
        // **取消 (revert、2026-06-14)**。理由: 活性化後の実機確認で AI が **engagement 下駄
        // (S4d-5、決定A の card 使用促進) により無駄なカード使用を多発** (序盤の過剰ドロー / タダで
        // 取られる位置への歩打ち / 打った歩を次手番で駒戻し = カード・手番の浪費) させ、改悪と判明。
        // 根本原因: engagement の bounded-loss tie-break が「margin 内なら毎ターン card を採用」する
        // ため、depth 限定で card の無駄 (tempo 損・浪費) を見切れない局面で purposeless な card 使用を
        // 強制していた。**カードを「使わせる」forcing は誤りで、カードを「使いたくなる」= 正しい
        // 評価で merit ベースに使わせるのが本筋**。production は安定版 (bolt-on、eval バグ修正は D-5 で
        // 反映済) に戻す。engagement 撤去 + card 評価の本格改善後に再活性化を検討する (本行再追加)。
        //
        // Issue #245 Preview 配線: wantsLearned (env ON + engine!=="legacy") 時のみ world 単一木 +
        // 学習 NN を有効化 (検証用トグル)。false の既定は `undefined` = 未伝播 = worldPathActive
        // false = 上記 bolt-on 経路で不変 (production / legacy 選択時)。
        // 効くのは card-shogi + cardState 供給時のみ (M1 M-2、standard は worldPathActive false)。
        useTurnActionSearch: wantsLearned || undefined,
        useLearnedEval: wantsLearned || undefined,
      },
    );
    // Issue #245 Preview 配線 (M1 M-1): この手で NN が実際に呼ばれたかをログ。0 なら学習脳が効かず
    // 人手 eval へ silent fallback = 「検証したつもり」の空振り (baseline と同挙動)。Vercel Function
    // ログで確認できるようにする (wantsLearned 時のみ = production / legacy 選択では非実行)。
    // 派生 (二手指し診断): bestAction 種別 + doubleMove ペア有無も出し、「エンジンが dm を選んだか・
    // 実行ペアが搬送されたか」を実機 1 局のログで確定できるようにする。
    if (wantsLearned) {
      const nnCalls = getInferenceCount();
      const actionDesc =
        result.action === null
          ? "null"
          : result.action.kind === "playCard"
            ? `playCard:${result.action.defId}`
            : result.action.kind;
      if (nnCalls === 0) {
        console.warn(
          "[learned-eval] ⚠️ NN 呼出 0 = 学習脳が効いていない (人手 eval へ silent fallback)。" +
            "モデルロード失敗 / standard variant / cardState 未供給 のいずれかを確認。",
        );
      } else {
        console.info(
          `[learned-eval] NN 呼出 ${nnCalls} 回 (この手, difficulty=${body.difficulty}, ` +
            `action=${actionDesc}, dmMoves=${result.doubleMove ? "有" : "無"}, depth=${result.stats.depthCompleted})。`,
        );
      }
    }
    // client abort の場合は 499 相当だが、Next.js では client がもう listen して
    // いないので status は意味を持たない。fallback で 200 を返す。
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-move] search error", err);
    return jsonError(500, "Search failed");
  } finally {
    request.signal.removeEventListener("abort", onClientAbort);
    if (inFlightRequests.get(flightKey) === controller) {
      inFlightRequests.delete(flightKey);
    }
  }
}
