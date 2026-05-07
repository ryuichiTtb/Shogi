"use client";

import { useEffect, useRef } from "react";

import { AUDIO_MANIFEST } from "@/lib/audio/manifest";

// Step 4 (Issue #107): ロビー画面でアセットを先読みするためのフック。
// 対局画面 mount 時に一気に load すると最初の SE 再生が遅延するため、
// ホーム表示中に裏で軽くロードしておく。
//
// 設計:
// - SFX: <audio> 要素を muted で生成し audio.load() するだけ。Howler を
//   ロビー時点で初期化したくないため (バンドルとオーバーヘッドを抑える)。
//   対局画面で Howler が改めて Howl({ src: [...], preload: true }) を呼ぶ
//   ときには HTTP cache 経由でほぼ即時に decode できる。
// - 同じ URL を二重に load しないよう Map で重複排除。
// - BGM 先読みは廃止 (#79: キャラ別 BGM 撤去 + dev tool override 設計に統一)。
export function useAssetPreloader() {
  // URL → HTMLAudioElement の Map。重複ロードを防ぐためコンポーネント
  // ライフサイクル全体で保持。
  const loadedRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // SFX 一括先読み (mount 時に 1 回)。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const map = loadedRef.current;
    for (const url of AUDIO_MANIFEST.sfxUrls) {
      if (map.has(url)) continue;
      try {
        const audio = new Audio();
        audio.preload = "auto";
        audio.muted = true;
        audio.src = url;
        // load() を明示呼出 (Safari で preload="auto" だけでは取得が遅延する場合あり)
        audio.load();
        map.set(url, audio);
      } catch {
        // ブラウザ依存の例外 (autoplay policy 等) は無視。本物の再生は対局画面で行う。
      }
    }
    // ロビー unmount でも cache は残す: 対局画面に遷移したあと Howler が
    // 同 URL を取りに行くときに HTTP cache hit したいため明示破棄しない。
  }, []);
}
