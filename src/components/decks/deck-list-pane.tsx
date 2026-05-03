"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { DeckSummary } from "@/app/actions/deck";

interface DeckListPaneProps {
  decks: DeckSummary[];
  selectedId: string | null;
  // 新規デッキ草稿: null=非アクティブ、""〜=入力中。
  draftName: string | null;
  draftError: string | null;
  draftBusy: boolean;
  // 「選択」ボタン操作中の deckId。連打抑止に使う。
  pendingDefaultId: string | null;
  // インライン rename ターゲット。null=非アクティブ。
  renameTarget:
    | { id: string; value: string; error: string | null; busy: boolean }
    | null;
  // 詳細 fetch 中 / 使用中切替中など、一覧操作を一時的にロックするフラグ。
  disabled?: boolean;
  // ラッパー div の className 上書き。Dialog 内に埋め込むときは
  // border 等を打ち消したいので利用する。
  className?: string;
  onSelect: (id: string) => void;
  onSelectDefault: (id: string) => void;
  onRequestNew: () => void;
  onDraftChange: (value: string) => void;
  onDraftCommit: () => void;
  onDraftCancel: () => void;
  onRequestRename: (id: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRequestDelete: (id: string) => void;
}

export function DeckListPane({
  decks,
  selectedId,
  draftName,
  draftError,
  draftBusy,
  pendingDefaultId,
  renameTarget,
  disabled = false,
  className,
  onSelect,
  onSelectDefault,
  onRequestNew,
  onDraftChange,
  onDraftCommit,
  onDraftCancel,
  onRequestRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onRequestDelete,
}: DeckListPaneProps) {
  const isOnlyDeck = decks.length <= 1;
  // 他 row が rename 中なら、自身の操作 (select / default 切替 / rename / delete) は不可。
  const someoneRenaming = renameTarget !== null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card flex flex-col min-h-0",
        className,
      )}
    >
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold">デッキ一覧</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={onRequestNew}
          disabled={disabled || draftName !== null || someoneRenaming}
        >
          <Plus className="w-3.5 h-3.5" />
          新規
        </Button>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {draftName !== null && (
          <li>
            {/* 草稿枠は確定前なので選択ハイライト (border-primary) は出さない。
                確定 → setSelectedId(newId) 後に通常のデッキ row として描画され、
                その時点で他デッキと同じ条件で白枠が付く。 */}
            <div className="px-3 py-2 rounded-md border-2 border-transparent">
              <input
                type="text"
                value={draftName}
                autoFocus
                maxLength={30}
                disabled={draftBusy}
                placeholder="デッキ名 (Enter で確定 / Esc で破棄)"
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onDraftCommit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onDraftCancel();
                  }
                }}
                onBlur={() => {
                  // 空のまま入力欄を離れたら破棄。文字が入っていれば残す
                  // (ユーザーは Enter で確定 / 別デッキ選択で確認ダイアログを出す)。
                  if (draftName.trim() === "") onDraftCancel();
                }}
                className={cn(
                  "w-full h-8 px-2 rounded-md border border-input bg-background text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  draftBusy && "opacity-50",
                )}
              />
              {draftError && (
                <p className="text-xs text-destructive mt-1">{draftError}</p>
              )}
            </div>
          </li>
        )}
        {decks.map((deck) => {
          const active = deck.id === selectedId;
          const isPendingDefault = pendingDefaultId === deck.id;
          const isRenamingThis =
            renameTarget !== null && renameTarget.id === deck.id;
          // 他 row が rename 中なら、この row の操作はロック。
          const rowDisabled =
            disabled || (someoneRenaming && !isRenamingThis);
          return (
            <li key={deck.id}>
              <div
                className={cn(
                  "w-full px-3 py-2 rounded-md border-2 transition-all flex items-center gap-1.5",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-transparent",
                  !rowDisabled &&
                    !active &&
                    !isRenamingThis &&
                    "hover:border-border hover:bg-muted/50",
                )}
              >
                {isRenamingThis ? (
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={renameTarget.value}
                      autoFocus
                      maxLength={30}
                      disabled={renameTarget.busy}
                      onChange={(e) => onRenameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onRenameCommit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          onRenameCancel();
                        }
                      }}
                      className={cn(
                        "w-full h-7 px-2 rounded-md border border-input bg-background text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        renameTarget.busy && "opacity-50",
                      )}
                    />
                    {renameTarget.error && (
                      <p className="text-xs text-destructive mt-1">
                        {renameTarget.error}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(deck.id)}
                    disabled={rowDisabled}
                    className={cn(
                      "flex-1 min-w-0 text-left",
                      rowDisabled ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                  >
                    {/* デッキ名は折返し表示 (truncate ではなく break-words)。
                        長い名前でもボタン横の使用/編集/削除と重ならないよう
                        flex 親側で min-w-0 を維持して幅を絞っている。 */}
                    <div className="font-medium text-sm break-words">
                      {deck.name}
                    </div>
                    {/* 枚数はデスクトップのみ表示。モバイルは縦幅優先で省略。 */}
                    <div className="hidden lg:block text-xs text-muted-foreground mt-0.5">
                      {deck.totalCount} 枚
                    </div>
                  </button>
                )}

                {/* 通常モード: 使用中バッジ or 使用ボタン */}
                {!isRenamingThis &&
                  (deck.isDefault ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800 shrink-0"
                    >
                      使用中
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSelectDefault(deck.id)}
                      disabled={
                        rowDisabled ||
                        isPendingDefault ||
                        deck.totalCount === 0
                      }
                      title={
                        deck.totalCount === 0
                          ? "0枚のデッキは使用中にできません"
                          : undefined
                      }
                      className="shrink-0 h-7 px-2 text-xs"
                    >
                      {isPendingDefault ? "..." : "使用"}
                    </Button>
                  ))}

                {/* 編集 / 削除アイコン。rename モードでは ✓/✗ に切替。 */}
                {isRenamingThis ? (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={onRenameCommit}
                      disabled={renameTarget.busy}
                      title="名前を保存"
                      className="shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={onRenameCancel}
                      disabled={renameTarget.busy}
                      title="キャンセル"
                      className="shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onRequestRename(deck.id)}
                      disabled={rowDisabled}
                      title="名前を変更"
                      className="shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onRequestDelete(deck.id)}
                      disabled={
                        rowDisabled || deck.isDefault || isOnlyDeck
                      }
                      title={
                        deck.isDefault
                          ? "使用中のデッキは削除できません"
                          : isOnlyDeck
                            ? "最後のデッキは削除できません"
                            : "デッキを削除"
                      }
                      className="shrink-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
