"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { DeckListPane } from "./deck-list-pane";
import { DeckEditorPane } from "./deck-editor-pane";
import { NewDeckDialog } from "./new-deck-dialog";
import {
  createDeck,
  getDeckDetail,
  type DeckDetail,
  type DeckSummary,
  type OwnedCardSummary,
} from "@/app/actions/deck";

interface DecksPageProps {
  initialDecks: DeckSummary[];
  ownedCards: OwnedCardSummary[];
}

export function DecksPage({ initialDecks, ownedCards }: DecksPageProps) {
  const router = useRouter();
  const [decks] = useState<DeckSummary[]>(initialDecks);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialDecks.find((d) => d.isDefault)?.id ?? initialDecks[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [, startTransition] = useTransition();

  // detail が古い (別デッキ選択直後で fetch 未完了) ときは null として扱う。
  // これで「detail を effect で同期クリア」する必要がなくなる。
  const currentDetail = detail && detail.id === selectedId ? detail : null;
  const loadingDetail = selectedId !== null && currentDetail === null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    getDeckDetail(selectedId).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleCreate(name: string) {
    const id = await createDeck(name);
    setShowNewDialog(false);
    setSelectedId(id);
    refresh();
  }

  if (decks.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          デッキがまだありません。新規デッキを作成してください。
        </p>
        <Button onClick={() => setShowNewDialog(true)}>
          <Plus className="w-4 h-4" />
          新規デッキを作成
        </Button>
        <NewDeckDialog
          open={showNewDialog}
          onOpenChange={setShowNewDialog}
          onSubmit={handleCreate}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 sm:gap-4">
        <div className="min-h-0 flex flex-col">
          <DeckListPane
            decks={decks}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRequestNew={() => setShowNewDialog(true)}
          />
        </div>
        <div className="min-h-0 flex flex-col">
          {selectedId && currentDetail ? (
            <DeckEditorPane
              key={selectedId}
              deck={currentDetail}
              ownedCards={ownedCards}
              isOnlyDeck={decks.length <= 1}
              onChanged={(nextDetail) => {
                setDetail(nextDetail);
                refresh();
              }}
              onDeleted={() => {
                const next = decks.find((d) => d.id !== selectedId);
                setSelectedId(next?.id ?? null);
                refresh();
              }}
            />
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
              {loadingDetail ? "読み込み中..." : "デッキを選択してください"}
            </div>
          )}
        </div>
      </div>
      <NewDeckDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSubmit={handleCreate}
      />
    </>
  );
}
