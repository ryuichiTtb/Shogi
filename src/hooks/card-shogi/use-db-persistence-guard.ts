// Issue #193 / PR1a (B-1 対応): DB 保存 4 経路 (saveCardShogiMove /
// persistCardShogiState / saveCardShogiResign / undoCardShogiGameState) のスキップ判定を
// 一元管理する共通フック。
//
// CPU vs CPU 観戦モード (spectatorMode=true) は揮発モードのため DB に何も保存しない:
// - Game レコードは createGame の cpu-vs-cpu 経路で作成しない (段階7 で実装予定)
// - 各 useEffect 冒頭で `if (!canPersist) return;` で skip
//
// 設計判断 (F-2 進行中チェックリスト関連): 副作用なしの純粋判定だが、計画 md の
// 設計どおり use* 接頭辞の hook で集約する (4 経路で同じロジックを使うため、将来の
// ルール拡張で副作用 (Context 経由ログ出力等) を追加するときの拡張点として残す)。
// PR1a 段階では完全な純粋関数で動作。

"use client";

export interface DbPersistenceGuard {
  // true なら DB 保存処理を継続、false なら skip。
  canPersist: boolean;
}

export function useDbPersistenceGuard(spectatorMode: boolean): DbPersistenceGuard {
  return { canPersist: !spectatorMode };
}
