"use client";

/**
 * 駒取り時の火花エフェクト
 * - 中央の衝撃フラッシュ
 * - 放射状に飛び散る火花パーティクル（8個）
 */

const SPARK_COUNT = 8;

// 各火花の飛散方向（360度を均等に分割し、少しランダム感を持たせる）
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, i) => {
  const baseAngle = (360 / SPARK_COUNT) * i;
  // ±20度のばらつき（ビルド時に固定される擬似ランダム）
  const offset = ((i * 37 + 13) % 41) - 20;
  const angle = baseAngle + offset;
  const rad = (angle * Math.PI) / 180;
  // 飛距離もばらつかせる（70%~130%）
  const distance = 0.7 + ((i * 53 + 7) % 61) / 100;
  return { angle, rad, distance, delay: i * 15 };
});

interface CaptureEffectProps {
  squareSize: number;
}

export function CaptureEffect({ squareSize }: CaptureEffectProps) {
  const sparkLength = Math.max(4, squareSize * 0.18);
  const sparkWidth = Math.max(2, squareSize * 0.06);
  const maxTravel = squareSize * 0.7;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-10">
      {/* 中央の衝撃フラッシュ */}
      <div className="capture-flash absolute inset-[-15%] rounded-full" />

      {/* 火花パーティクル */}
      {SPARKS.map((spark, i) => (
        <div
          key={i}
          className="capture-spark absolute rounded-full"
          style={{
            width: sparkWidth,
            height: sparkLength,
            left: "50%",
            top: "50%",
            marginLeft: -sparkWidth / 2,
            marginTop: -sparkLength / 2,
            rotate: `${spark.angle + 90}deg`,
            "--spark-tx": `${Math.cos(spark.rad) * maxTravel * spark.distance}px`,
            "--spark-ty": `${Math.sin(spark.rad) * maxTravel * spark.distance}px`,
            animationDelay: `${spark.delay}ms`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
