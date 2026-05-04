"use client";

// PieceFlight アニメーション (歩戻し / 駒戻し / 二歩指し / 王手崩し で使用)
// のパラメータを localStorage に保存し、ゲーム本体・dev 検証ページの両方
// から読み書きできるようにする小さなストア。
//
// dev /piece-flight で「保存」したらこの localStorage に書き込まれ、
// ゲーム側 (card-shogi-game.tsx) が useFlightParams で読んで PieceFlight に
// 渡す。未保存の場合は animation-constants の既定値を返す。

import { useSyncExternalStore } from "react";

import {
  PIECE_SPEED_PX_PER_SEC,
  PIECE_ROTATION_SEC_PER_TURN,
  PIECE_MIN_DURATION_MS,
} from "@/components/game/card-shogi/animation-constants";

export type EaseOption =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "circIn"
  | "circOut"
  | "anticipate";

export interface FlightParams {
  speedPxPerSec: number;
  rotationSecPerTurn: number;
  minDurationMs: number;
  ease: EaseOption;
}

// animation-constants の既定値 + デフォルト easing。これらはゲームに反映される
// 「未カスタム時の値」。dev で保存すると上書きされる。
export const DEFAULT_FLIGHT_PARAMS: FlightParams = {
  speedPxPerSec: PIECE_SPEED_PX_PER_SEC,
  rotationSecPerTurn: PIECE_ROTATION_SEC_PER_TURN,
  minDurationMs: PIECE_MIN_DURATION_MS,
  ease: "easeInOut",
};

const STORAGE_KEY = "dev:flight-params:v1";

const VALID_EASES: ReadonlySet<EaseOption> = new Set([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "circIn",
  "circOut",
  "anticipate",
]);

function parseStored(raw: string | null): FlightParams {
  if (!raw) return DEFAULT_FLIGHT_PARAMS;
  try {
    const obj = JSON.parse(raw) as Partial<FlightParams>;
    return {
      speedPxPerSec:
        typeof obj.speedPxPerSec === "number" && obj.speedPxPerSec > 0
          ? obj.speedPxPerSec
          : DEFAULT_FLIGHT_PARAMS.speedPxPerSec,
      rotationSecPerTurn:
        typeof obj.rotationSecPerTurn === "number" && obj.rotationSecPerTurn > 0
          ? obj.rotationSecPerTurn
          : DEFAULT_FLIGHT_PARAMS.rotationSecPerTurn,
      minDurationMs:
        typeof obj.minDurationMs === "number" && obj.minDurationMs >= 0
          ? obj.minDurationMs
          : DEFAULT_FLIGHT_PARAMS.minDurationMs,
      ease:
        typeof obj.ease === "string" && VALID_EASES.has(obj.ease as EaseOption)
          ? (obj.ease as EaseOption)
          : DEFAULT_FLIGHT_PARAMS.ease,
    };
  } catch {
    return DEFAULT_FLIGHT_PARAMS;
  }
}

let cached: FlightParams | null = null;
const listeners = new Set<() => void>();

function readStorage(): FlightParams {
  if (typeof window === "undefined") return DEFAULT_FLIGHT_PARAMS;
  try {
    return parseStored(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_FLIGHT_PARAMS;
  }
}

function getSnapshot(): FlightParams {
  if (cached === null) cached = readStorage();
  return cached;
}

function getServerSnapshot(): FlightParams {
  return DEFAULT_FLIGHT_PARAMS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 別タブから保存/削除された場合に追従するため storage イベントを購読する。
// モジュール初回 import 時に 1 回だけ登録する (use client によりクライアント
// のみで実行)。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cached = readStorage();
      listeners.forEach((l) => l());
    }
  });
}

/**
 * useSyncExternalStore で localStorage の値に追従。
 * SSR では DEFAULT_FLIGHT_PARAMS を返し、クライアント mount 後にハイドレートして
 * 保存値があれば差し替える。
 */
export function useFlightParams(): FlightParams {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** 値を localStorage に保存し、購読者全員に通知する。 */
export function saveFlightParams(params: FlightParams): void {
  cached = { ...params };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } catch {
      // quota 等のエラーは握り潰す (cached は更新済なので画面には反映される)
    }
  }
  listeners.forEach((l) => l());
}

/** localStorage の保存をクリアし、デフォルト値に戻す。 */
export function resetFlightParams(): void {
  cached = DEFAULT_FLIGHT_PARAMS;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  listeners.forEach((l) => l());
}

/** 2つの FlightParams が等しいかを判定 (浅い比較)。 */
export function isFlightParamsEqual(a: FlightParams, b: FlightParams): boolean {
  return (
    a.speedPxPerSec === b.speedPxPerSec &&
    a.rotationSecPerTurn === b.rotationSecPerTurn &&
    a.minDurationMs === b.minDurationMs &&
    a.ease === b.ease
  );
}
