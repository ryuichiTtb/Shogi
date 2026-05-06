"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createInitialGameState, serializeGameState, deserializeGameState } from "@/lib/shogi/board";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameConfig, GameState, Move, Player } from "@/lib/shogi/types";
import type { CardGameState } from "@/lib/shogi/cards/types";
import {
  createInitialCardState,
  serializeCardState,
  deserializeCardState,
  type DeckSpec,
} from "@/lib/shogi/cards/state";
import { ensureDefaultUser } from "@/lib/auth/default-user";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

// card-shogi variant 用: ユーザーのデフォルトデッキから DeckSpec を取得
async function loadDeckSpecForUser(userId: string): Promise<DeckSpec[]> {
  const deck = await prisma.deck.findFirst({
    where: { userId, isDefault: true },
    include: { entries: true },
  });
  if (!deck) {
    throw new Error(`No default deck found for user ${userId}. Run "npx prisma db seed".`);
  }
  // Issue #117 (#128): 以下 2 種を初期デッキから除外。除外しないと
  // (a) deprecated カード: 効果ロジックが消えており playCard で例外
  // (b) orphan カード (CARD_DEFS に居ない: 例 check_break): CardView 描画時に
  //     `CARD_DEFS[defId]` が undefined → `def.rarity` で NPE → 対局画面クラッシュ
  return deck.entries
    .filter((e) => {
      const def = CARD_DEFS[e.cardId as DeckSpec["defId"]];
      // orphan は弾く
      if (!def) return false;
      // deprecated は弾く
      if (def.status === "deprecated") return false;
      return true;
    })
    .map((e) => ({
      defId: e.cardId as DeckSpec["defId"],
      count: e.count,
    }));
}

// 新規ゲームを作成
export async function createGame(
  difficulty: Difficulty,
  playerColor: Player,
  characterId: string,
  variantId: string = "standard"
): Promise<string> {
  const user = await ensureDefaultUser();
  const variant = getVariantById(variantId);
  const initialState = createInitialGameState(variant);

  // variant（関数を含む）はシリアライズ不可なのでIDのみ保存
  const serializableConfig = {
    variantId,
    difficulty,
    playerColor,
    characterId,
    soundEnabled: true,
    commentaryEnabled: true,
  };

  // card-shogi variant の場合は cardState を初期化
  let initialCardState: unknown = undefined;
  if (variantId === "card-shogi") {
    const deckSpec: DeckSpec[] = await loadDeckSpecForUser(user.id);
    const cardState = createInitialCardState(deckSpec);
    initialCardState = serializeCardState(cardState);
  }

  const game = await prisma.game.create({
    data: {
      playerId: user.id,
      playerColor,
      difficulty,
      variantId,
      characterId,
      status: "active",
      boardState: serializeGameState(initialState),
      gameConfig: serializableConfig,
      cardState: initialCardState as never,
    },
  });

  return game.id;
}

// ゲームを取得
export async function getGame(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      moves: {
        orderBy: { moveNum: "asc" },
      },
    },
  });

  if (!game) return null;

  const stored = game.gameConfig as {
    variantId: string;
    difficulty: Difficulty;
    playerColor: Player;
    characterId: string;
    soundEnabled: boolean;
    commentaryEnabled: boolean;
  };
  const gameConfig: GameConfig = {
    variant: getVariantById(stored.variantId ?? game.variantId),
    difficulty: stored.difficulty ?? (game.difficulty as Difficulty),
    playerColor: stored.playerColor ?? (game.playerColor as Player),
    characterId: stored.characterId ?? game.characterId,
    soundEnabled: stored.soundEnabled ?? true,
    commentaryEnabled: stored.commentaryEnabled ?? true,
  };

  // card-shogi variant のとき cardState を復元
  let cardState: CardGameState | null = null;
  if (game.variantId === "card-shogi" && game.cardState) {
    cardState = deserializeCardState(game.cardState);
  }

  return {
    ...game,
    boardState: deserializeGameState(game.boardState),
    gameConfig,
    cardState,
  };
}

// 手を保存してゲーム状態を更新 (standard variant)
export async function saveMove(
  gameId: string,
  move: Move,
  newBoardState: GameState,
  notation: string,
  moveNum: number,
  comment?: string
): Promise<void> {
  await prisma.$transaction([
    prisma.gameMove.create({
      data: {
        gameId,
        moveNum,
        player: move.player,
        moveData: move as object,
        notation,
        comment,
      },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: {
        boardState: serializeGameState(newBoardState),
        status: newBoardState.status,
        winner: newBoardState.winner,
      },
    }),
  ]);

  revalidatePath(`/game/${gameId}`);
}

// 手を保存してゲーム状態を更新 (card-shogi variant、cardState も同時保存)
//
// Issue #132: 待った後に新しい手を指した時の (gameId, moveNum) ユニーク制約衝突を防ぐ。
// `@@unique([gameId, moveNum])` 制約により、UNDO 後の moveNum で create するとそのまま
// では衝突 (旧分岐の手が同 moveNum で残っていれば INSERT エラー)。
// `undoCardShogiGameState` で先に削除すれば衝突しないが、UNDO 経由でない別フロー
// (DB 直書き等) や race のため、`gameMove >= moveNum` を予防的に deleteMany してから
// create する。同 transaction 内で実行することで原子性も担保。
export async function saveCardShogiMove(
  gameId: string,
  move: Move,
  newBoardState: GameState,
  newCardState: CardGameState,
  notation: string,
  moveNum: number,
  comment?: string
): Promise<void> {
  await prisma.$transaction([
    // 防御: 新しい手と同 moveNum 以降の旧分岐 GameMove を先に削除。
    // 通常は 0 件で空振り。UNDO 後の再分岐保存時のみ実行コストあり (該当行のみ)。
    prisma.gameMove.deleteMany({
      where: { gameId, moveNum: { gte: moveNum } },
    }),
    prisma.gameMove.create({
      data: {
        gameId,
        moveNum,
        player: move.player,
        moveData: move as object,
        notation,
        comment,
      },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: {
        boardState: serializeGameState(newBoardState),
        cardState: serializeCardState(newCardState) as never,
        status: newBoardState.status,
        winner: newBoardState.winner,
      },
    }),
  ]);

  revalidatePath(`/game/${gameId}`);
}

// Issue #132: カード使用 / ドロー / トラップ設置直後の cardState 即時保存。
// `saveCardShogiMove` は moveCount 増加を契機に発火するが、カード操作は
// moveCount を増やさないため、カード使用直後にリロードするとカード効果が
// 失われる (DB はカード使用前の cardState のまま)。
// 本アクションは GameMove を insert せず、Game.boardState / cardState / status の
// 現在値だけを永続化する。後続の `saveCardShogiMove` は通常通り発火するが、
// それまでのリロード安全性が確保される。
export async function persistCardShogiState(
  gameId: string,
  newBoardState: GameState,
  newCardState: CardGameState,
): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: {
      boardState: serializeGameState(newBoardState),
      cardState: serializeCardState(newCardState) as never,
      status: newBoardState.status,
      winner: newBoardState.winner,
    },
  });
  revalidatePath(`/game/${gameId}`);
}

// Issue #132: 待った後の DB 局面巻き戻し。
// クライアント側 reducer の UNDO 完了後に呼び、DB 上の Game.boardState / Game.cardState を
// 巻き戻った state に上書きする。同時に、巻き戻し位置より後の GameMove 行を削除して
// 棋譜分岐の不整合を防ぐ (= UNDO 後に新しい手を指した時、(gameId, moveNum) ユニーク制約に
// 衝突しないよう古い行を掃除しておく)。
//
// 旧実装ではこの処理が存在せず、画面と DB の状態が乖離 → リロード後に巻き戻し前の局面が
// 復元される / 新しい手の保存が無音失敗する事象が発生していた。
//
// transaction で原子化しているため部分書き込みは発生しない。失敗時は呼び元で catch する想定。
export async function undoCardShogiGameState(
  gameId: string,
  newBoardState: GameState,
  newCardState: CardGameState,
  newMoveCount: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.gameMove.deleteMany({
      where: { gameId, moveNum: { gt: newMoveCount } },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: {
        boardState: serializeGameState(newBoardState),
        cardState: serializeCardState(newCardState) as never,
        status: newBoardState.status,
        winner: newBoardState.winner,
      },
    }),
  ]);

  revalidatePath(`/game/${gameId}`);
  revalidatePath("/history");
}

// ゲーム状態を更新（投了など）
//
// Issue #155: 本関数は Game.status のみ更新し boardState は触らないため、
// 投了など「復元時に終局画面で開かれてほしい」終局種別では本関数ではなく
// saveResign / saveCardShogiResign を使う必要がある (boardState の status も
// 同時更新する責務を持たせる)。本関数は従来通り「status のみ更新」のシナリオ
// (復元時に boardState 側に既に書かれている場合等) で使用する。
export async function updateGameStatus(
  gameId: string,
  status: string,
  winner?: string
): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: { status, winner },
  });

  revalidatePath(`/game/${gameId}`);
  revalidatePath("/history");
}

// Issue #155: 投了時に Game.boardState (JSON) も "resign" 状態で保存する
// 専用 Server Action (standard variant 用)。
//
// updateGameStatus との違い: Game.status だけでなく boardState の中身も同時更新
// する。これにより履歴復元時の `deserializeGameState(boardState)` が
// status: "resign" を返し、対局画面が「終局済」として正しく開く。
//
// 旧フローは updateGameStatus を fire-and-forget で呼ぶ + boardState を更新
// しない実装で、(a) 復元時に「途中対局」として開く (b) ナビゲーション直後の
// race で履歴一覧の status が古いまま見える、という二重の問題を抱えていた。
// 本関数は呼び元で必ず await し、両方を解決する。
export async function saveResign(
  gameId: string,
  newBoardState: GameState,
  winner: string,
): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: {
      boardState: serializeGameState(newBoardState),
      status: "resign",
      winner,
    },
  });
  revalidatePath(`/game/${gameId}`);
  revalidatePath("/history");
}

// Issue #155: card-shogi variant 用の投了保存。
// boardState に加え cardState も終局時点で保存することで、復元時に手札・マナ・
// トラップ状況も終局時点の状態で開ける。
export async function saveCardShogiResign(
  gameId: string,
  newBoardState: GameState,
  newCardState: CardGameState,
  winner: string,
): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: {
      boardState: serializeGameState(newBoardState),
      cardState: serializeCardState(newCardState) as never,
      status: "resign",
      winner,
    },
  });
  revalidatePath(`/game/${gameId}`);
  revalidatePath("/history");
}

// 対局履歴を取得
export async function getGameHistory() {
  const user = await ensureDefaultUser();

  const games = await prisma.game.findMany({
    where: { playerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return games;
}
