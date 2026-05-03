"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { KIND_INFO, RARITY_INFO } from "@/lib/shogi/cards/labels";
import { cn } from "@/lib/utils";
import type { CardId } from "@/lib/shogi/cards/types";

interface CardDetailDialogProps {
  cardId: CardId | null;
  onClose: () => void;
}

// モバイル長押し時に表示するカード詳細。CardView の本来の見た目 +
// detailDescription / useConditionDescription / メタ情報を併記する。
export function CardDetailDialog({ cardId, onClose }: CardDetailDialogProps) {
  const def = cardId ? CARD_DEFS[cardId] : null;
  return (
    <Dialog
      open={cardId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md w-[calc(100%-2rem)] max-h-[85vh] overflow-y-auto">
        {def && cardId && (
          <>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="text-base">{def.icon}</span>
              <span>{def.name}</span>
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0", RARITY_INFO[def.rarity].className)}
              >
                {RARITY_INFO[def.rarity].label}
              </Badge>
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0", KIND_INFO[def.kind].className)}
              >
                {KIND_INFO[def.kind].label}
              </Badge>
            </DialogTitle>

            {/* 詳細表示用の大判カード。fullWidth + size="xl" で横幅は dialog
                内側いっぱい、高さは xl 相当 (h-[22rem])。 */}
            <div className="py-2">
              <CardView
                card={{ instanceId: `detail-${cardId}`, defId: cardId }}
                size="xl"
                fullWidth
                inactive
              />
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="font-semibold text-muted-foreground mb-0.5">概要</div>
                <p>{def.description}</p>
              </div>
              {def.detailDescription && (
                <div>
                  <div className="font-semibold text-muted-foreground mb-0.5">詳細</div>
                  <p className="whitespace-pre-line">{def.detailDescription}</p>
                </div>
              )}
              {def.useConditionDescription && (
                <div>
                  <div className="font-semibold text-muted-foreground mb-0.5">使用条件</div>
                  <p className="whitespace-pre-line">{def.useConditionDescription}</p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
