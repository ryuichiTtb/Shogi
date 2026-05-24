import type { Difficulty, GameState, Move, Player, RuleVariant } from "../types";
import type { CardGameState } from "../cards/types";
import { STANDARD_VARIANT } from "../variants/standard";
import { findBestMove, evaluateAction, movesEqual } from "./search";
import {
  createSearchContext,
  finalizeStats,
  type SearchStats,
} from "./search-context";
import { evaluate, evaluateWithBreakdown, getLeastAttackerValue } from "./evaluate";
import { chooseBlunderGuardMove, type SafeCandidate } from "./blunder-guard";
import { getBookMove, MAX_BOOK_MOVES } from "./openingBook";
import { getFullLegalMoves, isSquareAttackedByFast } from "../moves";
import { applyMoveForSearch } from "../board";
import { computeCardDigest, type CardDigest } from "./cards/digest";
import { CurrentRules } from "./turn/current-rules";
import type { AiTurnState, TurnAction } from "./turn/types";
// Issue #193 / PR1c-2 Phase B: DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替。
// findBestMoveWithStats 内で createStrategy(difficulty, { spectator }) を呼んで
// Strategy インスタンスから maxSearchDepth / timeLimitMs / addNoise /
// nearEqualThreshold / useBook を取得する形に変更。
import { createStrategy } from "./strategy";

export interface DifficultyParams {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number;
  useBook: boolean;
  nearEqualThreshold: number; // 接戦時ランダム選択の閾値（cp）
}

// 難易度別探索パラメータ。
// Issue #176 timeout-fix: hard stop 4.0 秒以内に揃え、Vercel maxDuration=10 と
// blunder guard 200ms budget (fix-PR2 で導入予定) を加味して以下に確定。
// (旧 PR #185: beginner 1000 / intermediate 2000 / advanced 4000 / expert 4500、
//  expert で hard stop 4.0 秒を踏み超していたため本番で 504 多発)
//
// PR #185 Stage C bench で expert/midgame_30 max が 3.8s に張り付く =
// 既存実装でも 3.8s で打ち切られていたため、3.5s でも結果は近い。
// fix-PR2 で導入予定の 200ms blunder guard budget と合わせて「探索 3.3s +
// blunder guard 200ms = 計 3.5s」という二重保護も成立。
export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  beginner: {
    maxDepth: 3,
    timeLimitMs: 800,      // 旧 1000ms。0.8s 程度で計画書 issue-176.md L67 目安に整合
    addNoise: 0.50,        // 高ノイズ: 半分の確率でランダムな手
    useBook: false,        // 定石なし: 自然な弱さを演出
    nearEqualThreshold: 200, // 広い閾値: 大きくブレる
  },
  intermediate: {
    maxDepth: 6,
    timeLimitMs: 1800,     // 旧 2000ms。
    addNoise: 0.10,        // 10%のノイズ
    useBook: true,
    nearEqualThreshold: 80, // 中程度の閾値
  },
  advanced: {
    maxDepth: 16,          // 反復深化で到達できる限り深く
    timeLimitMs: 3000,     // 旧 4000ms。hard stop 4s 以内、余白拡大
    addNoise: 0,           // ノイズなし: ブランダー排除
    useBook: true,
    nearEqualThreshold: 0, // 常に最善手を選択
  },
  expert: {
    maxDepth: 24,          // 反復深化で到達できる限り深く
    timeLimitMs: 3500,     // 旧 4500ms。Stage C bench で max 3.8s 観測 = 3.5s 切詰可
    addNoise: 0,           // ノイズなし: ブランダー排除
    useBook: true,
    nearEqualThreshold: 0, // 常に最善手を選択
  },
};

// Issue #176: 旧 calculateAiMove は完全置換。findBestMoveWithStats (本ファイル末尾) を使う。

// ブランダーガード用: 駒の価値テーブル
const BLUNDER_PIECE_VALUES: Record<string, number> = {
  pawn: 100, lance: 300, knight: 400, silver: 500, gold: 600,
  bishop: 800, rook: 1000, promoted_pawn: 600, promoted_lance: 600,
  promoted_knight: 600, promoted_silver: 600, promoted_bishop: 1100,
  promoted_rook: 1300, king: 10000,
};

// Issue #193 / PR2: blunder guard 同点圏 tie-breaker の閾値 (cp)。
// ハングする手 (探索の最善手) の深いスコアが、最善の安全手より本値を超えて高ければ
// = 探索が明確な見返りを確認した戦術的犠牲とみなして尊重 (差替えない)。本値以内の
// 僅差 (同点圏) なら horizon 起因の無意味なハングとみなし安全手へ差替える。
// 旧実装の「無条件差替え」は戦術的犠牲も潰していたため棋力を落としていた。
// 初期値は保守的設定。実対局観察 (Vercel / 自己対戦) で要調整 (tunable)。
const BLUNDER_GUARD_TIE_MARGIN = 150;

// Issue #193 / PR2 (検証フィードバック): タダ捨て (無防備な駒の只取り) は全難易度で
// 原則防止する。ただし初級 (beginner / さくら) は弱さ演出として、この確率で guard を
// skip し意図的にタダ捨てを許容する。中級以上は常に防止 (skip なし)。
// 0.30 = 初級はタダ捨て機会の約 3 割で発生を許す初期値 (tunable、実対局観察で調整)。
const BEGINNER_TADASUTE_ALLOW_RATE = 0.3;

// ブランダーガード: 指した後に自駒がタダ取りまたは損な交換にさらされるかチェック
function hasHangingPiece(
  state: GameState,
  player: Player,
  variant: RuleVariant,
  minValue: number = 300
): boolean {
  const board = state.board;
  const { rows, cols } = variant.boardSize;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== player || piece.type === "king") continue;

      const value = BLUNDER_PIECE_VALUES[piece.type] ?? 0;
      if (value < minValue) continue;

      const pos = { row, col };
      if (isSquareAttackedByFast(board, pos, opponent, variant.boardSize)) {
        if (!isSquareAttackedByFast(board, pos, player, variant.boardSize)) {
          return true; // 攻撃されているが守られていない → タダ取り
        }
        // 守られているが、最安攻撃駒との交換で損する場合もブランダー
        const leastAttacker = getLeastAttackerValue(board, pos, opponent, variant.boardSize);
        if (leastAttacker > 0 && (value - leastAttacker) >= minValue) {
          return true; // 損な交換（例: 飛車を歩で攻撃されている）
        }
      }
    }
  }
  return false;
}

// 難易度の表示名
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
  expert: "超上級",
};

// Issue #176: Route Handler / hooks から呼ぶ統一 API。
// SearchContext を内部生成し、deadline 付き探索を行う。stats を返すので
// route 側で stoppedBy / depthCompleted / nodes をログに残せる。
// 旧 calculateAiMove は Stage B で削除済み。
export interface FindBestMoveOptions {
  signal?: AbortSignal;
  // Issue #193 / PR1a: 観戦モード (CPU vs CPU) で timeLimitMs を 1500ms 等に短縮するための override。
  // 未指定時は DIFFICULTY_PARAMS[difficulty].timeLimitMs (既存挙動) を使用。
  // 注: Phase B で本フィールドは廃止予定 (spectator フラグ経由に切替)。Phase A では既存挙動維持。
  timeLimitMs?: number;
  // Issue #193 / PR1c-2 Phase A (M-1 反映): 観戦モードフラグ。Phase B で route.ts が
  // `spectator: body.spectatorMode` を渡すように切替予定。Phase A 段階では未使用 (timeLimitMs 経路維持)。
  spectator?: boolean;
  // Issue #193 / PR1c-2 Phase A (M-2 反映): fixture 生成・検証専用の maxDepth 上書き。
  // 指定時は (1) 反復深化を maxDepth まで強制、(2) timeLimitMs 経路を実質無効化 (= Number.MAX_SAFE_INTEGER)
  // することで CPU 速度非依存の deterministic 結果を保証する。production では未指定。
  //
  // Number.MAX_SAFE_INTEGER 採用論証:
  // - search-context.ts:53-56 は deadlineAt = startedAt + timeLimitMs の絶対時刻加算
  // - search-context.ts:80 は performance.now() ベース (setTimeout 不使用)
  // - search.ts:537 は elapsedFromStart > timeLimitMs * 0.55 の相対経過比較
  // → Number.MAX_SAFE_INTEGER でも整数オーバーフローなく振る舞いキープ
  // Infinity でも動作するが、(1) 整数値, (2) TS number 型整合性, (3) JSON serialize 可能 の 3 点で優位。
  maxDepth?: number;
  // Issue #193 / PR1d-1: openingBook lookup の明示的 ON/OFF 制御。
  // 未指定時は strategy.useBook (DIFFICULTY_PARAMS 由来) を使用 = 既存挙動完全保持。
  // false 明示時は openingBook を完全 bypass。fixture 生成・検証で非決定性
  // (openingBook.ts:353 の Math.random 重み付き選択) を回避するために導入
  // (Issue #193 comment #4428841412: Phase B 動的検証で 5/360 件 (1.4%) 不一致検出経緯)。
  useBook?: boolean;
  // Issue #193 / PR1d-1: AI 探索に CardGameState を渡す経路 (W-6 反映で options 経由に統一)。
  // 未指定時は cardDigest 加算 skip (= 既存挙動完全保持、cardState 非依存の standard variant や
  // PR1c の 1000 局面 evaluate fixture の byte-level equality を維持)。
  // 指定時かつ variant.id === "card-shogi" のとき、findBestMoveWithStats 内で root で 1 回
  // computeCardDigest を呼び、cardDigest を引数として evaluate に伝播する (W-1 root スカラー方式)。
  cardState?: CardGameState;
}

export interface FindBestMoveResult {
  move: Move | null;
  // Issue #193 / PR1d-2: TurnAction (move / draw / playCard) として最良アクションを返す経路。
  // 設計意図:
  // - `move` フィールドは引き続き findBestMove (move-only 探索) の結果を保持し、route.ts / 上位フックの
  //   既存呼出経路は完全に振る舞いキープ (= playCard / draw が選ばれても move は move bestMove のまま)
  // - `action` フィールドは playCard / draw 採用時に対応する TurnAction を保持
  //   (上位 PR で UI 統合する際の伝播経路、PR1d-2 段階では SearchStats.usedCardAction で観測のみ)
  // - card-shogi variant 以外 / cardState 未渡時は `action: { kind: "move", move }` または null
  action: TurnAction | null;
  stats: SearchStats;
}

export function findBestMoveWithStats(
  state: GameState,
  player: Player,
  difficulty: Difficulty,
  variant: RuleVariant = STANDARD_VARIANT,
  options: FindBestMoveOptions = {},
): FindBestMoveResult {
  // Issue #193 / PR1c-2 Phase B: DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替。
  // createStrategy(difficulty, { spectator }) で Strategy インスタンスを取得し、
  // maxSearchDepth / timeLimitMs / addNoise / nearEqualThreshold / useBook を
  // 全てそこから取得する。spectator override (Math.min(base, SPECTATOR_TIME_LIMIT_MS))
  // は Strategy 構築時に処理済 (legacy-adapter.ts:50-52)。
  const strategy = createStrategy(difficulty, {
    spectator: options.spectator ?? false,
  });
  // PR1c-2 Phase A (MM-1 反映): options.maxDepth 指定時 (= fixture 生成・検証用途) は
  // timeLimitMs を実質無効化することで search.ts:537 の早期打切を回避し、必ず maxDepth に
  // 到達するまで探索を継続する (CPU 速度非依存)。
  // 互換性のため options.timeLimitMs (Phase A 維持) も引き続き尊重する (= 観戦モード旧経路、
  // route.ts は Phase B で spectator フラグ経由に切替済だが、外部呼出経路の互換性として残す)。
  const effectiveMaxDepth = options.maxDepth ?? strategy.maxSearchDepth;
  const effectiveTimeLimitMs = options.maxDepth !== undefined
    ? Number.MAX_SAFE_INTEGER
    : options.timeLimitMs ?? strategy.timeLimitMs;

  // Issue #193 / PR1d-1: cardDigest を root で 1 回計算 (W-1 root スカラー方式)。
  // 未指定時は undefined で SearchContext に格納 → evaluate 呼出時に cardDigest 加算 skip
  // = 既存挙動完全保持 (PR1c の 1000 局面 evaluate fixture の byte-level equality を維持)。
  // W-3 反映: variant.id === "card-shogi" の variant ガードもここで適用し、evaluate 内の
  // ガードと二重化することで standard variant への影響を完全排除。
  const cardDigest: CardDigest | undefined =
    options.cardState !== undefined && variant.id === "card-shogi"
      ? computeCardDigest(options.cardState)
      : undefined;

  const ctx = createSearchContext({
    timeLimitMs: effectiveTimeLimitMs,
    signal: options.signal,
    cardDigest,
  });

  // 定石ブック (序盤のみ)。
  // Issue #193 / PR1a: card-shogi では openingBook lookup を無効化。
  // ドロー/カード操作で board hash がズレるため定石が機能しないこと、および
  // 振る舞いキープ例外として明示的に「card-shogi の両者合計 30 ply (= 各 15 手)
  // で意図的振る舞い変更」を許容する。MAX_BOOK_MOVES * 2 は両者合計手数 (ply) で、
  // MAX_BOOK_MOVES = 15 (各プレイヤー側の手数上限)。
  // PR1c-2 Phase B: useBook も Strategy 経由参照に変更。
  // PR1d-1: options.useBook が明示指定された場合はそれを優先 (false で openingBook 完全 bypass)。
  // 未指定時は strategy.useBook (DIFFICULTY_PARAMS 由来) = 既存挙動完全保持。
  const effectiveUseBook = options.useBook !== undefined ? options.useBook : strategy.useBook;
  const useBookForVariant = effectiveUseBook && variant.id === "standard";
  let usedBook = false;
  let bookMove: Move | null = null;
  if (useBookForVariant && state.moveCount < MAX_BOOK_MOVES * 2) {
    const candidate = getBookMove(state, player);
    if (candidate) {
      const legalMoves = getFullLegalMoves(state, player, variant);
      const isLegal = legalMoves.some(
        (m) =>
          m.type === candidate.type &&
          m.to.row === candidate.to.row &&
          m.to.col === candidate.to.col &&
          (candidate.type === "drop"
            ? m.dropPiece === candidate.dropPiece
            : m.from?.row === candidate.from?.row &&
              m.from?.col === candidate.from?.col &&
              (m.promote ?? false) === (candidate.promote ?? false))
      );
      if (isLegal) {
        bookMove = candidate;
        usedBook = true;
      }
    }
  }

  if (bookMove) {
    return {
      move: bookMove,
      action: { kind: "move", move: bookMove },
      stats: finalizeStats(ctx, { usedBook: true, usedFallback: false }),
    };
  }

  // 探索
  const searchResult = findBestMove(
    state,
    player,
    {
      maxDepth: effectiveMaxDepth,
      timeLimitMs: effectiveTimeLimitMs,
      addNoise: strategy.addNoise,
      nearEqualThreshold: strategy.nearEqualThreshold,
    },
    variant,
    ctx,
  );

  // depth 1 すら完了しなかった場合の server fallback (合法手の先頭を返す)。
  // Issue #176: client 側 fallback は持たない方針なので、ここで必ず非 null を返したい。
  let move = searchResult?.move ?? null;
  // Issue #193 / PR2: blunder guard の同点圏 tie-breaker 用に root 各手の深いスコアを保持。
  const rootMoveScores = searchResult?.rootMoveScores ?? [];
  let usedFallback = false;
  if (move === null) {
    const legal = getFullLegalMoves(state, player, variant);
    if (legal.length > 0) {
      move = legal[0];
      usedFallback = true;
    }
  }

  // Issue #193 / PR1d-2: card-shogi の root で playCard / draw 候補を評価して最良 TurnAction を決定。
  //
  // 設計意図:
  // - move は findBestMove (反復深化 + negamax) で深く読んだ結果を活用
  // - playCard / draw は CurrentRules.getLegalActions で候補生成 → evaluateAction で浅く評価 (depth=0)
  // - 公平比較のため、move も evaluateAction で浅く再評価して比較基準を統一
  //   (= move の深く読んだ bestScore は内部状態で取得困難なため、再評価で代替)
  // - 浅い比較は move の深さ優位を失うが、playCard / draw を頻繁に過剰採用するリスクを抑える
  //   ため、move 採用が原則になる保守的振る舞い (棋力退化防止)
  //
  // 振る舞いキープ:
  // - variant.id !== "card-shogi" / options.cardState 未渡 / fallback 経路では playCard 評価 skip
  //   = 既存 standard variant や PR1c-2 完了時点と完全同一
  // - move フィールドは findBestMove 結果のまま (= UI / route.ts への伝播は move-only、
  //   PR1d-2 段階では action フィールドは observability 用途のみ、上位 PR で UI 統合)
  let selectedAction: TurnAction | null = move !== null ? { kind: "move", move } : null;
  let usingCardAction = false;

  // Issue #193 / PR2 (検証フィードバック): タダ捨て (無防備な駒の只取り) を全難易度で
  // 原則防止する。初級 (beginner) のみ弱さ演出として確率的に guard を skip し許容する。
  // この 1 つの判定でカード経由タダ捨て除外と駒移動 blunder guard の両方を制御し、
  // 同一ターン内で挙動を一致させる。
  const applyTadasuteGuard =
    difficulty !== "beginner" || Math.random() >= BEGINNER_TADASUTE_ALLOW_RATE;

  if (
    !usedFallback &&
    move !== null &&
    variant.id === "card-shogi" &&
    options.cardState !== undefined
  ) {
    const rules = new CurrentRules(variant);
    const aiTurnState: AiTurnState = {
      gameState: state,
      cardState: options.cardState,
      doubleMove: null,
      isRoot: true,
    };
    const allActions = rules.getLegalActions(aiTurnState, player);

    // move を evaluateAction で浅く再評価 (= 比較基準を統一)
    let bestActionScore = evaluateAction(
      aiTurnState,
      { kind: "move", move },
      player,
      variant,
      ctx,
      applyTadasuteGuard,
    );

    for (const action of allActions) {
      if (action.kind === "move") continue; // move は上で評価済
      // applyTadasuteGuard 時、カード適用がタダ捨てになる手は evaluateAction が -Inf を返し
      // 採用されない (例: 二歩指しで相手飛車前に歩を打つ)。
      const score = evaluateAction(
        aiTurnState,
        action,
        player,
        variant,
        ctx,
        applyTadasuteGuard,
      );
      if (score > bestActionScore) {
        bestActionScore = score;
        selectedAction = action;
        usingCardAction = true;
      }
    }
  }

  // ブランダーガード (駒移動のタダ捨て防止)。
  // Issue #193 / PR2: 旧実装は advanced/expert 限定だったが、検証フィードバックを受け
  // 「タダ捨ては全難易度で防止 (初級のみ確率的に許容)」へ変更。applyTadasuteGuard で
  // 制御する (初級は BEGINNER_TADASUTE_ALLOW_RATE の確率で false = 許容)。
  // PR1d-2 (M-2 / N-7 反映): usingCardAction = true (= playCard / draw 採用) のとき
  // blunder guard を skip。理由: pawn_return / piece_return が「自駒タダ取り回避」役を
  // 担う場合、hasHangingPiece による move 差替と二重発動するため、構造的排他制御で防ぐ
  // (カード経由のタダ捨ては evaluateAction の excludeTadasute で別途除外済)。
  if (applyTadasuteGuard && !usingCardAction && !usedFallback && move !== null) {
    const nextState = applyMoveForSearch(state, move);
    if (hasHangingPiece(nextState, player, variant)) {
      const legalMoves = getFullLegalMoves(state, player, variant);
      const safeMoves = legalMoves.filter((m) => {
        const ns = applyMoveForSearch(state, m);
        return !hasHangingPiece(ns, player, variant);
      });
      if (safeMoves.length > 0) {
        // Issue #193 / PR2: 同点圏 tie-breaker 化。
        // 旧実装は「ハングする手を無条件で安全手へ差替え」ており、探索が見返りを
        // 確認した戦術的駒捨て (犠牲) まで潰して棋力を落としていた。本実装では root の
        // 深い探索スコアで「ハング手」と「最善安全手」を比較し:
        //  - ハング手が安全手より TIE_MARGIN を超えて高い (= 探索が明確な見返りを確認した
        //    犠牲) → 尊重し差替えない
        //  - 僅差 (同点圏 = TIE_MARGIN 以内) → 安全手へ差替え (horizon 起因の無意味な
        //    ハングを防ぐ安全網を維持)
        // 深いスコアが取得できない場合 (root に無い安全手のみ等) は静的評価で代替し、
        // 従来同様に差替える (安全網フォールバック)。
        const deepScoreOf = (m: Move): number | undefined =>
          rootMoveScores.find((rms) => movesEqual(rms.move, m))?.score;

        const moveDeepScore = deepScoreOf(move);

        // 安全手のうち深いスコアが取得できるものを候補化。
        const safeCandidates: SafeCandidate[] = [];
        for (const m of safeMoves) {
          const d = deepScoreOf(m);
          if (d !== undefined) safeCandidates.push({ move: m, deepScore: d });
        }

        if (moveDeepScore !== undefined && safeCandidates.length > 0) {
          // 深いスコアで同点圏 tie-breaker (純粋関数で判定)。
          const chosen = chooseBlunderGuardMove(
            move,
            moveDeepScore,
            safeCandidates,
            BLUNDER_GUARD_TIE_MARGIN,
          );
          if (chosen !== move) {
            move = chosen;
            selectedAction = { kind: "move", move };
          }
          // chosen === move のときは戦術的犠牲を尊重 (差替えない)
        } else {
          // 深いスコア未取得 (move が root に無い / 安全手が探索未考慮等) → 静的評価で
          // 最善安全手を選び差替える (安全網フォールバック)。
          let bestSafeScore = -Infinity;
          let bestStaticSafeMove = safeMoves[0];
          for (const m of safeMoves) {
            const ns = applyMoveForSearch(state, m);
            // PR1d-1: cardDigest を伝播 (W-1 root スカラー方式、未渡時は既存挙動)
            const rawScore = evaluate(ns, variant, cardDigest);
            const score = player === "sente" ? rawScore : -rawScore;
            if (score > bestSafeScore) {
              bestSafeScore = score;
              bestStaticSafeMove = m;
            }
          }
          move = bestStaticSafeMove;
          selectedAction = { kind: "move", move };
        }
      }
    }
  }

  // Issue #193 / PR2: 評価値内訳の本番有効化 (PR1c の evaluateWithBreakdown 足場を活用)。
  // DEBUG_AI_EVAL=true のときだけ root 局面と採用手適用後の評価成分内訳を server ログへ
  // 出力する。env ガードで短絡するため通常運用 (フラグ未設定) では一切コストが掛からない。
  // findBestMoveWithStats は AI route (server) からのみ呼ばれるため process.env を参照可。
  if (process.env.DEBUG_AI_EVAL === "true") {
    const rootBreakdown = evaluateWithBreakdown(state, variant);
    const movedBreakdown =
      move !== null ? evaluateWithBreakdown(applyMoveForSearch(state, move), variant) : null;
    console.log(
      `[ai-eval] player=${player} difficulty=${difficulty} ` +
        `root=${JSON.stringify(rootBreakdown)} ` +
        `afterMove=${movedBreakdown ? JSON.stringify(movedBreakdown) : "null"}`,
    );
  }

  return {
    move,
    action: selectedAction,
    stats: finalizeStats(ctx, { usedBook, usedFallback, usedCardAction: usingCardAction }),
  };
}
