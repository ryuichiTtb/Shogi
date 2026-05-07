// Issue #79: 波形ビジュアライザの共有定数。
// scripts/build-waveform-peaks.ts (ビルドタイム生成) と
// src/components/dev/sound-waveform.tsx (実行時描画) で同じ値を使う必要があり、
// マジックナンバー化を避けるため 1 ヶ所に集約。

// 波形バー数。80 = 大半の SE (1秒未満) でも視認可能、
// game-start (~10秒) でも潰れない妥協値。
export const WAVEFORM_BIN_COUNT = 80;

// 数値精度。peaks-data.ts の git diff 安定化のため固定精度で出力する。
// 4桁あれば見た目 0.5px の誤差も発生しない。
export const WAVEFORM_FLOAT_PRECISION = 4;
