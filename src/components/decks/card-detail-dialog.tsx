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
import { CHECK_USAGE_INFO, KIND_INFO, RARITY_INFO } from "@/lib/shogi/cards/labels";
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

// 本文スクロール領域のため詳細カードはヘッダに固定。縦幅を抑えるための係数。
const CARD_HEIGHT_FACTOR = 0.85;

// xl カード (576×352) を Dialog 内側幅に合わせて transform: scale で縮小する。
// container 測定 (clientWidth) は grid auto-track の挙動でうまく行かない
// ケースがあるため、viewport 幅から決定論的に算出する方式に変更。
function ScaledXlCard({ cardId }: { cardId: CardId }) {
  // SSR 安全のため初期値は固定 (≈mobile 想定)。クライアント mount 後に上書き。
  const [scale, setScale] = useState(0.5 * CARD_HEIGHT_FACTOR);

  useEffect(() => {
    function compute() {
      const inner = computeDialogInnerWidth(window.innerWidth);
      const raw = Math.min(1, inner / XL_W);
      // 横幅基準の最大 scale から CARD_HEIGHT_FACTOR で縦幅を更に抑制。
      setScale(raw * CARD_HEIGHT_FACTOR);
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

  // 長押しで開いた直後は dialog 内の text 選択を一時的にロックする。
  // 長押し終端で指が dialog 内テキスト上にあると、ブラウザの「単語選択」が
  // 走ってしまうため。300ms 後に解除して通常のテキスト選択 / コピーは可。
  const [selectable, setSelectable] = useState(false);
  useEffect(() => {
    if (cardId === null) {
      setSelectable(false);
      return;
    }
    setSelectable(false);
    // open 起点の意図しない範囲選択をクリア
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    const t = window.setTimeout(() => setSelectable(true), 300);
    return () => window.clearTimeout(t);
  }, [cardId]);

  return (
    <Dialog
      open={cardId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "max-w-md w-[calc(100%-2rem)] max-h-[85vh]",
          // grid + p-4 + gap-4 を上書きし、自前で flex-col + 内側 padding。
          "flex flex-col gap-0 overflow-hidden p-0",
          !selectable && "select-none",
        )}
        style={
          !selectable
            ? {
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              }
            : undefined
        }
      >
        {def && cardId && (
          <>
            {/* ヘッダエリア (固定): タイトル + メタ情報 + 詳細カード */}
            <div className="shrink-0 flex flex-col gap-2 px-4 pt-4 pb-3 border-b">
              {/* X ボタン (top-2 right-2) と被らないよう pr-8 */}
              <DialogTitle className="flex items-center gap-2 flex-wrap pr-8">
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
              <ScaledXlCard cardId={cardId} />
            </div>

            {/* 本文 (スクロール可能): 概要 / 詳細 / 使用条件 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 text-xs">
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
              {/* 王手中の使用可否 (Issue #82) を専用枠で表示。詳細記述内に埋もれさせない。 */}
              <div>
                <div className="font-semibold text-muted-foreground mb-0.5">王手中の使用</div>
                <div className="flex flex-col gap-1">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0 w-fit", CHECK_USAGE_INFO[def.checkUsage].className)}
                  >
                    {CHECK_USAGE_INFO[def.checkUsage].label}
                  </Badge>
                  <p>{CHECK_USAGE_INFO[def.checkUsage].description}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
