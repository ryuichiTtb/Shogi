"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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
// プレビューカードと dialog 上端の隙間
const CARD_GAP = 12;

// Hydration 後にのみ正確な viewport サイズで配置するための SSR ガード
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function CardPlayDialog({ pendingCard, onConfirm, onCancel }: CardPlayDialogProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  // selectTarget フェーズではダイアログを閉じる(盤面でターゲットを選ぶため)
  if (!pendingCard || pendingCard.phase === "selectTarget") return null;
  const def = CARD_DEFS[pendingCard.instance.defId];

  // viewport にフィットするスケール (CardPlayFlight と同方式) を計算し、
  // PREVIEW_RATIO を掛けて常に中央演出より一回り小さく見せる
  const centerScale = isClient
    ? Math.min(
        1,
        (window.innerWidth * 0.92) / CARD_W,
        (window.innerHeight * 0.85) / CARD_H,
      )
    : 1;
  const scale = centerScale * PREVIEW_RATIO;
  const scaledW = CARD_W * scale;
  const scaledH = CARD_H * scale;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-md"
        style={
          isClient
            ? {
                // Issue #106 修正: カード + ダイアログ全体の重心を画面中央に
                // 揃えるため、ダイアログ中心を「viewport 中央 + (カード高さ
                // + gap) / 2」に配置する。
                // shadcn の DialogContent は translate-y(-50%) で要素の中央
                // が top の位置に来るため、この補正だけでダイアログ高さに
                // 依存せず常に中央に揃う。
                top: `calc(50% + ${(scaledH + CARD_GAP) / 2}px)`,
              }
            : undefined
        }
      >
        {/* 選択カードプレビュー: DialogContent の上端のすぐ上に絶対配置 */}
        {isClient && (
          <SelectedCardPreview
            cardInstance={pendingCard.instance}
            scale={scale}
            scaledW={scaledW}
            scaledH={scaledH}
          />
        )}

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
  );
}

function SelectedCardPreview({
  cardInstance,
  scale,
  scaledW,
  scaledH,
}: {
  cardInstance: CardInstance;
  scale: number;
  scaledW: number;
  scaledH: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: "100%",
        marginBottom: CARD_GAP,
        width: scaledW,
        height: scaledH,
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(-8px)",
        transition: "opacity 0.18s ease-out, transform 0.18s ease-out",
        pointerEvents: "none",
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
    </div>
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
