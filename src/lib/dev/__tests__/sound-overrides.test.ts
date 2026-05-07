import { describe, expect, it } from "vitest";

import { SFX_FILES } from "@/lib/audio/manifest";
import {
  isAllowedSoundPath,
  parseBgmStored,
  parseStored,
  SFX_EVENT_KEYS,
  BGM_EVENT_KEYS,
  type SfxEventKey,
  type BgmEventKey,
} from "../sound-overrides";

// parseStored は localStorage 改ざんに対する第一線の防御。
// 未知 key/未知 path をすり抜けると useSound 経由で「存在しないファイルへ
// fetch → 404 → 静寂」となり、最悪 path traversal の足場にもなる。
// このテストはそのバリデーションが機能していることを保証する。

describe("sound-overrides parseStored (SFX)", () => {
  it("returns empty for null", () => {
    expect(parseStored(null)).toEqual({});
  });

  it("returns empty for invalid JSON", () => {
    expect(parseStored("not json")).toEqual({});
  });

  it("returns empty for non-object JSON (string)", () => {
    expect(parseStored('"hello"')).toEqual({});
  });

  it("returns empty for non-object JSON (array)", () => {
    expect(parseStored("[1,2,3]")).toEqual({});
  });

  it("returns empty for null JSON value", () => {
    expect(parseStored("null")).toEqual({});
  });

  it("drops unknown event keys but keeps valid ones", () => {
    const validPath = SFX_FILES.piece_move;
    const input = JSON.stringify({
      piece_move: validPath,
      bogus_event: validPath,
    });
    expect(parseStored(input)).toEqual({ piece_move: validPath });
  });

  it("drops paths not in whitelist (path traversal defense)", () => {
    const validPath = SFX_FILES.piece_move;
    const input = JSON.stringify({
      piece_move: "/etc/passwd",
      piece_jump: validPath,
      piece_capture: "../../secrets.txt",
    });
    expect(parseStored(input)).toEqual({ piece_jump: validPath });
  });

  it("drops non-string values", () => {
    const input = JSON.stringify({
      piece_move: 42,
      piece_jump: null,
      piece_capture: { foo: "bar" },
    });
    expect(parseStored(input)).toEqual({});
  });

  it("accepts all SFX keys with valid pool paths", () => {
    const allValid: Record<SfxEventKey, string> = {
      piece_move: "/sounds/jump.mp3",
      piece_jump: "/sounds/piece-move.mp3",
      piece_capture: "/sounds/check.mp3",
      piece_promote: "/sounds/piece-drop.mp3",
      piece_drop: "/sounds/piece-promote.mp3",
      piece_flight: "/sounds/jump.mp3",
      check: "/sounds/piece-capture.mp3",
      checkmate: "/sounds/check.mp3",
      game_over: "/sounds/game-start.mp3",
      game_start: "/sounds/game-over.mp3",
      card_draw: "/sounds/jump.mp3",
      card_auto_draw: "/sounds/piece-drop.mp3",
      card_play: "/sounds/check.mp3",
      mana_charge: "/sounds/piece-move.mp3",
      trap_trigger: "/sounds/piece-promote.mp3",
      trap_set: "/sounds/check.mp3",
      card_to_hand: "/sounds/piece-drop.mp3",
      draw_card_open_common: "/sounds/piece-move.mp3",
      draw_card_open_rare: "/sounds/jump.mp3",
      draw_card_open_super_rare: "/sounds/piece-promote.mp3",
      draw_card_open_epic: "/sounds/check.mp3",
    };
    expect(parseStored(JSON.stringify(allValid))).toEqual(allValid);
  });
});

describe("sound-overrides parseBgmStored", () => {
  it("returns empty for null", () => {
    expect(parseBgmStored(null)).toEqual({});
  });

  it("drops unknown bgm keys", () => {
    const input = JSON.stringify({
      bgm_home: "/sounds/check.mp3", // valid path、unknown sfx event ではないので OK
      bogus_bgm: "/sounds/check.mp3",
    });
    expect(parseBgmStored(input)).toEqual({ bgm_home: "/sounds/check.mp3" });
  });

  it("drops paths not in pool", () => {
    const input = JSON.stringify({
      bgm_home: "/etc/passwd",
      bgm_game: "/sounds/check.mp3",
    });
    expect(parseBgmStored(input)).toEqual({ bgm_game: "/sounds/check.mp3" });
  });

  it("accepts all 4 BGM keys", () => {
    const allValid: Record<BgmEventKey, string> = {
      bgm_home: "/sounds/check.mp3",
      bgm_match_setup: "/sounds/jump.mp3",
      bgm_game: "/sounds/game-start.mp3",
      bgm_game_over: "/sounds/game-over.mp3",
    };
    expect(parseBgmStored(JSON.stringify(allValid))).toEqual(allValid);
  });
});

describe("isAllowedSoundPath", () => {
  it("accepts all non-empty paths defined in SFX_FILES", () => {
    for (const key of SFX_EVENT_KEYS) {
      const path = SFX_FILES[key];
      if (!path) continue; // 空文字 (未割当) は skip
      expect(isAllowedSoundPath(path)).toBe(true);
    }
  });

  it("rejects unknown paths", () => {
    expect(isAllowedSoundPath("/sounds/nonexistent.mp3")).toBe(false);
    expect(isAllowedSoundPath("/etc/passwd")).toBe(false);
    expect(isAllowedSoundPath("")).toBe(false);
    expect(isAllowedSoundPath("https://evil.com/x.mp3")).toBe(false);
  });
});

describe("SFX_EVENT_KEYS / BGM_EVENT_KEYS integrity", () => {
  it("has 21 SFX events (18 base + checkmate + piece_flight + card_auto_draw)", () => {
    expect(SFX_EVENT_KEYS.length).toBe(21);
  });

  it("has 4 BGM events", () => {
    expect(BGM_EVENT_KEYS.length).toBe(4);
  });

  it("SFX/BGM event sets are disjoint", () => {
    const sfxSet = new Set<string>(SFX_EVENT_KEYS);
    for (const k of BGM_EVENT_KEYS) {
      expect(sfxSet.has(k)).toBe(false);
    }
  });
});
