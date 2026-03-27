"use server";

import { claude } from "@/lib/claude";
import { getCharacterById } from "@/data/characters";
import type { Move, GameState } from "@/lib/shogi/types";

export type CommentaryEvent =
  | "game_start"
  | "good_move"
  | "bad_move"
  | "check"
  | "capture_major"
  | "ai_move"
  | "player_long_think"
  | "game_over_win"
  | "game_over_lose"
  | "promotion";

interface CommentaryContext {
  characterId: string;
  event: CommentaryEvent;
  lastMove?: Move;
  moveCount?: number;
  winner?: string;
}

// キャラクターの台詞を生成
export async function generateComment(
  context: CommentaryContext
): Promise<string> {
  const character = getCharacterById(context.characterId);

  const eventDescriptions: Record<CommentaryEvent, string> = {
    game_start: "対局が始まりました。開始の挨拶をしてください。",
    good_move: "相手（プレイヤー）が良い手を指しました。感心や驚きを表現してください。",
    bad_move: "相手（プレイヤー）がミスをしました。優しくコメントしてください（批判しすぎない）。",
    check: "あなたが王手をかけました。または王手をかけられました。適切に反応してください。",
    capture_major: "大駒（飛車か角）が取られました/取りました。驚きや喜びを表現してください。",
    ai_move: "あなた（AI）が手を指しました。その手について一言コメントしてください。",
    player_long_think: "プレイヤーが長考しています。励ましやヒントを促す一言を言ってください。",
    game_over_win: `あなた（AI）が${context.moveCount}手で勝利しました。`,
    game_over_lose: `あなた（AI）が${context.moveCount}手で負けました。`,
    promotion: "駒が成りました。コメントしてください。",
  };

  const prompt = `${eventDescriptions[context.event]}
返答は1〜2文の短いセリフのみにしてください。かぎかっこや引用符は不要です。`;

  // APIキーが未設定の場合はフォールバックを使用
  if (!claude) {
    return getFallbackComment(context.event, character.id);
  }

  try {
    const message = await claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: character.personality,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === "text") {
      return content.text.trim();
    }
    return getFallbackComment(context.event, character.id);
  } catch {
    return getFallbackComment(context.event, character.id);
  }
}

// APIエラー時のフォールバックコメント
function getFallbackComment(event: CommentaryEvent, characterId: string): string {
  const fallbacks: Record<string, Record<CommentaryEvent, string>> = {
    sakura: {
      game_start: "よろしくお願いします！楽しい将棋にしましょうね！",
      good_move: "わあ、すごい手だね！",
      bad_move: "大丈夫、次があるよ！",
      check: "王手だよ！気をつけてね！",
      capture_major: "大駒が取れた！",
      ai_move: "ふふ、この手どうかな？",
      player_long_think: "どうする？ゆっくり考えていいよ！",
      game_over_win: "やったー！勝てた！また対局しようね！",
      game_over_lose: "負けちゃった...でも楽しかった！",
      promotion: "成った！強くなったよ！",
    },
    musashi: {
      game_start: "いい対局にするぞ。かかってこい。",
      good_move: "ほう...やるじゃないか。",
      bad_move: "そこは違うな。",
      check: "王手だ。どう返す？",
      capture_major: "大駒をもらった。これで有利だな。",
      ai_move: "このくらいどうだ。",
      player_long_think: "考えているか。いい心がけだ。",
      game_over_win: "我の勝ちだ。強くなって出直してこい。",
      game_over_lose: "くっ...負けたか。次は絶対勝つ。",
      promotion: "成りだ。これで戦力が上がった。",
    },
    genno: {
      game_start: "では、一局お願いいたします。",
      good_move: "ふむ、なかなかの一手じゃな。",
      bad_move: "その手は少し早計じゃったかな。",
      check: "王手じゃ。次の一手が肝心じゃぞ。",
      capture_major: "大駒の交換は局面を大きく変えるものじゃ。",
      ai_move: "この手の意味を考えてみるとよいじゃろう。",
      player_long_think: "深く読んでおるな。よい姿勢じゃ。",
      game_over_win: "この一局、学ぶべきことが多かったじゃろう。",
      game_over_lose: "なるほど...見事な一局じゃった。",
      promotion: "成りか。これで駒の働きが変わるの。",
    },
  };

  return (
    fallbacks[characterId]?.[event] ??
    fallbacks.sakura?.[event] ??
    "よろしくお願いします！"
  );
}
