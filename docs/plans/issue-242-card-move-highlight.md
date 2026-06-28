# Issue #242: 駒移動系カード利用による盤上背景色制御修正

## 1. 問題 (バグ内容)

カード将棋で、カードによる駒移動 (歩戻し / 駒戻し / 二歩指し / 二手指し / 王手崩し) を行ったとき、
直前手を示す緑ハイライト (背景色) が反映されない。どのマスに作用したのか一目で分からず UX が低い。

要望 (Issue 本文):
1. **歩戻し / 駒戻し**: 盤上→持ち駒に戻したとき、対象駒が居た位置を緑に
2. **二歩指し**: 歩を打った位置を緑に
3. **二手指し**: 2手分の指し手の軌跡を緑に
4. **王手崩し**: 相手駒が持駒に移動するとき、対象駒が元居た位置を緑に
5. その他カードも必要に応じて適切に盛り込む

## 2. 根本原因

緑ハイライト (直前手) は `gameState.moveHistory[moveHistory.length - 1]` の `from`/`to` から
`ShogiBoard` が導出している (`card-shogi-game.tsx:1736,2149` → `shogi-board.tsx:372-377 isLastMoveSquare`)。

- カード効果 (`applyCardEffectLogic`) は **`moveHistory` を更新しない** (カードは指し手ではない / SFX・
  学習サンプル・待ったスコープ・千日手判定に影響させない設計) → 緑が出ない。
- 二手指しは `makeMoveWithEffects` を 2 回呼ぶので `moveHistory` には 2 手入るが、`lastMove` は
  末尾 1 手しか見ない → 1手目が緑にならない。
- 王手崩しは `trapTriggerEvent` で除去位置を持つが、これも `moveHistory` には乗らない。

つまり「直前のターンで作用したマス」を `moveHistory[-1]` だけから導出する現設計では
カード由来の盤面変化を表現できないのが根本原因。

## 3. 設計方針 (単一情報源 + イベント駆動)

「直前の盤面変化アクションで強調すべきマス集合」を reducer state の **単一情報源**
`lastActionHighlights: Position[]` として持つ。reducer は各遷移で「何が起きたか」を正確に
把握しているため、`GameEvent` から純粋関数でハイライトマスを導出する。

### なぜ reducer state か (component で eventLog を後方走査する案との比較)
- `eventLog` はリロード時 `[]` に初期化される (`use-card-shogi-game.ts:72`、永続化は `moveHistory` のみ)。
- component で eventLog を後方走査して「直前ターン分」を切り出す案は、二手指し (move×2 + cardPlayEvent)、
  王手崩し (trapTriggerEvent の player = トラップ所有者 = 指し手と別プレイヤー)、turn 末尾の
  manaCharge/draw 混在などで **ターン境界判定が脆く**、デグレ温床になる。
- reducer は遷移ごとに「このアクションが生成した events」を正確に持つため、`highlightSquaresForEvents`
  に渡すだけで move / card / 王手崩し / 二手指し蓄積を **後方走査ヒューリスティック無しで** 表現できる。
- 既存パターン (selectedSquare / legalMoves / forbiddenMateMoves を reducer state で持ち hook 経由で
  board へ渡す) と完全に同一の流れ = 保守性・疎結合を維持。

### 永続化 / 復元
- `lastActionHighlights` は UI 派生 state のため DB 永続化しない。
- 初期化 (新規 / リロード) は `initialState.moveHistory[-1]` から導出 (= 現挙動の緑を非デグレで維持)。
  カード由来ハイライトはリロードで消えるが、これは「直前アクションの一時的強調」であり許容
  (現状もカード使用直後しか意味を持たない)。リロード後も通常手の緑は従来通り残る。

## 4. 実装詳細

### 4-1. reducer.ts (純粋ヘルパ 2 つ + 各遷移でセット)

```ts
// アクションが生成した events からハイライトマスを導出 (move/card/王手崩しを一律に扱う)
function highlightSquaresForEvents(events: GameEvent[]): Position[] {
  const out: Position[] = [];
  for (const ev of events) {
    if (ev.kind === "moveEvent") {
      if (ev.move.from) out.push(ev.move.from);
      out.push(ev.move.to);
    } else if (ev.kind === "cardPlayEvent") {
      // 盤上に作用するカードは square target を持つ (pawn_return/piece_return/double_pawn)。
      // returnedPiece は target と同マスなので target で代表。mana_up/double_move は target 無 → 空。
      if (ev.target?.kind === "square") out.push({ row: ev.target.row, col: ev.target.col });
    } else if (ev.kind === "trapTriggerEvent" && ev.capturedPieces) {
      // 王手崩し: 除去された駒の元位置 (= 攻め駒の着地マス) を強調。
      for (const cp of ev.capturedPieces) out.push({ row: cp.row, col: cp.col });
    }
  }
  return out;
}

// 初期化 / リロード / 待った復元用フォールバック (moveHistory 末尾手の from/to)
export function lastMoveHighlightSquares(gameState: GameState): Position[] {
  const lm = gameState.moveHistory[gameState.moveHistory.length - 1];
  if (!lm) return [];
  return lm.from ? [lm.from, lm.to] : [lm.to];
}
```

セット箇所 (いずれも返却オブジェクト literal に 1 行追加。それ以外の遷移は `...state` スプレッドで保持):
- `MAKE_MOVE` 通常: `lastActionHighlights: highlightSquaresForEvents(result.events)`
- `MAKE_MOVE` 二手指し1手目 (継続 / gameOver 両分岐): `highlightSquaresForEvents(result.events)`
- `MAKE_MOVE` 二手指し2手目: `[...state.lastActionHighlights, ...highlightSquaresForEvents(result.events)]`
  (1手目分は直前 state に残っているので軌跡 2 手分を蓄積)
- `CONFIRM_PROMOTION`: `MAKE_MOVE` と同じ 3 分岐構造をミラー
- `CONFIRM_PLAY_CARD` (非 double_move): `const h = highlightSquaresForEvents([applied.event]);`
  `lastActionHighlights: h.length ? h : state.lastActionHighlights`
  (mana_up/trap は h=空 → 盤面非変更ゆえ直前の緑を保持 = ちらつき防止 + 意味的に正)
- `CONFIRM_PLAY_CARD` double_move 分岐: セットしない (1手目を指すまで直前手の緑を維持)
- `UNDO` (待った): `lastActionHighlights: lastMoveHighlightSquares(target.gameState)`
- `UNDO_DOUBLE_MOVE_FIRST` / `CANCEL_DOUBLE_MOVE`: 復元 gameState から `lastMoveHighlightSquares` で再導出
  (取り消した 1手目の緑を残さない)
- interface `CardShogiGameStateInternal` に `lastActionHighlights: Position[]` 追加
- `finalizeDoubleMoveCardConsumption`: `...state` スプレッドで蓄積値を保持 (変更不要)
- COMMIT_PLAY_CARD / COMMIT_CHECK_BREAK / COMMIT_DRAW / applyTurnEndEffects: `...state` で保持 (変更不要)

### 4-2. use-card-shogi-game.ts
- 初期 state に `lastActionHighlights: lastMoveHighlightSquares(initialState)` 追加 (line 64 の literal)
- 戻り値に `lastActionHighlights: state.lastActionHighlights` 追加 (line 691)

### 4-3. card-shogi-game.tsx
- hook 分割代入 (387-424) に `lastActionHighlights` 追加
- 2 つの `<ShogiBoard>` (1729, 2142) に `lastMoveSquares={lastActionHighlights}` を追加

### 4-4. shogi-board.tsx
- props に `lastMoveSquares?: Position[]` 追加 (任意。標準将棋は未指定 = 後方互換)
- 既存 Set 群と同パターンで `lastMoveSet` を構築:
  ```ts
  const lastMoveSet = new Set(
    (lastMoveSquares ??
      (lastMove ? (lastMove.from ? [lastMove.from, lastMove.to] : [lastMove.to]) : [])
    ).map((p) => `${p.row}-${p.col}`),
  );
  ```
- `isLastMoveSquare` 関数 (372-377) を削除し、render 内 (440) を
  `const isLastMoveSq = lastMoveSet.has(`${rowIdx}-${colIdx}`);` に置換
- 標準将棋 (`shogi-game.tsx:305`) は `lastMoveSquares` 未指定 → `lastMove` から従来通り導出 = 挙動不変

## 5. 非デグレ / 影響範囲
- 標準将棋: `lastMoveSquares` 未指定で `lastMove` フォールバック → from/to 集合は従来と同一。挙動不変。
- カード将棋通常手: `highlightSquaresForEvents(moveEvent)` = from/to で従来と同一。
- 緑の優先順位は最下位のまま (選択/合法手/王手より下) → 既存 UX を変えない。
- 永続化 (DB save) 対象は不変 (lastActionHighlights は保存しない)。
- AI / 探索ロジックには非干渉 (UI 表示専用 state)。

## 6. テスト計画
- reducer ユニット: `highlightSquaresForEvents` (move / 取り / 打ち / cardPlayEvent square / 王手崩し /
  mana_up=空) + `lastMoveHighlightSquares` (空 / from-to / drop)
- reducer 統合: MAKE_MOVE / CONFIRM_PLAY_CARD(pawn_return,piece_return,double_pawn,mana_up) /
  二手指し2手蓄積 / UNDO で `lastActionHighlights` が期待値になること
- 既存テスト (undo-policy / effects / world-kernel-equivalence) が緑を維持
- `npm run lint` → `typecheck` → `test:ci` → `build`

## 7. パフォーマンス / UX
- ハイライトマスは最大 4 (二手指し) の小集合。Set 構築は既存 5 Set と同コスト感、描画増分なし。
- 追加の再描画・タイマー・アニメーションなし (既存の tint 経路に乗るだけ)。モバイル負荷増なし。
- カードフライト演出中も対象マスの tint は表示される (駒は hiddenSquares で隠れるがセルは緑) →
  「どこから戻したか」が演出中から視認でき UX 向上。
