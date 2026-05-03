"use client";

import { useEffect, useState } from "react";
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

// CardView size="xl" の natural size (内部レイアウトはこの寸法を前提)。
const XL_W = 576;
const XL_H = 352;

// Dialog の固定パラメータ (CardDetailDialog 側の className と一致)
// - mobile (< sm 640px): w = min(vw - 32, max-w-md=448), padding = p-4 (32 total)
// - sm+:                 w = sm:max-w-sm=384, padding = p-4 (32 total)
function computeDialogInnerWidth(vw: number): number {
  if (vw < 640) {
    const dialogW = Math.min(vw - 32, 448);
    return dialogW - 32;
  }
  return 384 - 32;
}

// xl カード (576×352) を Dialog 内側幅に合わせて transform: scale で縮小する。
// container 測定 (clientWidth) は grid auto-track の挙動でうまく行かない
// ケースがあるため、viewport 幅から決定論的に算出する方式に変更。
function ScaledXlCard({ cardId }: { cardId: CardId }) {
  // SSR 安全のため初期値は固定 (≈mobile 想定)。クライアント mount 後に上書き。
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    function compute() {
      const inner = computeDialogInnerWidth(window.innerWidth);
      setScale(Math.min(1, inner / XL_W));
    }
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const visibleW = XL_W * scale;
  const visibleH = XL_H * scale;

  return (
    <div
      className="overflow-hidden mx-auto"
      style={{ width: visibleW, height: visibleH }}
    >
      <div
        style={{
          width: XL_W,
          height: XL_H,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
        }}
      >
        <CardView
          card={{ instanceId: `detail-${cardId}`, defId: cardId }}
          size="xl"
          inactive
        />
      </div>
    </div>
  );
}

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

            {/* 詳細表示用の大判カード。dialog 横幅に合わせて等比縮小。 */}
            <div className="py-2">
              <ScaledXlCard cardId={cardId} />
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
