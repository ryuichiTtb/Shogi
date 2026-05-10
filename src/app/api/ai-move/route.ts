// Issue #176 Phase 1 Stage B: AI 思考専用 Route Handler。
//
// 設計:
// - 純粋計算なので Server Action ではなく Route Handler に切り出し、保存系
//   Server Action との直列化や cold-start 待ち合わせを避ける
// - runtime: nodejs (重い CPU 計算 + Prisma 利用のため Node 必須)
// - maxDuration: 10 秒 (Vercel Hobby 上限 60s に対する余裕大)。
//   Issue #176 timeout-fix で 5→10 に拡大し、cold start spike + Neon DB resume
//   + Prisma init + TT alloc の累積を 5s 以内に詰め込めない問題を解消。
//   内部探索 deadline (engine.ts の timeLimitMs) は最大 3500ms (expert) で、
//   blunder guard 200ms budget と合わせても hard stop 4.0 秒以内に収まる。
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
import { SPECTATOR_TIME_LIMIT_MS } from "@/lib/shogi/ai/strategy";
import { getVariantById } from "@/lib/shogi/variants";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";

export const runtime = "nodejs";
export const maxDuration = 10;

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
  const game = await prisma.game.findUnique({
    where: { id: body.gameId },
    select: { id: true, playerId: true, status: true },
  });
  if (!game) return jsonError(404, "Game not found");
  if (game.playerId !== userId) return jsonError(403, "Forbidden");
  if (game.status !== "active") return jsonError(409, "Game not active");

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
    // PR1a (E-1): 観戦モード時のみ timeLimitMs を SPECTATOR_TIME_LIMIT_MS で短縮。
    // それ以外は既存挙動 (DIFFICULTY_PARAMS[difficulty].timeLimitMs)。
    const result = findBestMoveWithStats(
      body.gameState,
      body.player,
      body.difficulty,
      variant,
      {
        signal: controller.signal,
        timeLimitMs: body.spectatorMode ? SPECTATOR_TIME_LIMIT_MS : undefined,
      },
    );
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
