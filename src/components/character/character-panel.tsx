"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { SpeechBubble } from "./speech-bubble";
import { generateComment } from "@/app/actions/commentary";
import type { Character } from "@/data/characters";
import type { CommentaryEvent } from "@/app/actions/commentary";

interface CharacterPanelProps {
  character: Character;
  commentEvent: CommentaryEvent | null;
  isAiThinking: boolean;
  className?: string;
}

const COLOR_MAP: Record<string, string> = {
  pink: "from-pink-100 to-pink-50 border-pink-200",
  blue: "from-blue-100 to-blue-50 border-blue-200",
  amber: "from-amber-100 to-amber-50 border-amber-200",
};

export function CharacterPanel({
  character,
  commentEvent,
  isAiThinking,
  className,
}: CharacterPanelProps) {
  const [currentComment, setCurrentComment] = useState<string>("");
  const [isCommentVisible, setIsCommentVisible] = useState(false);

  const fetchComment = useCallback(
    async (event: CommentaryEvent) => {
      try {
        const comment = await generateComment({
          characterId: character.id,
          event,
        });
        setCurrentComment(comment);
        setIsCommentVisible(true);

        // 5秒後に非表示
        setTimeout(() => setIsCommentVisible(false), 5000);
      } catch {
        // エラー時は何もしない
      }
    },
    [character.id]
  );

  useEffect(() => {
    if (commentEvent) {
      fetchComment(commentEvent);
    }
  }, [commentEvent, fetchComment]);

  const gradientClass = COLOR_MAP[character.color] ?? COLOR_MAP.amber;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {/* キャラクターアバター */}
      <div
        className={cn(
          "relative w-20 h-20 rounded-full border-2 bg-gradient-to-b flex items-center justify-center",
          "shadow-md",
          gradientClass
        )}
      >
        <span className="text-4xl">{character.avatarEmoji}</span>

        {/* 思考中インジケータ */}
        {isAiThinking && (
          <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
          </div>
        )}
      </div>

      {/* キャラクター名 */}
      <div className="text-center">
        <p className="font-bold text-sm">{character.name}</p>
        <p className="text-xs text-muted-foreground">{character.title}</p>
      </div>

      {/* 吹き出し */}
      <div className="relative min-h-8">
        <SpeechBubble
          text={currentComment}
          isVisible={isCommentVisible}
        />
      </div>
    </div>
  );
}
