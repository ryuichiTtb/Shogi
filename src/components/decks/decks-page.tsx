"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeckListPane } from "./deck-list-pane";
import { DeckEditorPane } from "./deck-editor-pane";
import { DeckEditorSkeleton } from "./deck-editor-skeleton";
import { ConfirmDialog } from "./confirm-dialog";
import {
  createDeck,
  deleteDeck,
  getDeckDetail,
  renameDeck,
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

  // モバイル用デッキピッカー (Dialog) の開閉。
  const [pickerOpen, setPickerOpen] = useState(false);

  // 一覧 row のインライン rename。null=非アクティブ。
  const [renameTarget, setRenameTarget] = useState<
    { id: string; value: string; error: string | null; busy: boolean } | null
  >(null);

  // 一覧 row の削除確認ダイアログ。null=非表示。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // detail が古い (別デッキ選択直後で fetch 未完了) ときは null として扱う。
  const currentDetail = detail && detail.id === selectedId ? detail : null;
  // 詳細 fetch 中 / 使用中切替の最中は一覧側の操作を抑止する。
  const isLoadingDetail = selectedId !== null && currentDetail === null;
  const listLocked =
    isLoadingDetail ||
    pendingDefaultId !== null ||
    draftBusy ||
    renameTarget?.busy === true;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    // Issue #117 (#128): Server Action 失敗を unhandled rejection にしないため
    // 明示的に catch + actionError 表示。ローディング状態に張り付きを防ぐ。
    getDeckDetail(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("getDeckDetail failed", e);
        setActionError(
          e instanceof Error
            ? `デッキの読み込みに失敗しました: ${e.message}`
            : "デッキの読み込みに失敗しました。再度お試しください。",
        );
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
      // モバイル: 新規作成後はピッカーを閉じて編集ペインに遷移
      setPickerOpen(false);
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

  // 削除 (id 指定)。確認ダイアログ確定後に呼ぶ。optimistic で一覧から除去 →
  // 失敗時 revert。selectedId が削除対象のときだけ次のデッキへ切替。
  async function handleDeleteById(id: string) {
    const prevDecks = decks;
    const prevSelectedId = selectedId;
    const prevDetail = detail;
    setActionError(null);
    const next = prevDecks.find((d) => d.id !== id);
    setDecks((p) => p.filter((d) => d.id !== id));
    if (selectedId === id) {
      setSelectedId(next?.id ?? null);
      setDetail(null);
    }
    try {
      await deleteDeck(id);
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

  // ----- rename / delete handlers (deck list 側) -----

  function startRename(id: string) {
    if (listLocked || renameTarget !== null) return;
    const deck = decks.find((d) => d.id === id);
    if (!deck) return;
    setRenameTarget({ id, value: deck.name, error: null, busy: false });
  }

  function cancelRename() {
    setRenameTarget(null);
  }

  function changeRenameValue(value: string) {
    setRenameTarget((prev) =>
      prev ? { ...prev, value, error: null } : prev,
    );
  }

  async function commitRename() {
    if (renameTarget === null) return;
    const { id, value } = renameTarget;
    const trimmed = value.trim();
    const deck = decks.find((d) => d.id === id);
    if (!deck) {
      cancelRename();
      return;
    }
    if (trimmed === deck.name) {
      cancelRename();
      return;
    }
    if (trimmed.length === 0) {
      setRenameTarget((prev) =>
        prev ? { ...prev, error: "デッキ名を入力してください" } : prev,
      );
      return;
    }
    if (trimmed.length > 30) {
      setRenameTarget((prev) =>
        prev ? { ...prev, error: "デッキ名は 30 文字以内にしてください" } : prev,
      );
      return;
    }
    setRenameTarget((prev) => (prev ? { ...prev, busy: true } : prev));
    try {
      await renameDeck(id, trimmed);
      setDecks((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
      );
      setDetail((prev) =>
        prev && prev.id === id ? { ...prev, name: trimmed } : prev,
      );
      cancelRename();
      refresh();
    } catch (e) {
      setRenameTarget((prev) =>
        prev
          ? {
              ...prev,
              error: e instanceof Error ? e.message : String(e),
              busy: false,
            }
          : prev,
      );
    }
  }

  function requestDelete(id: string) {
    if (listLocked) return;
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    await handleDeleteById(id);
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

  const currentDeck = selectedId ? decks.find((d) => d.id === selectedId) : null;

  // 共通の DeckListPane props (モバイル / デスクトップで共有)
  const listProps = {
    decks,
    selectedId,
    draftName,
    draftError,
    draftBusy,
    pendingDefaultId,
    disabled: listLocked,
    renameTarget,
    onSelectDefault: handleSelectDefault,
    onRequestNew: startNew,
    onDraftChange: (v: string) => {
      setDraftName(v);
      setDraftError(null);
    },
    onDraftCommit: commitDraft,
    onDraftCancel: cancelDraft,
    onRequestRename: startRename,
    onRenameChange: changeRenameValue,
    onRenameCommit: commitRename,
    onRenameCancel: cancelRename,
    onRequestDelete: requestDelete,
  } as const;

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col gap-3 sm:gap-4 lg:grid lg:grid-cols-[560px_1fr]">
        {/* モバイル: 現在のデッキを示すトリガーボタン (タップで Dialog 起動) */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={listLocked}
          className={cn(
            "lg:hidden shrink-0 rounded-lg border bg-card px-3 py-2 flex items-center gap-2 text-left",
            "hover:border-primary/40 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed",
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">
              {currentDeck?.name ?? "デッキを選択"}
            </div>
          </div>
          {currentDeck?.isDefault && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800 shrink-0"
            >
              使用中
            </Badge>
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        {/* デスクトップ: 従来の左カラム deck list */}
        <div className="hidden lg:flex min-h-0 flex-col">
          <DeckListPane
            {...listProps}
            onSelect={tryChangeSelection}
          />
        </div>
        <div className="min-h-0 flex flex-col flex-1 lg:flex-none">
          {/* フレーム自体は常に描画。中身だけを「内容/スケルトン/未選択」で切替。
              これで読み込み中もエリアが消えず、高さもジャンプしない。 */}
          <div className="rounded-lg border bg-card flex flex-col min-h-0 flex-1">
            {selectedId && currentDetail ? (
              <DeckEditorPane
                key={selectedId}
                deck={currentDetail}
                ownedCards={ownedCards}
                onChanged={(nextDetail) => {
                  setDetail(nextDetail);
                  // useEffect [initialDecks] による自動 sync を撤去したので、
                  // 編集ペインで保存された結果を decks にも明示的にパッチする
                  // (totalCount の整合)。
                  setDecks((prev) =>
                    prev.map((d) =>
                      d.id === nextDetail.id
                        ? {
                            ...d,
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
      {/* モバイル: デッキピッカー Dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] max-h-[80vh] flex flex-col gap-3 p-3">
          <DialogTitle className="px-1">デッキ一覧</DialogTitle>
          <div className="flex-1 min-h-0 -mx-3 -mb-3">
            <DeckListPane
              {...listProps}
              onSelect={(id) => {
                tryChangeSelection(id);
                setPickerOpen(false);
              }}
              className="border-0 rounded-none bg-transparent h-full"
            />
          </div>
        </DialogContent>
      </Dialog>

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
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteId(null);
        }}
        title="デッキを削除しますか?"
        description={
          confirmDeleteId
            ? `「${decks.find((d) => d.id === confirmDeleteId)?.name ?? ""}」を削除します。この操作は取り消せません。`
            : ""
        }
        confirmLabel="削除"
        confirmVariant="destructive"
        onConfirm={confirmDelete}
      />
    </>
  );
}
