"use client";

import { useEffect, useRef } from "react";

import { AUDIO_MANIFEST } from "@/lib/audio/manifest";
import { getCharacterById } from "@/data/characters";

interface UseAssetPreloaderOptions {
  // 選択中キャラの ID。変わるたびにそのキャラの BGM (character.bgmTrack)
  // を先読み。未指定なら BGM 先読みは行わない (SFX のみ)。
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
//   ストリーミング前提なので、ファイル先頭部の prefetch だけで OK。
// - 同じ URL を二重に load しないよう Map で重複排除。
// - キャラ選択が変わったら旧キャラ BGM の load は中断 (audio を null 化)
//   するが、HTTP cache には残るので問題なし。
export function useAssetPreloader({
  selectedCharacterId,
}: UseAssetPreloaderOptions = {}) {
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

  // 選択中キャラの BGM (character.bgmTrack) を先読み。Issue #150 の主機能を維持
  // しつつ、Issue #79 の useBgm fallback 経路で再生されるパスを HTTP cache に
  // 載せておく。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedCharacterId) return;
    const track = getCharacterById(selectedCharacterId).bgmTrack;
    const url = Array.isArray(track) ? track[0] : track;
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
      // 例外は無視。実再生は対局画面で行う。
    }
  }, [selectedCharacterId]);
}
