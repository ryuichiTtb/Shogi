"use client";

import { useEffect, useRef } from "react";

import {
  AUDIO_MANIFEST,
  resolveBgmPrimary,
} from "@/lib/audio/manifest";

interface UseAssetPreloaderOptions {
  // 選択中キャラの ID。変わるたびにそのキャラの BGM を先読みする。
  selectedCharacterId?: string;
}

// Step 4 (Issue #107): ロビー画面でアセットを先読みするためのフック。
// 対局画面 mount 時に一気に load すると最初の SE 再生が遅延するため、
// ホーム表示中に裏で軽くロードしておく。
//
// 設計:
// - SFX: <audio> 要素を muted で生成し audio.load() するだけ。Howler を
//   ロビー時点で初期化したくないため (バンドルとオーバーヘッドを抑える)。
//   対局画面で Howler が改めて Howl({ src: [...], preload: true }) を呼ぶ
//   ときには HTTP cache 経由でほぼ即時に decode できる。
// - BGM: 同じく <audio> を muted で軽く load。html5 mode の Howl は
//   そもそもストリーミング前提なので、ファイル先頭部の prefetch だけで OK。
// - 同じ URL を二重に load しないよう Map で重複排除。
// - キャラ選択が変わったら旧キャラ BGM の先読みは中断 (audio を null 化)
//   するが、HTTP cache には残るので問題なし。
export function useAssetPreloader({ selectedCharacterId }: UseAssetPreloaderOptions = {}) {
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

  // 選択中キャラの BGM 先読み (キャラ変更時に切替)。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedCharacterId) return;
    const track = AUDIO_MANIFEST.bgmByCharacter[selectedCharacterId];
    const url = resolveBgmPrimary(track);
    if (!url) return;
    const map = loadedRef.current;
    if (map.has(url)) return;
    try {
      const audio = new Audio();
      audio.preload = "auto";
      audio.muted = true;
      audio.src = url;
      audio.load();
      map.set(url, audio);
    } catch {
      // 同上、autoplay policy 等は無視
    }
  }, [selectedCharacterId]);
}
