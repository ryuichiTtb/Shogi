// Issue #217: 対局生成専用の軽量 Route Handler。
//
// 背景: 「もう一局」は従来 `/game/[id]` ページに紐づく Server Action
// (createGame) を呼んでいた。この関数はページ UI ツリー全体 (AI エンジン /
// Prisma 等) を含む巨大なサーバーレス関数に同梱され、対局中は一度も呼ばれず
// 冷えきっている。Vercel Hobby/Preview でこの巨大関数の cold start が 503 +
// リトライを繰り返し、計測上クリック→関数到達まで約4分かかっていた
// (DB・Clerk・応答は全て無実、リクエストが関数に到達していなかった)。
//
// 対策: 対局中に正常動作している `/api/ai-move` と同じく、対局生成も独立した
// 軽量 Route Handler に切り出す。ページ巨大関数の cold start を経由しなくなる。
// 認証は createGame 内の getCurrentAppUser() に集約済 (Server Action と同一経路)。

import { NextResponse, type NextRequest } from "next/server";
import { createGame } from "@/app/actions/game";
import type { Difficulty, Player } from "@/lib/shogi/types";

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

interface CreateGameRequestBody {
  difficulty: Difficulty;
  playerColor: Player;
  characterId: string;
  variantId?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateGameRequestBody;
  try {
    body = (await request.json()) as CreateGameRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { difficulty, playerColor, characterId, variantId } = body;
  const resolvedVariantId = variantId ?? "standard";
  if (
    !VALID_DIFFICULTIES.has(difficulty) ||
    !VALID_PLAYERS.has(playerColor) ||
    typeof characterId !== "string" ||
    characterId.length === 0 ||
    !VALID_VARIANT_IDS.has(resolvedVariantId)
  ) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  try {
    const gameId = await createGame(
      difficulty,
      playerColor,
      characterId,
      resolvedVariantId,
    );
    return NextResponse.json({ gameId });
  } catch (e) {
    console.error("create-game route failed", e);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
