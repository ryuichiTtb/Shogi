"use client";

// Issue #217: 「もう一局」(リマッチ) 共通フック。
//
// 旧実装は標準将棋・カード将棋とも `startTransition(async () => { await
// createGame(); router.push() })` で、(1) createGame 失敗時に await が reject
// → router.push 未到達 → エラー握り潰し → ボタンが「準備中...」固着の永久
// ハング、(2) startTransition に async 関数を渡す pending/エラー追跡が崩れる
// アンチパターン、という 2 つの欠陥があった。本フックで明示的な loading /
// error state + try/catch に置き換え、両 variant で共有する (DRY)。

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createGame } from "@/app/actions/game";
import type { Difficulty, Player } from "@/lib/shogi/types";

export interface RematchConfig {
  difficulty: Difficulty;
  playerColor: Player;
  characterId: string;
  // 省略時は標準将棋 ("standard")。カード将棋は "card-shogi" を渡す。
  variantId?: string;
}

export interface UseRematchResult {
  // createGame 実行〜遷移までの待機中。ボタン無効化 / ローディングマスク表示に使う。
  isRematching: boolean;
  // 失敗時のユーザー向けメッセージ (成功・未実行時は null)。
  rematchError: string | null;
  // リマッチ実行。成功時は新規対局へ router.push。失敗時は isRematching を
  // 解除し rematchError を設定 (再呼び出しで再試行可能)。
  rematch: (config: RematchConfig) => Promise<void>;
  // エラー表示を閉じる。
  clearRematchError: () => void;
}

export function useRematch(): UseRematchResult {
  const router = useRouter();
  const [isRematching, setIsRematching] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);

  const rematch = useCallback(
    async (config: RematchConfig) => {
      setRematchError(null);
      setIsRematching(true);
      // Issue #217: この 1 回のもう一局を Vercel ログで一意特定するための
      // 相関 ID。ブラウザ devtools にも出すので、ユーザーはこの id を Vercel
      // Runtime Logs の検索に貼るだけで該当リクエストの計測行に絞り込める。
      const traceId = Math.random().toString(36).slice(2, 8);
      const clickedAt = Date.now();
      console.info(`[rematch-perf] start id=${traceId}`);
      try {
        const newGameId = await createGame(
          config.difficulty,
          config.playerColor,
          config.characterId,
          config.variantId ?? "standard",
          traceId,
        );
        // クライアント実測 (createGame 完了までの総待ち時間)。サーバ側
        // フェーズ計測と突き合わせる。
        console.info(
          `[rematch-perf] createGame done id=${traceId} clientWait=${Date.now() - clickedAt}ms newGame=${newGameId}`,
        );
        // 成功時は遷移でアンマウントされるまで isRematching=true を保持し、
        // ローディングマスク継続 + ボタン無効を維持する (ちらつき・二重押下防止)。
        router.push(`/game/${newGameId}`);
      } catch (e) {
        // 旧実装ではここで握り潰され永久ハングしていた (Issue #217)。
        // 明示的に捕捉してローディング解除 + エラー提示 → 再試行可能にする。
        console.error("rematch (createGame) failed", e);
        setRematchError(
          "対局の作成に失敗しました。通信状況を確認してもう一度お試しください。",
        );
        setIsRematching(false);
      }
    },
    [router],
  );

  const clearRematchError = useCallback(() => setRematchError(null), []);

  return { isRematching, rematchError, rematch, clearRematchError };
}
