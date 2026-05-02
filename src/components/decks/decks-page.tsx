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
  deleteDeck,
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
  // initialDecks は初期値のみ採用。以後は optimistic 更新と onChanged パッチで
  // ローカル管理する。useEffect で initialDecks に毎回同期すると、
  // router.refresh() の RSC が (エッジ伝播ラグや並行 refresh の race で) stale
  // で返ってきたとき optimistic を打ち消してしまい「使用中ラベルが元に戻る」
  // 不具合の原因になっていた。
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks);

  const [selectedId, setSelectedId] = useState<string | null>(
    initialDecks.find((d) => d.isDefault)?.id ?? initialDecks[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  // 操作失敗を画面下部に表示するためのエラーメッセージ。null=非表示。
  const [actionError, setActionError] = useState<string | null>(null);
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
  // 詳細 fetch 中 / 使用中切替の最中は一覧側の操作を抑止する。
  const isLoadingDetail = selectedId !== null && currentDetail === null;
  const listLocked = isLoadingDetail || pendingDefaultId !== null || draftBusy;

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
      // Optimistic: 一覧に即追加し選択。サーバ側の DB と一致するので追加 sync 不要。
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
    // 入れ替わる)。currentDetail (= 編集エリアの deck) も同期しないと、
    // エディタ側の deck.isDefault が古いままで「削除」ボタン等の活性が
    // 連動しない。サーバーが失敗したら両方 revert + actionError を表示。
    const prevDecks = decks;
    const prevDetail = detail;
    setActionError(null);
    setDecks((prev) => prev.map((d) => ({ ...d, isDefault: d.id === deckId })));
    setDetail((prev) =>
      prev ? { ...prev, isDefault: prev.id === deckId } : prev,
    );
    setPendingDefaultId(deckId);
    try {
      await setDefaultDeck(deckId);
      refresh();
    } catch (e) {
      console.error("setDefaultDeck failed", e);
      setDecks(prevDecks);
      setDetail(prevDetail);
      setActionError(
        e instanceof Error
          ? `使用中の切替に失敗しました: ${e.message}`
          : "使用中の切替に失敗しました。再度お試しください。",
      );
    } finally {
      setPendingDefaultId(null);
    }
  }

  function handleSelectDefault(deckId: string) {
    tryChangeSelection(deckId, true);
  }

  // 削除: 確認後に optimistic で一覧から除去 → 失敗時 revert。
  async function handleDeleteCurrent() {
    if (selectedId === null) return;
    const targetId = selectedId;
    const prevDecks = decks;
    const prevSelectedId = selectedId;
    const prevDetail = detail;
    setActionError(null);
    // 次に選択するデッキ (削除対象を除いた先頭。なければ null)
    const next = prevDecks.find((d) => d.id !== targetId);
    setDecks((p) => p.filter((d) => d.id !== targetId));
    setSelectedId(next?.id ?? null);
    setDetail(null);
    try {
      await deleteDeck(targetId);
      refresh();
    } catch (e) {
      console.error("deleteDeck failed", e);
      setDecks(prevDecks);
      setSelectedId(prevSelectedId);
      setDetail(prevDetail);
      setActionError(
        e instanceof Error
          ? `削除に失敗しました: ${e.message}`
          : "削除に失敗しました。再度お試しください。",
      );
    }
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
            disabled={listLocked}
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
                  // useEffect [initialDecks] による自動 sync を撤去したので、
                  // 編集ペインで保存・rename された結果を decks にも明示的に
                  // パッチする (totalCount / name / isDefault の整合)。
                  setDecks((prev) =>
                    prev.map((d) =>
                      d.id === nextDetail.id
                        ? {
                            ...d,
                            name: nextDetail.name,
                            isDefault: nextDetail.isDefault,
                            totalCount: nextDetail.entries.reduce(
                              (s, e) => s + e.count,
                              0,
                            ),
                          }
                        : d,
                    ),
                  );
                  refresh();
                }}
                onDeleted={handleDeleteCurrent}
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
      {actionError && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[90vw] rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-xs shadow-lg flex items-start gap-2"
          role="alert"
        >
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 underline hover:no-underline"
          >
            閉じる
          </button>
        </div>
      )}
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
