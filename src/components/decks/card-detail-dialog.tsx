"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

// 親コンテナ幅に合わせて transform: scale で xl カードを縮小して描画する。
// fullWidth で width だけ変えると内部要素 (アイコン/テキスト/コスト) が
// xl 想定のまま残り横にあふれてしまうため、scale で全体を等比縮小する。
function ScaledXlCard({ cardId }: { cardId: CardId }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // 初期表示で正しい scale を反映するため layoutEffect で同期計算。
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setScale(Math.min(1, el.clientWidth / XL_W));
  }, []);

  // 後続のリサイズ (画面回転 / dialog 表示) にも追従。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / XL_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden"
      style={{ height: XL_H * scale }}
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
