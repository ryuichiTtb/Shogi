"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { cn } from "@/lib/utils";
import { STATUS_INFO } from "@/lib/shogi/cards/labels";
import type { CardDefinition } from "@/lib/shogi/cards/types";

interface CardCatalogTileProps {
  def: CardDefinition;
}

// マスターカタログ一覧の各タイル。
// CardView (md, fullWidth) で実ゲームと同じカード見た目を表示し、
// 上部にステータスバッジを重ねる。クリックで /cards/[id] 詳細へ遷移。
export function CardCatalogTile({ def }: CardCatalogTileProps) {
  const router = useRouter();
  const statusInfo = STATUS_INFO[def.status];

  return (
    <div className="relative">
      <CardView
        card={{ instanceId: `catalog-${def.id}`, defId: def.id }}
        size="md"
        fullWidth
        onClick={() => router.push(`/cards/${def.id}`)}
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
  );
}
