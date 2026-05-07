"use client";

// Issue #79 (PR 1.7): server component な page から BGM 機構 (useBgm) を
// 呼ぶための薄いラッパー。`<BgmProvider eventKey="bgm_home" />` を
// page の JSX に挿入するだけ。何も描画しない (return null)。
//
// useBgm 自体は client-only hook のため、server component で直接呼べない
// ことへの解決策。client component な page では useBgm を直接呼んでも OK。

import { useBgm } from "@/hooks/use-bgm";
import type { BgmEventKey } from "@/lib/dev/sound-overrides";

interface BgmProviderProps {
  eventKey: BgmEventKey | null;
}

export function BgmProvider({ eventKey }: BgmProviderProps): null {
  useBgm(eventKey);
  return null;
}
