"use client";

// Issue #79: 駒系 SFX イベント (piece_move / piece_jump / piece_capture /
// piece_promote / piece_drop / check) の摸擬 UI 6 種。
//
// 各 mock は専用ミニ盤を表示し、ユーザー操作 (駒選択 → 移動先クリック等)
// で onTrigger を呼ぶ。SFX 再生は親 (詳細ページ) で usePreviewPlayer 経由。
//
// state リセットは親が <Mock key={resetKey} /> で remount する方式
// (内部で useEffect リセットを使わず副作用ゼロ)。

import { useState } from "react";

import { MiniBoard, type MiniSquare } from "./mini-board";
import type { MockProps } from "./types";

const SQ = 56;

// ===========================================================================
// piece_move : 縦 2 マス、下に歩、上のマスへ移動
// ===========================================================================
export function PieceMoveMock({ onTrigger }: MockProps) {
  const [pos, setPos] = useState<{ row: number; col: number }>({ row: 1, col: 0 });
  const [selected, setSelected] = useState(false);

  const handleClick = (row: number, col: number) => {
    if (row === pos.row && col === pos.col) {
      setSelected((s) => !s);
    } else if (selected && row === 0 && col === 0) {
      setPos({ row: 0, col: 0 });
      setSelected(false);
      onTrigger();
    }
  };

  const squares: MiniSquare[] = [
    { row: 0, col: 0, targetable: selected && pos.row === 1 },
    { row: 1, col: 0, targetable: selected && pos.row === 0 },
  ];
  squares.find((s) => s.row === pos.row && s.col === pos.col)!.piece = {
    type: "pawn",
    owner: "sente",
  };
  if (selected) {
    squares.find((s) => s.row === pos.row && s.col === pos.col)!.selected = true;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <MiniBoard rows={2} cols={1} squareSize={SQ} squares={squares} onSquareClick={handleClick} />
      <p className="text-[11px] text-muted-foreground text-center max-w-[160px]">
        歩をクリック → 上のマスをクリックで移動
      </p>
    </div>
  );
}

// ===========================================================================
// piece_jump : 3行 × 2列、桂馬を「2マス先 + 1列」に動かす
// ===========================================================================
export function PieceJumpMock({ onTrigger }: MockProps) {
  const [pos, setPos] = useState<{ row: number; col: number }>({ row: 2, col: 0 });
  const [selected, setSelected] = useState(false);

  const target = { row: 0, col: 1 };

  const handleClick = (row: number, col: number) => {
    if (row === pos.row && col === pos.col) {
      setSelected((s) => !s);
    } else if (selected && row === target.row && col === target.col) {
      setPos(target);
      setSelected(false);
      onTrigger();
    }
  };

  const squares: MiniSquare[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      squares.push({
        row: r,
        col: c,
        targetable: selected && r === target.row && c === target.col && pos.row === 2,
      });
    }
  }
  const sq = squares.find((s) => s.row === pos.row && s.col === pos.col)!;
  sq.piece = { type: "knight", owner: "sente" };
  if (selected) sq.selected = true;

  return (
    <div className="flex flex-col items-center gap-2">
      <MiniBoard rows={3} cols={2} squareSize={SQ} squares={squares} onSquareClick={handleClick} />
      <p className="text-[11px] text-muted-foreground text-center max-w-[160px]">
        桂馬をクリック → 1マス上 + 1マス右をクリック
      </p>
    </div>
  );
}

// ===========================================================================
// piece_capture : 縦 2 マス、上に相手歩、下に自分歩。歩で取る。
// ===========================================================================
export function PieceCaptureMock({ onTrigger }: MockProps) {
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState(false);

  const handleClick = (row: number, col: number) => {
    if (done) return;
    if (row === 1 && col === 0) {
      setSelected((s) => !s);
    } else if (selected && row === 0 && col === 0) {
      setDone(true);
      setSelected(false);
      onTrigger();
    }
  };

  const squares: MiniSquare[] = [
    {
      row: 0,
      col: 0,
      piece: done ? { type: "pawn", owner: "sente" } : { type: "pawn", owner: "gote" },
      targetable: selected && !done,
      landed: done,
    },
    {
      row: 1,
      col: 0,
      piece: done ? null : { type: "pawn", owner: "sente" },
      selected: !done && selected,
    },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      <MiniBoard rows={2} cols={1} squareSize={SQ} squares={squares} onSquareClick={handleClick} />
      <p className="text-[11px] text-muted-foreground text-center max-w-[160px]">
        自分の歩 (下) をクリック → 相手の歩 (上) をクリックで取る
      </p>
    </div>
  );
}

// ===========================================================================
// piece_promote : 縦 5 マス、上 1 マスは敵陣。歩を選んで上 (敵陣) に移動 → 即「成り」発火。
// ===========================================================================
export function PiecePromoteMock({ onTrigger }: MockProps) {
  const [pos, setPos] = useState<{ row: number; col: number }>({ row: 4, col: 0 });
  const [selected, setSelected] = useState(false);

  const target = { row: 0, col: 0 };

  const handleClick = (row: number, col: number) => {
    if (row === pos.row && col === pos.col) {
      setSelected((s) => !s);
    } else if (selected && row === target.row && col === target.col) {
      setPos(target);
      setSelected(false);
      onTrigger();
    }
  };

  const squares: MiniSquare[] = [];
  for (let r = 0; r < 5; r++) {
    squares.push({
      row: r,
      col: 0,
      promotionZone: r === 0,
      targetable: selected && r === target.row && pos.row !== 0,
    });
  }
  const sq = squares.find((s) => s.row === pos.row)!;
  sq.piece = pos.row === 0
    ? { type: "promoted_pawn", owner: "sente" }
    : { type: "pawn", owner: "sente" };
  if (selected) sq.selected = true;

  return (
    <div className="flex flex-col items-center gap-2">
      <MiniBoard rows={5} cols={1} squareSize={SQ} squares={squares} onSquareClick={handleClick} />
      <p className="text-[11px] text-muted-foreground text-center max-w-[160px]">
        歩を選択 → 敵陣 (上端、赤) に移動 → 成る
      </p>
    </div>
  );
}

// ===========================================================================
// piece_drop : 1×3 マス、持ち駒「歩」をクリック → 任意マスにドロップ
// ===========================================================================
export function PieceDropMock({ onTrigger }: MockProps) {
  const [dropped, setDropped] = useState<{ row: number; col: number } | null>(null);
  const [handSelected, setHandSelected] = useState(false);

  const handleClick = (row: number, col: number) => {
    if (dropped) return;
    if (handSelected) {
      setDropped({ row, col });
      setHandSelected(false);
      onTrigger();
    }
  };

  const squares: MiniSquare[] = [];
  for (let c = 0; c < 3; c++) {
    squares.push({
      row: 0,
      col: c,
      targetable: handSelected && !dropped,
      landed: dropped?.row === 0 && dropped?.col === c,
      piece: dropped?.row === 0 && dropped?.col === c ? { type: "pawn", owner: "sente" } : null,
    });
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <MiniBoard rows={1} cols={3} squareSize={SQ} squares={squares} onSquareClick={handleClick} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">持ち駒:</span>
        <button
          type="button"
          onClick={() => !dropped && setHandSelected((s) => !s)}
          disabled={!!dropped}
          aria-label="持ち駒の歩"
          aria-pressed={handSelected}
          className={`relative flex items-center justify-center bg-amber-100/80 dark:bg-amber-950/30 border-2 rounded transition-colors min-h-[44px] min-w-[44px] ${
            handSelected ? "border-blue-500 bg-blue-100/70 dark:bg-blue-900/40" : "border-amber-700/70"
          } ${dropped ? "opacity-30 cursor-not-allowed" : "cursor-pointer hover:bg-amber-200/60"}`}
          style={{ width: SQ - 4, height: SQ - 4 }}
        >
          <span className="font-bold text-base">歩</span>
          {!dropped && (
            <span className="absolute -top-1 -right-1 text-[10px] bg-amber-700 text-white rounded-full w-4 h-4 flex items-center justify-center">
              1
            </span>
          )}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground text-center max-w-[180px]">
        持ち駒の歩をクリック → 盤上のマスをクリックで打つ
      </p>
    </div>
  );
}

// ===========================================================================
// check : 縦 3 マス、上端に敵王、下端に飛車。飛車を上方向に動かして王手。
// ===========================================================================
export function CheckMock({ onTrigger }: MockProps) {
  const [rookRow, setRookRow] = useState(2);
  const [selected, setSelected] = useState(false);

  const handleClick = (row: number, col: number) => {
    if (col !== 0) return;
    if (row === rookRow) {
      setSelected((s) => !s);
    } else if (selected && row === 1 && rookRow === 2) {
      setRookRow(1);
      setSelected(false);
      onTrigger();
    }
  };

  const squares: MiniSquare[] = [
    { row: 0, col: 0, piece: { type: "king", owner: "gote" } },
    {
      row: 1,
      col: 0,
      piece: rookRow === 1 ? { type: "rook", owner: "sente" } : null,
      targetable: selected && rookRow === 2,
      selected: selected && rookRow === 1,
    },
    {
      row: 2,
      col: 0,
      piece: rookRow === 2 ? { type: "rook", owner: "sente" } : null,
      selected: selected && rookRow === 2,
    },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      <MiniBoard rows={3} cols={1} squareSize={SQ} squares={squares} onSquareClick={handleClick} />
      <p className="text-[11px] text-muted-foreground text-center max-w-[180px]">
        飛車を選択 → 中央マスへ進めると上の王に王手
      </p>
    </div>
  );
}
