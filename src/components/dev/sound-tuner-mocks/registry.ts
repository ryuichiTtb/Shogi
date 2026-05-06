// Issue #79: 個別音源調整画面の摸擬 UI レジストリ。
// SFX/BGM event key → Mock コンポーネントの map。
// 未登録 event は詳細ページ右側 mock UI を非表示とする (左側のみ表示)。

import {
  CheckMock,
  PieceCaptureMock,
  PieceDropMock,
  PieceJumpMock,
  PieceMoveMock,
  PiecePromoteMock,
} from "./piece-mocks";
import type { MockComponent } from "./types";

// 第 1 弾: 駒系 6 mock のみ登録。
// 残り (game/card/bgm 系) は段階的に追加予定。
export const MOCK_REGISTRY: Partial<Record<string, MockComponent>> = {
  piece_move: PieceMoveMock,
  piece_jump: PieceJumpMock,
  piece_capture: PieceCaptureMock,
  piece_promote: PiecePromoteMock,
  piece_drop: PieceDropMock,
  check: CheckMock,
};
