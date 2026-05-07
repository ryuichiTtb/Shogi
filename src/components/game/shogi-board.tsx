"use client";

import { forwardRef, memo, useCallback, useImperativeHandle, useRef, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { ShogiPiece } from "./shogi-piece";
import { useBoardLayout } from "@/components/board-layout/board-layout-provider";
import { useTouchHandler } from "@/hooks/use-touch-handler";
import {
  SHOGI_BOARD_CELLS,
  SHOGI_BOARD_GAP,
  getShogiBoardCellSize,
  getShogiBoardLabelSize,
} from "@/lib/shogi/board-layout";
import type { Board, Move, Piece, Player, Position } from "@/lib/shogi/types";

export interface ShogiBoardHandle {
  getSquareRect: (row: number, col: number) => DOMRect | null;
}

interface ShogiBoardProps {
  board: Board;
  currentPlayer: Player;
  playerColor: Player;
  selectedSquare: Position | null;
  legalMoves: Move[];
  lastMove: Move | null;
  isAiThinking: boolean;
  inCheck: boolean;
  onSquareClick: (pos: Position) => void;
  squareSize: number;
  isMobile: boolean;
  // カード将棋: 歩戻し等のターゲット選択時にハイライトするマス。標準将棋では未指定。
  cardTargetSquares?: Position[];
  // カード将棋: no_promote の永続「成り不可」マーク位置 (両プレイヤー分をまとめて指定)。
  noPromoteSquares?: Position[];
  // カード将棋 (Issue #82): 駒フライト中、着地点の駒を非表示にするためのマス。
  // 指定したマスの駒は visibility: hidden で消す (レイアウトは保持)。
  hiddenSquares?: Position[];
  // カード将棋 (Issue #82 二手指し): 「禁止された詰み手」のマス。
  // 赤背景 + × アイコンを表示し、クリック時にダイアログで禁止理由を説明する。
  // クリック自体は通常通り onSquareClick が発火するので、禁止マスかどうかの判定は呼出元 (UI) で行う。
  forbiddenMateSquares?: Position[];
}

// 先手目線のラベル
const FILE_LABELS_SENTE = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const RANK_LABELS_SENTE = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

// 後手目線のラベル（逆順）
const FILE_LABELS_GOTE = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const RANK_LABELS_GOTE = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

// マスごとの ref 登録/解除を行う関数の型。親側で安定化して BoardSquare に渡す。
type RegisterSquareRef = (row: number, col: number, el: HTMLDivElement | null) => void;

interface BoardSquareProps {
  rowIdx: number;
  colIdx: number;
  piece: Piece | null;
  isSelected: boolean;
  isLegalTarget: boolean;
  isCardTarget: boolean;
  isForbiddenMate: boolean;
  isNoPromote: boolean;
  isHidden: boolean;
  isLastMoveSq: boolean;
  isKingInCheck: boolean;
  isStarPoint: boolean;
  canHover: boolean;
  cellWidth: number;
  cellHeight: number;
  dotSize: number;
  playerColor: Player;
  registerRef: RegisterSquareRef;
  // Issue #177: 木目背景の URL。指定時は state なしの neutral マスのみ
  // background-image で適用する (state 時は従来通り Tailwind カラーで上書き)。
  boardTextureUrl: string | null;
  // 視覚上のマス位置 (0..8)。木目テクスチャを盤全体で連続表示させるための
  // background-position 計算に使う。先手目線/後手目線で row/col の並びは反転するため
  // 描画時の visual インデックスをそのまま受け取る。
  visualRow: number;
  visualCol: number;
}

// 81 マスの 1 マス分。React.memo でラップし、変わっていないマスの再描画を skip する。
// onClick 系は親 grid の pointerHandlers (useTouchHandler) で一括処理しているため、
// BoardSquare 自身は受け取らない。
const BoardSquare = memo(function BoardSquare({
  rowIdx,
  colIdx,
  piece,
  isSelected,
  isLegalTarget,
  isCardTarget,
  isForbiddenMate,
  isNoPromote,
  isHidden,
  isLastMoveSq,
  isKingInCheck,
  isStarPoint,
  canHover,
  cellWidth,
  cellHeight,
  dotSize,
  playerColor,
  registerRef,
  boardTextureUrl,
  visualRow,
  visualCol,
}: BoardSquareProps) {
  // ref 登録は registerRef + (rowIdx, colIdx) で stabilize。BoardSquare が memo で
  // 再描画 skip されると、ref callback の identity も変わらない。
  const setRef = useCallback(
    (el: HTMLDivElement | null) => registerRef(rowIdx, colIdx, el),
    [rowIdx, colIdx, registerRef],
  );

  // Issue #177: state 色は木目テクスチャの上に半透明 tint を重ねて表示する。
  // 単色塗りで盤目を覆い隠さないようにし、light/dark テーマで同じ tint 値を使う
  // (盤テクスチャが視覚ベースなので OS テーマでの分岐は不要)。
  // 優先順序は元実装の cn() 出現順に合わせる:
  //   forbiddenMate > cardTarget > legalTarget(piece) > legalTarget(empty)
  //   > selected > kingInCheck > lastMove
  const tint: string | null = isForbiddenMate
    ? "rgba(220, 38, 38, 0.55)"   // red-600 / 警告
    : isCardTarget
      ? "rgba(245, 158, 11, 0.55)" // amber-500 / カード対象
      : isLegalTarget && piece
        ? "rgba(220, 38, 38, 0.35)" // red-600 / 取れる相手駒
        : isLegalTarget
          ? "rgba(59, 130, 246, 0.30)" // blue-500 / 合法移動先
          : isSelected
            ? "rgba(59, 130, 246, 0.50)" // blue-500 / 選択中
            : isKingInCheck
              ? "rgba(220, 38, 38, 0.65)" // red-600 / 王手警告
              : isLastMoveSq
                ? "rgba(16, 185, 129, 0.40)" // emerald-500 / 直前手
                : null;

  // 盤全体サイズ (= 9 cell + 8 gap)。各マスはここから visual 位置のオフセットだけ
  // 切り出すことで、9x9 のマスに 1 枚の木目画像が連続表示される。
  const totalBoardW =
    cellWidth * SHOGI_BOARD_CELLS + SHOGI_BOARD_GAP * (SHOGI_BOARD_CELLS - 1);
  const totalBoardH =
    cellHeight * SHOGI_BOARD_CELLS + SHOGI_BOARD_GAP * (SHOGI_BOARD_CELLS - 1);
  const offsetX = visualCol * (cellWidth + SHOGI_BOARD_GAP);
  const offsetY = visualRow * (cellHeight + SHOGI_BOARD_GAP);

  const cellStyle: CSSProperties = {
    width: cellWidth,
    height: cellHeight,
  };
  if (boardTextureUrl) {
    if (tint) {
      // tint をテクスチャの上に重ねる: 1 枚目が tint (linear-gradient)、
      // 2 枚目が木目画像。CSS は背景レイヤーを記述順 = 上から下に重ねる。
      cellStyle.backgroundImage = `linear-gradient(${tint}, ${tint}), url(${boardTextureUrl})`;
      cellStyle.backgroundSize = `100% 100%, ${totalBoardW}px ${totalBoardH}px`;
      cellStyle.backgroundPosition = `0 0, -${offsetX}px -${offsetY}px`;
      cellStyle.backgroundRepeat = "no-repeat, no-repeat";
    } else {
      cellStyle.backgroundImage = `url(${boardTextureUrl})`;
      cellStyle.backgroundSize = `${totalBoardW}px ${totalBoardH}px`;
      cellStyle.backgroundPosition = `-${offsetX}px -${offsetY}px`;
    }
  } else if (tint) {
    // テクスチャ未設定時のフォールバック (実運用では BoardLayoutProvider が
    // 常に url を返すため通常は通らないが、防御として単色塗りを適用)。
    cellStyle.backgroundColor = tint;
  }

  return (
    <div
      ref={setRef}
      data-legal={isLegalTarget}
      className={cn(
        "shogi-square relative flex items-center justify-center",
        "cursor-pointer",
        // 通常背景 (テクスチャ未設定時のフォールバック色のみ)。
        // テクスチャ設定時は inline style の background-image が上に被るため見えない。
        "bg-amber-50",
        // ring と animate-pulse は state 表示の補助なので Tailwind class のまま残す
        isCardTarget && "ring-2 ring-inset ring-amber-500 animate-pulse",
        isForbiddenMate && "ring-2 ring-inset ring-red-600",
        // プレイヤーのターンでない・AI思考中は操作不可
        !canHover && !isCardTarget && "cursor-not-allowed",
      )}
      style={cellStyle}
    >
      {/* 星目（中央3×3四隅の交差点） */}
      {isStarPoint && (
        <div
          className="absolute z-10 rounded-full bg-[#3a1f0a] pointer-events-none"
          style={{
            width: Math.max(4, cellWidth * 0.08),
            height: Math.max(4, cellWidth * 0.08),
            bottom: 0,
            right: 0,
            transform: "translate(50%, 50%)",
          }}
        />
      )}

      {/* 合法手ドット（空きマス） */}
      {isLegalTarget && !piece && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="rounded-full bg-blue-500/50"
            style={{ width: dotSize, height: dotSize }}
          />
        </div>
      )}

      {/* 二手指し 2手目: 禁止された詰み手 (Issue #82) - 赤背景 + × アイコン */}
      {isForbiddenMate && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          aria-label="禁止された詰み手"
        >
          <span
            className="text-red-700 dark:text-red-300 font-bold leading-none select-none"
            style={{
              fontSize: Math.max(20, cellWidth * 0.6),
              filter: "drop-shadow(0 0 3px rgba(255,255,255,0.8))",
            }}
          >
            ×
          </span>
        </div>
      )}

      {/* 駒 (Issue #82: hiddenSquares 指定時はフライト中につき非表示) */}
      {piece && (
        <div
          className="absolute inset-0"
          style={isHidden ? { opacity: 0, pointerEvents: "none" } : undefined}
        >
          <ShogiPiece
            piece={piece}
            isSelected={isSelected}
            isInCheck={isKingInCheck}
            playerColor={playerColor}
            squareSize={cellWidth}
          />
        </div>
      )}

      {/* no_promote 永続マーク (紫枠 + 🚫) */}
      {isNoPromote && (
        <div
          className="absolute inset-0 pointer-events-none z-20 ring-2 ring-inset ring-purple-500 dark:ring-purple-300"
          aria-label="成り不可"
        >
          <span
            className="absolute leading-none select-none"
            style={{
              right: 1,
              top: 1,
              fontSize: Math.max(10, cellWidth * 0.32),
              filter: "drop-shadow(0 0 2px rgba(168,85,247,0.9))",
            }}
          >
            🚫
          </span>
        </div>
      )}
    </div>
  );
});

export const ShogiBoard = memo(forwardRef<ShogiBoardHandle, ShogiBoardProps>(function ShogiBoard(
  {
    board,
    currentPlayer,
    playerColor,
    selectedSquare,
    legalMoves,
    lastMove,
    isAiThinking,
    inCheck,
    onSquareClick,
    squareSize,
    isMobile,
    cardTargetSquares,
    noPromoteSquares,
    hiddenSquares,
    forbiddenMateSquares,
  },
  forwardedRef,
) {
  const squareRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Issue #177: ユーザー選択の盤レイアウト (デフォルト = ライト04)。
  // url を ShogiBoard 全マスに連続テクスチャとして適用する。
  const boardLayout = useBoardLayout();

  useImperativeHandle(
    forwardedRef,
    () => ({
      getSquareRect: (row, col) => {
        const el = squareRefs.current.get(`${row}-${col}`);
        return el ? el.getBoundingClientRect() : null;
      },
    }),
    [],
  );

  // ref 登録/解除を BoardSquare に渡す。useCallback で stable 化することで
  // BoardSquare の memo 比較を維持する (deps なし)。
  const registerSquareRef = useCallback<RegisterSquareRef>((row, col, el) => {
    const key = `${row}-${col}`;
    if (el) squareRefs.current.set(key, el);
    else squareRefs.current.delete(key);
  }, []);

  const legalMoveSet = new Set(
    legalMoves.map((m) => `${m.to.row}-${m.to.col}`)
  );
  const cardTargetSet = new Set(
    (cardTargetSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );
  const noPromoteSet = new Set(
    (noPromoteSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );
  const hiddenSet = new Set(
    (hiddenSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );
  const forbiddenMateSet = new Set(
    (forbiddenMateSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );

  const isGote = playerColor === "gote";
  const cellSize = getShogiBoardCellSize(squareSize);
  // タップスナップ対象は legalMoves + forbiddenMateMoves。
  // 禁止マスもタップで反応する (UI 側で禁止理由ダイアログを表示する) ため、スナップ対象に含める。
  const tapSnapMoves = forbiddenMateSquares && forbiddenMateSquares.length > 0
    ? [
        ...legalMoves,
        ...forbiddenMateSquares.map((p) => ({
          type: "move" as const,
          to: p,
          piece: "",
          player: currentPlayer,
        })),
      ]
    : legalMoves;
  const { gridRef, pointerHandlers } = useTouchHandler({
    cellWidth: cellSize.width,
    cellHeight: cellSize.height,
    legalMoves: tapSnapMoves,
    selectedSquare,
    isGote,
    onSquareClick,
  });

  const isLastMoveSquare = (row: number, col: number): boolean => {
    if (!lastMove) return false;
    const matchTo = lastMove.to.row === row && lastMove.to.col === col;
    const matchFrom = !!lastMove.from && lastMove.from.row === row && lastMove.from.col === col;
    return matchTo || matchFrom;
  };

  const isPlayerTurn = currentPlayer === playerColor;
  const canHover = isPlayerTurn && !isAiThinking;

  // 後手番時は行・列を逆順にして後手目線の盤面にする
  const rowIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const colIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = isGote ? FILE_LABELS_GOTE : FILE_LABELS_SENTE;
  const rankLabels = isGote ? RANK_LABELS_GOTE : RANK_LABELS_SENTE;

  const labelSize = getShogiBoardLabelSize(squareSize, isMobile);
  const dotSize = Math.max(8, cellSize.width * 0.22);

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* ファイルラベル（上） */}
      <div className="flex" style={{ marginLeft: labelSize + 4 }}>
        {fileLabels.map((label) => (
          <div
            key={label}
            className="flex items-center justify-center text-muted-foreground"
            style={{ width: cellSize.width, height: labelSize, fontSize: labelSize * 0.75 }}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex">
        {/* 左側スペーサー（段ラベルと同幅で盤面を中央に揃える、モバイルでは省略） */}
        {!isMobile && <div style={{ width: labelSize + 6 }} />}

        {/* 盤面グリッド */}
        <div
          ref={gridRef}
          data-shogi-board-grid="1"
          role="grid"
          aria-label="将棋盤"
          className="grid border border-[#3a1f0a] bg-[#3a1f0a] relative"
          style={{
            gridTemplateColumns: `repeat(9, ${cellSize.width}px)`,
            gridTemplateRows: `repeat(9, ${cellSize.height}px)`,
            gap: SHOGI_BOARD_GAP,
            touchAction: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          {...pointerHandlers}
        >
          {rowIndices.map((rowIdx, visualRow) =>
            colIndices.map((colIdx, visualCol) => {
              const piece = board[rowIdx][colIdx];
              const isSelected =
                selectedSquare?.row === rowIdx &&
                selectedSquare?.col === colIdx;
              const isLegalTarget = legalMoveSet.has(`${rowIdx}-${colIdx}`);
              const isCardTarget = cardTargetSet.has(`${rowIdx}-${colIdx}`);
              const isForbiddenMate = forbiddenMateSet.has(`${rowIdx}-${colIdx}`);
              const isNoPromote = noPromoteSet.has(`${rowIdx}-${colIdx}`);
              const isHidden = hiddenSet.has(`${rowIdx}-${colIdx}`);
              const isLastMoveSq = isLastMoveSquare(rowIdx, colIdx);
              const isKingInCheck =
                inCheck &&
                piece?.type === "king" &&
                piece.owner === currentPlayer;
              const isStarPoint =
                (visualRow === 2 || visualRow === 5) &&
                (visualCol === 2 || visualCol === 5);

              return (
                <BoardSquare
                  key={`${rowIdx}-${colIdx}`}
                  rowIdx={rowIdx}
                  colIdx={colIdx}
                  piece={piece}
                  isSelected={isSelected}
                  isLegalTarget={isLegalTarget}
                  isCardTarget={isCardTarget}
                  isForbiddenMate={isForbiddenMate}
                  isNoPromote={isNoPromote}
                  isHidden={isHidden}
                  isLastMoveSq={isLastMoveSq}
                  isKingInCheck={isKingInCheck}
                  isStarPoint={isStarPoint}
                  canHover={canHover}
                  cellWidth={cellSize.width}
                  cellHeight={cellSize.height}
                  dotSize={dotSize}
                  playerColor={playerColor}
                  registerRef={registerSquareRef}
                  boardTextureUrl={boardLayout.url}
                  visualRow={visualRow}
                  visualCol={visualCol}
                />
              );
            })
          )}
        </div>

        {/* ランクラベル（右） */}
        <div className="flex flex-col" style={{ marginLeft: 2 }}>
          {rankLabels.map((label) => (
            <div
              key={label}
              className="flex items-center justify-center text-muted-foreground"
              style={{ height: cellSize.height, width: labelSize, fontSize: labelSize * 0.75 }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}));
