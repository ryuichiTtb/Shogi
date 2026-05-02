"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PendingCard, CardInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { CardView } from "./card-view";

interface CardPlayDialogProps {
  pendingCard: PendingCard | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// 中央演出 (CardPlayFlight) の xl ベースサイズ
const CARD_W = 576;
const CARD_H = 352;
// 中央演出の 75% で表示し「使用時よりやや小さめ」を担保
const PREVIEW_RATIO = 0.75;

// Hydration 後にのみ Portal を出すための SSR ガード (DrawFlightCard と同方式)
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function CardPlayDialog({ pendingCard, onConfirm, onCancel }: CardPlayDialogProps) {
  // selectTarget フェーズではダイアログを閉じる(盤面でターゲットを選ぶため)
  if (!pendingCard || pendingCard.phase === "selectTarget") return null;
  const def = CARD_DEFS[pendingCard.instance.defId];

  return (
    <>
      <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {def.kind === "trap" ? "トラップをセット" : "カードを使用"} —{" "}
              <span className="text-primary">{def.name}</span>
            </DialogTitle>
            <DialogDescription className="text-sm whitespace-pre-line">
              {`消費マナ: ${def.cost}\n${def.description}`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex-row gap-2 justify-end">
            <Button variant="outline" onClick={onCancel}>
              キャンセル
            </Button>
            <Button onClick={onConfirm}>
              {def.kind === "trap" ? "セットする" : "使用する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Issue #106 修正: ダイアログの上層 (z-[55]) に選択カード本体を重ねる。
        * 効果説明はダイアログ側に書くのでカード上では非表示 (hideDescription)。 */}
      <SelectedCardPreview cardInstance={pendingCard.instance} />
    </>
  );
}

function SelectedCardPreview({ cardInstance }: { cardInstance: CardInstance }) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!isClient) return null;

  // 中央演出と同じビューポートフィット倍率を計算し、PREVIEW_RATIO を掛けて
  // 常に中央演出より一回り小さく見せる。
  const centerScale = Math.min(
    1,
    (window.innerWidth * 0.92) / CARD_W,
    (window.innerHeight * 0.85) / CARD_H,
  );
  const scale = centerScale * PREVIEW_RATIO;
  const scaledW = CARD_W * scale;
  const scaledH = CARD_H * scale;

  return createPortal(
    <div
      className="fixed left-1/2 top-[4%] z-[55] pointer-events-none"
      style={{
        marginLeft: -scaledW / 2,
        width: scaledW,
        height: scaledH,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-8px)",
        transition: "opacity 0.18s ease-out, transform 0.18s ease-out",
      }}
    >
      <div
        className="rounded-md shadow-2xl overflow-hidden"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: CARD_W,
          height: CARD_H,
        }}
      >
        <CardView card={cardInstance} size="xl" fullWidth hideDescription />
      </div>
    </div>,
    document.body,
  );
}

interface CardTargetingNoticeProps {
  pendingCard: PendingCard | null;
  onCancel: () => void;
}

// selectTarget フェーズの時に画面上端に出すバナー
export function CardTargetingNotice({ pendingCard, onCancel }: CardTargetingNoticeProps) {
  if (!pendingCard || pendingCard.phase !== "selectTarget") return null;
  const def = CARD_DEFS[pendingCard.instance.defId];
  const targetText =
    def.targeting === "ownPiece"
      ? "盤面の自分の駒を選んでください"
      : def.targeting === "enemyPiece"
        ? "盤面の相手の駒を選んでください"
        : "盤面のマスを選んでください";

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 bg-amber-500 text-amber-950 px-3 py-2 shadow-md flex items-center gap-2"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      role="status"
    >
      <span className="text-xl shrink-0">🎯</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm">{def.name}</div>
        <div className="text-xs">{targetText}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        中止
      </Button>
    </div>
  );
}
