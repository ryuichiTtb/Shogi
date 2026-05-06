"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { LoadingOverlay } from "@/components/loading-overlay";
import { LOADING_STAGES } from "@/lib/loading-stages";
import { cn } from "@/lib/utils";
import { STATUS_INFO } from "@/lib/shogi/cards/labels";
import type { CardDefinition } from "@/lib/shogi/cards/types";

interface CardCatalogTileProps {
  def: CardDefinition;
}

// マスターカタログ一覧の各タイル。
// CardView (md, fullWidth) で実ゲームと同じカード見た目を表示し、
// 上部にステータスバッジを重ねる。クリックで /cards/[id] 詳細へ遷移。
//
// Step S2 (Issue #107): クリックから遷移完了までは画面全体を覆う LoadingOverlay
// を出す。useTransition で router.push の非同期遷移を pending として捕捉し、
// 連打防止 + 体感のもたつき解消。
export function CardCatalogTile({ def }: CardCatalogTileProps) {
  const router = useRouter();
  const statusInfo = STATUS_INFO[def.status];
  const [isPending, startTransition] = useTransition();
  const [navigating, setNavigating] = useState(false);

  const handleClick = useCallback(() => {
    if (navigating) return;
    setNavigating(true);
    startTransition(() => {
      router.push(`/cards/${def.id}`);
    });
  }, [navigating, router, def.id]);

  return (
    <>
      <div className="relative">
        <CardView
          card={{ instanceId: `catalog-${def.id}`, defId: def.id }}
          size="md"
          fullWidth
          onClick={handleClick}
          disabled={navigating}
        />
        <Badge
          variant="outline"
          className={cn(
            "absolute -top-2 -right-1 text-[10px] px-1.5 py-0 leading-tight border-2 pointer-events-none shadow-sm",
            statusInfo.className,
          )}
        >
          {statusInfo.label}
        </Badge>
      </div>
      <LoadingOverlay
        show={navigating || isPending}
        fullScreen
        card={{ cardId: def.id }}
        stages={LOADING_STAGES.cardDetail}
        progress={{ kind: "indeterminate" }}
      />
    </>
  );
}
