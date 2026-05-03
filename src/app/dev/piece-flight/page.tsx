"use client";

// PieceFlight アニメーション検証用モック画面 (Issue #82 関連)。
// 移動速度・回転周期・最小再生時間・イージング・駒サイズ等を画面上で
// リアルタイムに調整しながら、from→to のフライト演出をボタンで何度でも
// 再生できる。本番経路 (歩戻し / 駒戻し / 二歩指し / 王手崩し) には影響しない。

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShogiPiece } from "@/components/game/shogi-piece";
import { PieceFlight, type PieceFlightSpec } from "@/components/game/card-shogi/piece-flight";
import {
  PIECE_SIZE as DEFAULT_PIECE_SIZE,
  PIECE_SPEED_PX_PER_SEC as DEFAULT_SPEED,
  PIECE_ROTATION_SEC_PER_TURN as DEFAULT_ROT_SEC,
  PIECE_MIN_DURATION_MS as DEFAULT_MIN_MS,
} from "@/components/game/card-shogi/animation-constants";
import type { Player } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";

type EaseOption = "linear" | "easeIn" | "easeOut" | "easeInOut" | "circIn" | "circOut" | "anticipate";

const PIECE_TYPES: Array<{ value: string; label: string }> = [
  { value: "pawn", label: "歩" },
  { value: "lance", label: "香" },
  { value: "knight", label: "桂" },
  { value: "silver", label: "銀" },
  { value: "gold", label: "金" },
  { value: "bishop", label: "角" },
  { value: "rook", label: "飛" },
  { value: "king", label: "王" },
  { value: "promoted_pawn", label: "と" },
  { value: "promoted_lance", label: "成香" },
  { value: "promoted_knight", label: "成桂" },
  { value: "promoted_silver", label: "成銀" },
  { value: "promoted_bishop", label: "馬" },
  { value: "promoted_rook", label: "龍" },
];

const EASE_OPTIONS: EaseOption[] = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "circIn",
  "circOut",
  "anticipate",
];

const PRESET_DISTANCES: Array<{ label: string; from: { x: number; y: number }; to: { x: number; y: number } }> = [
  { label: "短距離 (横 200px)", from: { x: 100, y: 200 }, to: { x: 300, y: 200 } },
  { label: "中距離 (横 400px)", from: { x: 80, y: 250 }, to: { x: 480, y: 250 } },
  { label: "長距離 (横 700px)", from: { x: 60, y: 300 }, to: { x: 760, y: 300 } },
  { label: "対角線 (左上→右下)", from: { x: 80, y: 80 }, to: { x: 720, y: 480 } },
  { label: "対角線 (右上→左下)", from: { x: 720, y: 80 }, to: { x: 80, y: 480 } },
  { label: "縦 (上→下)", from: { x: 400, y: 80 }, to: { x: 400, y: 480 } },
];

export default function PieceFlightDevPage() {
  // 検証パラメータ
  const [speedPxPerSec, setSpeedPxPerSec] = useState(DEFAULT_SPEED);
  const [rotationSecPerTurn, setRotationSecPerTurn] = useState(DEFAULT_ROT_SEC);
  const [minDurationMs, setMinDurationMs] = useState(DEFAULT_MIN_MS);
  const [pieceSize, setPieceSize] = useState(DEFAULT_PIECE_SIZE);
  const [ease, setEase] = useState<EaseOption>("linear");
  const [pieceType, setPieceType] = useState("pawn");
  const [owner, setOwner] = useState<Player>("sente");
  const [playerColor, setPlayerColor] = useState<Player>("sente");

  // モックステージ上の from / to 位置 (ステージ内座標)
  const [presetIdx, setPresetIdx] = useState(1); // デフォルト中距離

  // フライト起動
  const stageRef = useRef<HTMLDivElement>(null);
  const [flight, setFlight] = useState<PieceFlightSpec | null>(null);
  const flightKeyRef = useRef(0);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const [lastRotateDeg, setLastRotateDeg] = useState<number | null>(null);

  const triggerFlight = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const preset = PRESET_DISTANCES[presetIdx];
    const fromX = stageRect.left + preset.from.x;
    const fromY = stageRect.top + preset.from.y;
    const toX = stageRect.left + preset.to.x;
    const toY = stageRect.top + preset.to.y;

    // 計算結果のプレビュー (本体ロジックと同じ計算式)
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const durationMs = Math.max(minDurationMs, (distance / speedPxPerSec) * 1000);
    const rotateDeg = (durationMs / 1000 / rotationSecPerTurn) * 360;
    setLastDuration(durationMs);
    setLastRotateDeg(rotateDeg);

    flightKeyRef.current += 1;
    setFlight({
      pieceType,
      owner,
      fromX,
      fromY,
      toX,
      toY,
    });
  }, [presetIdx, minDurationMs, speedPxPerSec, rotationSecPerTurn, pieceType, owner]);

  const handleComplete = useCallback(() => {
    setFlight(null);
  }, []);

  const resetDefaults = () => {
    setSpeedPxPerSec(DEFAULT_SPEED);
    setRotationSecPerTurn(DEFAULT_ROT_SEC);
    setMinDurationMs(DEFAULT_MIN_MS);
    setPieceSize(DEFAULT_PIECE_SIZE);
    setEase("linear");
  };

  const preset = PRESET_DISTANCES[presetIdx];
  const presetDistance = Math.hypot(
    preset.to.x - preset.from.x,
    preset.to.y - preset.from.y,
  );

  return (
    <main className="min-h-dvh bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        <header className="flex items-center gap-3 mb-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            ホーム
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">PieceFlight 動作検証</h1>
            <p className="text-xs text-muted-foreground">
              歩戻し / 駒戻し / 二歩指し / 王手崩し で使われている駒移動アニメーションのチューニング用モック
            </p>
          </div>
        </header>

        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          {/* ===== コントロールパネル ===== */}
          <Card className="p-4 flex flex-col gap-4">
            <Slider
              label="移動速度"
              unit="px/sec"
              min={100}
              max={6000}
              step={50}
              value={speedPxPerSec}
              onChange={setSpeedPxPerSec}
              defaultValue={DEFAULT_SPEED}
            />
            <Slider
              label="回転周期"
              unit="sec/turn"
              min={0.05}
              max={2}
              step={0.05}
              precision={2}
              value={rotationSecPerTurn}
              onChange={setRotationSecPerTurn}
              defaultValue={DEFAULT_ROT_SEC}
            />
            <Slider
              label="最小再生時間"
              unit="ms"
              min={0}
              max={2000}
              step={20}
              value={minDurationMs}
              onChange={setMinDurationMs}
              defaultValue={DEFAULT_MIN_MS}
            />
            <Slider
              label="駒サイズ"
              unit="px"
              min={32}
              max={160}
              step={4}
              value={pieceSize}
              onChange={setPieceSize}
              defaultValue={DEFAULT_PIECE_SIZE}
            />

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">イージング (transition.ease)</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-background"
                value={ease}
                onChange={(e) => setEase(e.target.value as EaseOption)}
              >
                {EASE_OPTIONS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">駒種</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-background"
                value={pieceType}
                onChange={(e) => setPieceType(e.target.value)}
              >
                {PIECE_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} ({p.value})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">駒所有者 (owner)</label>
                <div className="flex gap-1">
                  <ToggleButton active={owner === "sente"} onClick={() => setOwner("sente")}>
                    先手
                  </ToggleButton>
                  <ToggleButton active={owner === "gote"} onClick={() => setOwner("gote")}>
                    後手
                  </ToggleButton>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">視点 (playerColor)</label>
                <div className="flex gap-1">
                  <ToggleButton active={playerColor === "sente"} onClick={() => setPlayerColor("sente")}>
                    先手
                  </ToggleButton>
                  <ToggleButton active={playerColor === "gote"} onClick={() => setPlayerColor("gote")}>
                    後手
                  </ToggleButton>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">距離プリセット</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-background"
                value={presetIdx}
                onChange={(e) => setPresetIdx(Number(e.target.value))}
              >
                {PRESET_DISTANCES.map((p, i) => (
                  <option key={i} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                距離 ≈ {presetDistance.toFixed(0)}px
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t">
              <Button onClick={triggerFlight} className="w-full">
                ▶ フライト発火
              </Button>
              <Button onClick={resetDefaults} variant="outline" size="sm" className="w-full">
                数値をデフォルトへリセット
              </Button>
            </div>

            {lastDuration !== null && lastRotateDeg !== null && (
              <div className="flex flex-col gap-1 pt-2 border-t text-xs">
                <p className="font-medium">直前の実行値:</p>
                <p>duration: <span className="font-mono">{lastDuration.toFixed(0)}ms</span></p>
                <p>回転総量: <span className="font-mono">{lastRotateDeg.toFixed(0)}°</span> ({(lastRotateDeg / 360).toFixed(2)} 周)</p>
              </div>
            )}
          </Card>

          {/* ===== ステージ ===== */}
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">ステージ (800 × 560)</Badge>
              <Badge variant="secondary" className="text-[10px]">
                from = 青枠 / to = 緑枠
              </Badge>
            </div>
            <div
              ref={stageRef}
              className="relative w-full overflow-hidden rounded-md border-2 border-dashed border-border bg-muted/30"
              style={{ height: 560, maxWidth: 800 }}
            >
              {/* From マーカー */}
              <div
                className="absolute flex items-center justify-center rounded border-2 border-blue-500 bg-blue-500/10 text-xs font-bold text-blue-700 dark:text-blue-300"
                style={{
                  left: preset.from.x - pieceSize / 2,
                  top: preset.from.y - pieceSize / 2,
                  width: pieceSize,
                  height: pieceSize,
                }}
              >
                FROM
              </div>
              {/* To マーカー */}
              <div
                className="absolute flex items-center justify-center rounded border-2 border-green-500 bg-green-500/10 text-xs font-bold text-green-700 dark:text-green-300"
                style={{
                  left: preset.to.x - pieceSize / 2,
                  top: preset.to.y - pieceSize / 2,
                  width: pieceSize,
                  height: pieceSize,
                }}
              >
                TO
              </div>
              {/* From → To の経路ラインを薄く描画 */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 800 560"
                preserveAspectRatio="none"
                aria-hidden
              >
                <line
                  x1={preset.from.x}
                  y1={preset.from.y}
                  x2={preset.to.x}
                  y2={preset.to.y}
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                  className="text-muted-foreground"
                />
              </svg>

              {/* 駒プレビュー (フライトしていない時のサンプル表示) */}
              {!flight && (
                <div
                  className="absolute"
                  style={{
                    left: preset.from.x - pieceSize / 2,
                    top: preset.from.y - pieceSize / 2,
                    width: pieceSize,
                    height: pieceSize,
                  }}
                >
                  <ShogiPiece
                    piece={{ type: pieceType, owner }}
                    playerColor={playerColor}
                    squareSize={pieceSize}
                  />
                </div>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground">
              本番値: 移動 {DEFAULT_SPEED} px/sec / 回転 {DEFAULT_ROT_SEC} sec/turn / 最小 {DEFAULT_MIN_MS}ms / 駒 {DEFAULT_PIECE_SIZE}px
            </div>
          </Card>
        </div>

        {/* PieceFlight 本体 (検証用上書きパラメータあり) */}
        <PieceFlight
          spec={flight}
          flightKey={flight ? flightKeyRef.current : null}
          playerColor={playerColor}
          onComplete={handleComplete}
          speedPxPerSec={speedPxPerSec}
          rotationSecPerTurn={rotationSecPerTurn}
          minDurationMs={minDurationMs}
          pieceSize={pieceSize}
          ease={ease}
        />
      </div>
    </main>
  );
}

// ===== ローカル UI ヘルパ =====

interface SliderProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  precision?: number;
  value: number;
  onChange: (v: number) => void;
  defaultValue: number;
}

function Slider({ label, unit, min, max, step, precision = 0, value, onChange, defaultValue }: SliderProps) {
  const isDefault = Math.abs(value - defaultValue) < 1e-9;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium">{label}</label>
        <span className={cn("text-xs font-mono tabular-nums", isDefault && "text-muted-foreground")}>
          {value.toFixed(precision)} {unit}
          {!isDefault && <span className="text-muted-foreground ml-1">(default {defaultValue.toFixed(precision)})</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 px-2 py-1 rounded text-xs border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
