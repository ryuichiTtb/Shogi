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
// - BGM: Issue #189 でホーム到達直後の BGM 初回再生ラグを短縮するため
//   bgm_home / bgm_match_setup の URL も同じく先読みする (現状この 2 つは
//   同一ファイル `ファンタジー-日常-.mp3` を共有しているため Set で重複排除)。
//   対局中の BGM (bgm_game / bgm_game_over) はロビー段階では不要なので含めない。
const PRELOAD_BGM_KEYS = ["bgm_home", "bgm_match_setup"] as const;

export function useAssetPreloader() {
  // URL → HTMLAudioElement の Map。重複ロードを防ぐためコンポーネント
  // ライフサイクル全体で保持。
  const loadedRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // SFX + ロビー BGM の一括先読み (mount 時に 1 回)。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const map = loadedRef.current;

    const urls = new Set<string>();
    for (const url of AUDIO_MANIFEST.sfxUrls) urls.add(url);
    for (const key of PRELOAD_BGM_KEYS) {
      const path = AUDIO_MANIFEST.bgm[key];
      if (path) urls.add(path);
    }

    for (const url of urls) {
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
