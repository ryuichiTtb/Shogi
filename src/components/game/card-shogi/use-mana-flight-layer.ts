"use client";

import { useCallback, useRef, useState } from "react";

import type { ManaFlightItem } from "./mana-flight";

// Step 5 (Issue #107): card-shogi-game.tsx に散在していたマナ浮遊演出の
// state / ref / trigger / remove を 1 フックに集約。多重発火に耐える ID 管理は
// useRef でカウントアップする方式を維持 (id 衝突防止の最低限)。
export function useManaFlightLayer() {
  const [items, setItems] = useState<ManaFlightItem[]>([]);
  const idRef = useRef(0);

  const trigger = useCallback((delta: number, rect: DOMRect | null) => {
    if (!rect || delta === 0) return;
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => [...prev, { id, delta, rect }]);
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { items, trigger, remove };
}
