import { describe, expect, it } from "vitest";

import {
  AUDIO_MANIFEST,
  BGM_FILES,
  SFX_FILES,
  SFX_URLS,
  SOUND_POOL,
} from "../manifest";

// AUDIO_MANIFEST の整合性は実行時にも UI 表示にも影響する。
// 不整合があると、(1) preload で 404、(2) dev tool で割り当て不能、
// (3) playSfx 内 if(!src) ガードに頼る無音動作、になるため testで担保する。

describe("AUDIO_MANIFEST integrity", () => {
  it("SFX_URLS は SFX_FILES の値 (空文字除外) と一致する", () => {
    const expected = Array.from(
      new Set(Object.values(SFX_FILES).filter(Boolean)),
    );
    expect(Array.from(SFX_URLS).sort()).toEqual(expected.sort());
  });

  it("SFX_URLS には空文字を含まない (404 防止)", () => {
    expect(SFX_URLS.includes("")).toBe(false);
  });

  it("SFX_FILES の全ての非空 path は SOUND_POOL に含まれる", () => {
    const pool = new Set(SOUND_POOL);
    for (const [key, path] of Object.entries(SFX_FILES)) {
      if (!path) continue;
      expect(pool.has(path), `SFX_FILES.${key} = ${path} not in SOUND_POOL`).toBe(true);
    }
  });

  it("BGM_FILES の全ての非空 path は SOUND_POOL に含まれる", () => {
    const pool = new Set(SOUND_POOL);
    for (const [key, path] of Object.entries(BGM_FILES)) {
      if (!path) continue;
      expect(pool.has(path), `BGM_FILES.${key} = ${path} not in SOUND_POOL`).toBe(true);
    }
  });

  it("SOUND_POOL は重複しない", () => {
    expect(new Set(SOUND_POOL).size).toBe(SOUND_POOL.length);
  });

  it("AUDIO_MANIFEST.poolUrls は SOUND_POOL と同一参照", () => {
    expect(AUDIO_MANIFEST.poolUrls).toBe(SOUND_POOL);
  });

  it("AUDIO_MANIFEST.sfxUrls は SFX_URLS と同一参照", () => {
    expect(AUDIO_MANIFEST.sfxUrls).toBe(SFX_URLS);
  });
});
