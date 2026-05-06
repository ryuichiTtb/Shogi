"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Save } from "lucide-react";
import {
  saveDeckEntries,
  type DeckDetail,
  type DeckEntrySummary,
  type OwnedCardSummary,
} from "@/app/actions/deck";
import {
  DECK_TOTAL_MAX,
  RARITY_MAX_PER_DECK,
  countByRarity,
  validateDeckEntries,
  type CardOwnershipInfo,
} from "@/lib/shogi/cards/deck-rules";
import { RARITY_INFO } from "@/lib/shogi/cards/labels";
import type { CardId, CardRarity } from "@/lib/shogi/cards/types";
import { OwnedCardPicker } from "./owned-card-picker";
import { DeckCardTile, type DeckArea } from "./deck-card-tile";
import { DeckFlightLayer, type DeckFlightItem } from "./deck-flight-layer";
import { CardDetailDialog } from "./card-detail-dialog";
import { LoadingOverlay } from "@/components/loading-overlay";
import { LOADING_STAGES } from "@/lib/loading-stages";

interface DeckFlight extends DeckFlightItem {
  // 行先タイル (deck 側のとき) の identity。フライト中に重ねる元タイルを
  // ghost (透明) にして、二重表示を防ぐために使う。
  destArea: DeckArea;
  destInstanceKey: number;
}

interface DeckEditorPaneProps {
  deck: DeckDetail;
  ownedCards: OwnedCardSummary[];
  onChanged: (next: DeckDetail) => void;
  // Issue #155: 保存中状態を親 (DecksPage) へ通知する。
  // 親は editorSaving を listLocked と「ホームへ戻る」disabled に連携させる。
  onSavingChange?: (saving: boolean) => void;
}

export function DeckEditorPane({
  deck,
  ownedCards,
  onChanged,
  onSavingChange,
}: DeckEditorPaneProps) {
  const [entries, setEntries] = useState<DeckEntrySummary[]>(deck.entries);
  // タイルごとに stable な slot ID を持たせる。クリックされたタイル自身が
  // 取り除かれることで、後続タイルが layout アニメーションで詰める動きになる。
  // entries (cardId, count) の DB 形と並走させて、保存時は count に集約する。
  const slotCounterRef = useRef(0);
  const [slotIdsByCard, setSlotIdsByCard] = useState<Map<CardId, number[]>>(
    () => buildSlotIdsFromEntries(deck.entries, slotCounterRef),
  );
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  // Issue #155: 保存中フラグを親 (DecksPage) に伝え、デッキ一覧操作・「ホームへ
  // 戻る」リンクの操作ブロックを連動させる。useTransition の isPending が変化した
  // タイミングのみ通知し、レンダリング毎に呼ばないようにする (関数参照が安定なので
  // setState ループの懸念もなし)。
  useEffect(() => {
    onSavingChange?.(isPending);
  }, [isPending, onSavingChange]);
  // 長押しで開くカード詳細 dialog。null=非表示。
  const [detailCardId, setDetailCardId] = useState<CardId | null>(null);
  const handleLongPressDetail = useCallback((cardId: CardId) => {
    setDetailCardId(cardId);
  }, []);

  const ownership = useMemo(() => {
    const m = new Map<CardId, CardOwnershipInfo>();
    for (const o of ownedCards) {
      m.set(o.cardId, { rarity: o.rarity, owned: o.owned });
    }
    return m;
  }, [ownedCards]);

  const validation = useMemo(
    () => validateDeckEntries(entries, ownership),
    [entries, ownership],
  );

  const rarityCounts = useMemo(
    () => countByRarity(entries, ownership),
    [entries, ownership],
  );

  const dirty = useMemo(() => {
    if (entries.length !== deck.entries.length) return true;
    const map = new Map(deck.entries.map((e) => [e.cardId, e.count]));
    for (const e of entries) {
      if (map.get(e.cardId) !== e.count) return true;
    }
    return false;
  }, [entries, deck.entries]);

  function handleSave() {
    setActionError(null);
    startTransition(async () => {
      try {
        await saveDeckEntries(deck.id, entries);
        onChanged({ ...deck, entries, totalCount: validation.totalCount });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // 編成中の各 cardId の現在枚数 (UI 用)
  const currentCountByCard = useMemo(() => {
    const m = new Map<CardId, number>();
    for (const e of entries) m.set(e.cardId, e.count);
    return m;
  }, [entries]);

  // -------------------- フライト演出 --------------------
  const [flights, setFlights] = useState<DeckFlight[]>([]);
  const flightIdRef = useRef(0);

  const handleFlightComplete = useCallback((id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // フライト中の deck タイルは ghost (透明) にして重複表示を避ける。
  const ghostedDeckTiles = useMemo(() => {
    const s = new Set<string>();
    for (const f of flights) {
      if (f.destArea === "deck") {
        s.add(`${f.cardId}:${f.destInstanceKey}`);
      }
    }
    return s;
  }, [flights]);

  function findTileRect(
    area: DeckArea,
    cardId: CardId,
    instanceKey: number | "single",
  ): DOMRect | null {
    const sel = `[data-deck-area="${area}"][data-card-id="${cardId}"][data-instance-key="${instanceKey}"]`;
    const el = document.querySelector(sel) as HTMLElement | null;
    return el ? el.getBoundingClientRect() : null;
  }

  // 所持エリアでカードクリック → 編成エリアへ追加
  const handleAddFromOwned = useCallback(
    (cardId: CardId, fromRect: DOMRect) => {
      if (isPending) return;
      const info = ownership.get(cardId);
      if (!info) return;

      // 追加可否を事前判定 (所持枚数 / レア度合計 / デッキ合計 の3壁)
      const currentEntry = entries.find((e) => e.cardId === cardId);
      const currentForCard = currentEntry?.count ?? 0;
      if (currentForCard >= info.owned) return;
      const cap = RARITY_MAX_PER_DECK[info.rarity];
      if (cap !== null) {
        let rarityTotal = 0;
        for (const e of entries) {
          const ei = ownership.get(e.cardId);
          if (ei?.rarity === info.rarity) rarityTotal += e.count;
        }
        if (rarityTotal >= cap) return;
      }
      let total = 0;
      for (const e of entries) total += e.count;
      if (total >= DECK_TOTAL_MAX) return;

      // 新スロット ID を発行 (= 新タイルの安定 key)
      const newSlotId = ++slotCounterRef.current;
      const destInstanceKey = newSlotId;

      // state を同期更新 → DOM 反映後に行先 rect を測定
      flushSync(() => {
        setEntries((prev) => {
          const idx = prev.findIndex((e) => e.cardId === cardId);
          if (idx === -1) return [...prev, { cardId, count: 1 }];
          const next = [...prev];
          next[idx] = { ...next[idx], count: next[idx].count + 1 };
          return next;
        });
        setSlotIdsByCard((prev) => {
          const next = new Map(prev);
          next.set(cardId, [...(next.get(cardId) ?? []), newSlotId]);
          return next;
        });
      });

      // 新タイルが画面外 (= 編成エリアが overflow している) ならスクロールして
      // 可視範囲に収める。block:"nearest" で必要な分だけスクロール、
      // behavior:"instant" でこの後の rect 測定に間に合わせる。
      const newTile = document.querySelector(
        `[data-deck-area="deck"][data-card-id="${cardId}"][data-instance-key="${destInstanceKey}"]`,
      ) as HTMLElement | null;
      newTile?.scrollIntoView({ block: "nearest", behavior: "instant" });

      const toRect = findTileRect("deck", cardId, destInstanceKey);
      if (!toRect) return;
      setFlights((prev) => [
        ...prev,
        {
          id: ++flightIdRef.current,
          cardId,
          fromRect,
          toRect,
          destArea: "deck",
          destInstanceKey,
        },
      ]);
    },
    [entries, isPending, ownership],
  );

  // 編成エリアでカードクリック → 所持エリアへ戻す
  const handleRemoveFromDeck = useCallback(
    (cardId: CardId, slotId: number, fromRect: DOMRect) => {
      if (isPending) return;
      // 所持タイルは state 変更前後ともに DOM 上に存在するので先に測定。
      // フィルタにより該当カードが非表示の場合はタイルが存在しないので、
      // 所持パネル中央へのフォールバックを使う (適当な位置に飛ばすだけで OK)。
      let toRect = findTileRect("owned", cardId, "single");
      if (!toRect) {
        const pane = document.querySelector(
          '[data-deck-pane="owned"]',
        ) as HTMLElement | null;
        if (pane) {
          const r = pane.getBoundingClientRect();
          const w = fromRect.width;
          const h = fromRect.height;
          toRect = new DOMRect(
            r.left + (r.width - w) / 2,
            r.top + (r.height - h) / 2,
            w,
            h,
          );
        }
      }

      // 後続タイルの layout アニメーションを発火させるため、クリックされた
      // slotId 自体を slotIdsByCard から除去する (末尾を消すのではなく)。
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.cardId === cardId);
        if (idx === -1) return prev;
        const newCount = prev[idx].count - 1;
        if (newCount <= 0) {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        }
        const next = [...prev];
        next[idx] = { ...next[idx], count: newCount };
        return next;
      });
      setSlotIdsByCard((prev) => {
        const slots = prev.get(cardId);
        if (!slots) return prev;
        const filtered = slots.filter((s) => s !== slotId);
        const next = new Map(prev);
        if (filtered.length === 0) {
          next.delete(cardId);
        } else {
          next.set(cardId, filtered);
        }
        return next;
      });

      if (!toRect) return;
      setFlights((prev) => [
        ...prev,
        {
          id: ++flightIdRef.current,
          cardId,
          fromRect,
          toRect,
          destArea: "owned",
          destInstanceKey: 0,
        },
      ]);
    },
    [isPending],
  );

  return (
    // 親 (DecksPage) が DeckEditorFrame でフレームを提供するので、ここでは
    // フラグメントで内側 (header / body / dialog) のみ返す。
    // デッキ名・rename・削除はデッキ一覧側 (DeckListPane) で管理する。
    <>
      {/* ヘッダ:
          1 行目: 保存 / 変更を破棄 / エラー
          2 行目: レア度別の編成枚数 (合計はここからは外し、左セクション
                   ヘッダに移動) */}
      <div className="p-3 border-b flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || !dirty || !validation.ok}
          >
            <Save className="w-3.5 h-3.5" />
            {isPending ? "保存中..." : dirty ? "保存" : "保存済み"}
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEntries(deck.entries);
                setSlotIdsByCard(buildSlotIdsFromEntries(deck.entries, slotCounterRef));
                setActionError(null);
              }}
              disabled={isPending}
            >
              変更を破棄
            </Button>
          )}
          {/* 縦幅ジャンプを避けるためボタン横に inline 表示。長文は truncate
              + title でホバー全文表示。複数エラーは " / " で連結。 */}
          {(() => {
            const msgs = [
              ...validation.errors,
              ...(actionError ? [actionError] : []),
            ];
            if (msgs.length === 0) return null;
            const text = msgs.join(" / ");
            return (
              <p
                className="text-xs text-destructive min-w-0 flex-1 truncate"
                title={text}
              >
                {text}
              </p>
            );
          })()}
        </div>

        <DeckSummaryBar rarityCounts={rarityCounts} />
      </div>

      {/* 本体: 現在のデッキ + 所持カード (モバイルでも左右 2 分割) */}
      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x">
        {/* 現在のデッキ */}
        <section className="flex flex-col min-h-0">
          <header className="p-2 border-b shrink-0">
            {/* タイトル位置に合計枚数を表示 (旧:「現在のデッキ (N 種 / N 枚)」)。 */}
            <h3
              className={cn(
                "text-xs font-semibold tabular-nums",
                validation.totalCount > DECK_TOTAL_MAX && "text-destructive",
              )}
            >
              合計 {validation.totalCount} / {DECK_TOTAL_MAX} 枚
            </h3>
            {/* モバイル限定の長押しヒント (改行で表示)。
                蛍光グリーン+太字で目を引かせる。 */}
            <p className="lg:hidden font-bold text-lime-600 dark:text-lime-400 text-[10px] mt-0.5">
              💡 カード長押しで詳細表示
            </p>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                右の所持カードをクリックして追加してください
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 lg:gap-3 pb-2">
                {entries.flatMap((e) => {
                  const slots = slotIdsByCard.get(e.cardId) ?? [];
                  return slots.map((slotId) => (
                    <DeckCardTile
                      key={`${e.cardId}-slot-${slotId}`}
                      instanceKey={slotId}
                      cardId={e.cardId}
                      area="deck"
                      ghosted={ghostedDeckTiles.has(`${e.cardId}:${slotId}`)}
                      disabled={isPending}
                      onClick={(rect) =>
                        handleRemoveFromDeck(e.cardId, slotId, rect)
                      }
                      onLongPress={handleLongPressDetail}
                      title="クリックで編成から外す / 長押しで詳細"
                    />
                  ));
                })}
              </div>
            )}
          </div>
        </section>

        {/* 所持カード */}
        <section className="flex flex-col min-h-0">
          <OwnedCardPicker
            ownedCards={ownedCards}
            currentCountByCard={currentCountByCard}
            rarityCounts={rarityCounts}
            totalCount={validation.totalCount}
            disabled={isPending}
            onAdd={handleAddFromOwned}
            onLongPress={handleLongPressDetail}
          />
        </section>
      </div>

      <DeckFlightLayer flights={flights} onComplete={handleFlightComplete} />

      <CardDetailDialog
        cardId={detailCardId}
        onClose={() => setDetailCardId(null)}
      />

      {/* 保存中ローディングマスク。
          親 (DecksPage の編集枠 div) に position:relative が付与されているため
          absolute で枠内のみを覆う。fullScreen=false で枠サイズに収まる。
          コンテキストカードは「直前にプレビューしたカード > 編成1番目 > 汎用」の
          優先順位で選び、保存対象のカードイメージを中央で回転させる。 */}
      <LoadingOverlay
        show={isPending}
        card={
          detailCardId
            ? { cardId: detailCardId }
            : entries[0]?.cardId
              ? { cardId: entries[0].cardId }
              : { variant: "generic" }
        }
        stages={LOADING_STAGES.deckSaving}
        progress={{ kind: "indeterminate" }}
      />
    </>
  );
}

// entries (DB 形: cardId × count) から slotId 列を生成。slotCounterRef を
// 進めて返るので、以後の追加で発行される slotId と衝突しない。
function buildSlotIdsFromEntries(
  entries: DeckEntrySummary[],
  counterRef: { current: number },
): Map<CardId, number[]> {
  const m = new Map<CardId, number[]>();
  for (const e of entries) {
    const slots: number[] = [];
    for (let i = 0; i < e.count; i++) slots.push(++counterRef.current);
    m.set(e.cardId, slots);
  }
  return m;
}

interface DeckSummaryBarProps {
  rarityCounts: Record<CardRarity, number>;
}

// レア度別編成枚数のみを表示。合計はデッキセクションヘッダ側で表示する。
function DeckSummaryBar({ rarityCounts }: DeckSummaryBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {(["common", "rare", "super_rare", "epic"] as CardRarity[]).map((r) => {
        const count = rarityCounts[r];
        const cap = RARITY_MAX_PER_DECK[r];
        const over = cap !== null && count > cap;
        return (
          <span
            key={r}
            className={cn(
              "tabular-nums",
              over ? "text-destructive font-semibold" : "text-muted-foreground",
            )}
          >
            {RARITY_INFO[r].label}: {count}
            {cap !== null && `/${cap}`}
          </span>
        );
      })}
    </div>
  );
}
