"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { DeckListPane } from "./deck-list-pane";
import { DeckEditorPane } from "./deck-editor-pane";
import { DeckEditorSkeleton } from "./deck-editor-skeleton";
import { ConfirmDialog } from "./confirm-dialog";
import {
  createDeck,
  getDeckDetail,
  setDefaultDeck,
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
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks);
  // サーバ側の更新 (revalidatePath → router.refresh) を取り込む
  useEffect(() => {
    setDecks(initialDecks);
  }, [initialDecks]);

  const [selectedId, setSelectedId] = useState<string | null>(
    initialDecks.find((d) => d.isDefault)?.id ?? initialDecks[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [, startTransition] = useTransition();

  // 新規デッキの草稿。null=非アクティブ、""〜=入力中。
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);

  // 草稿入力中に他デッキを選択した際の確認ダイアログ。
  // makeDefault=true なら「選択」ボタン由来 (確定後に setDefaultDeck も実行)。
  const [pendingSelect, setPendingSelect] = useState<
    { id: string; makeDefault: boolean } | null
  >(null);

  // 「選択」ボタン押下中の deckId (setDefaultDeck 中の連打抑止)
  const [pendingDefaultId, setPendingDefaultId] = useState<string | null>(null);

  // detail が古い (別デッキ選択直後で fetch 未完了) ときは null として扱う。
  const currentDetail = detail && detail.id === selectedId ? detail : null;

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

  function startNew() {
    if (draftName !== null) return;
    setDraftName("");
    setDraftError(null);
  }

  function cancelDraft() {
    setDraftName(null);
    setDraftError(null);
    setDraftBusy(false);
  }

  async function commitDraft() {
    if (draftName === null) return;
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      // 空のまま確定 → 破棄扱い
      cancelDraft();
      return;
    }
    if (trimmed.length > 30) {
      setDraftError("デッキ名は 30 文字以内にしてください");
      return;
    }
    setDraftBusy(true);
    setDraftError(null);
    try {
      const newId = await createDeck(trimmed);
      // Optimistic: 一覧に即追加し選択。サーバ refetch 後に再 sync される。
      setDecks((prev) => [
        ...prev,
        {
          id: newId,
          name: trimmed,
          isDefault: prev.length === 0,
          totalCount: 0,
          createdAt: new Date(),
        },
      ]);
      setSelectedId(newId);
      cancelDraft();
      refresh();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
      setDraftBusy(false);
    }
  }

  // 別デッキ選択ガード: 入力中の草稿があれば確認ダイアログ。
  // makeDefault=true は「選択」ボタン由来 (= 編集選択 + setDefaultDeck)。
  function tryChangeSelection(targetId: string, makeDefault = false) {
    if (draftBusy || pendingDefaultId !== null) return;
    if (draftName !== null && draftName.trim() !== "") {
      setPendingSelect({ id: targetId, makeDefault });
      return;
    }
    if (draftName !== null) cancelDraft();
    applySelection(targetId, makeDefault);
  }

  function applySelection(deckId: string, makeDefault: boolean) {
    setSelectedId(deckId);
    if (makeDefault) void runMakeDefault(deckId);
  }

  function confirmDiscardAndSelect() {
    if (pendingSelect === null) return;
    cancelDraft();
    const { id, makeDefault } = pendingSelect;
    setPendingSelect(null);
    applySelection(id, makeDefault);
  }

  async function runMakeDefault(deckId: string) {
    if (pendingDefaultId !== null) return;
    // Optimistic: 即時に使用中フラグを切替 (UI 上で「使用中 ↔ 選択」が瞬時に
    // 入れ替わる)。サーバーが失敗したら revert。
    const prevDecks = decks;
    setDecks((prev) => prev.map((d) => ({ ...d, isDefault: d.id === deckId })));
    setPendingDefaultId(deckId);
    try {
      await setDefaultDeck(deckId);
      refresh();
    } catch (e) {
      console.error("setDefaultDeck failed", e);
      setDecks(prevDecks);
    } finally {
      setPendingDefaultId(null);
    }
  }

  function handleSelectDefault(deckId: string) {
    tryChangeSelection(deckId, true);
  }

  // 既存デッキ 0 件 & 草稿なしの完全空状態のみ初期画面を出す
  if (decks.length === 0 && draftName === null) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          デッキがまだありません。新規デッキを作成してください。
        </p>
        <Button onClick={startNew}>
          <Plus className="w-4 h-4" />
          新規デッキを作成
        </Button>
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
            draftName={draftName}
            draftError={draftError}
            draftBusy={draftBusy}
            pendingDefaultId={pendingDefaultId}
            onSelect={tryChangeSelection}
            onSelectDefault={handleSelectDefault}
            onRequestNew={startNew}
            onDraftChange={(v) => {
              setDraftName(v);
              setDraftError(null);
            }}
            onDraftCommit={commitDraft}
            onDraftCancel={cancelDraft}
          />
        </div>
        <div className="min-h-0 flex flex-col">
          {/* フレーム自体は常に描画。中身だけを「内容/スケルトン/未選択」で切替。
              これで読み込み中もエリアが消えず、高さもジャンプしない。 */}
          <div className="rounded-lg border bg-card flex flex-col min-h-0 flex-1">
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
            ) : selectedId === null ? (
              <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
                デッキを選択してください
              </div>
            ) : (
              <DeckEditorSkeleton />
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={pendingSelect !== null}
        onOpenChange={(o) => {
          if (!o) setPendingSelect(null);
        }}
        title="未保存の新規デッキを破棄しますか?"
        description={`入力中の「${draftName ?? ""}」は保存されず破棄されます。`}
        confirmLabel="破棄して切替"
        confirmVariant="destructive"
        onConfirm={confirmDiscardAndSelect}
      />
    </>
  );
}
