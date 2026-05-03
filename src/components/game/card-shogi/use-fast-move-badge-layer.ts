"use client";

import { useCallback, useRef, useState } from "react";

import type { FastMoveBadgeItem } from "./fast-move-badge";

// Step 5 (Issue #107): 早指しバッジの state / id ref / trigger / remove を集約。
// マナフライトと同じ ID 管理パターン (useManaFlightLayer と対称)。
export function useFastMoveBadgeLayer() {
  const [items, setItems] = useState<FastMoveBadgeItem[]>([]);
  const idRef = useRef(0);

  const trigger = useCallback((rect: DOMRect | null) => {
    if (!rect) return;
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => [...prev, { id, rect }]);
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return { items, trigger, remove };
}
