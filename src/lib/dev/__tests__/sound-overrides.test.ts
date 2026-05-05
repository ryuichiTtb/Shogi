import { describe, expect, it } from "vitest";

import { SFX_FILES } from "@/lib/audio/manifest";
import {
  isAllowedSoundPath,
  parseStored,
  SFX_EVENT_KEYS,
  type SfxEventKey,
} from "../sound-overrides";

// parseStored は localStorage 改ざんに対する第一線の防御。
// 未知 key/未知 path をすり抜けると useSound 経由で「存在しないファイルへ
// fetch → 404 → 静寂」となり、最悪 path traversal の足場にもなる。
// このテストはそのバリデーションが機能していることを保証する。

describe("sound-overrides parseStored", () => {
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

  it("accepts all 12 keys with all valid paths", () => {
    const allValid: Record<SfxEventKey, string> = {
      piece_move: "/sounds/jump.mp3",
      piece_jump: "/sounds/piece-move.mp3",
      piece_capture: "/sounds/check.mp3",
      piece_promote: "/sounds/piece-drop.mp3",
      piece_drop: "/sounds/piece-promote.mp3",
      check: "/sounds/piece-capture.mp3",
      game_over: "/sounds/game-start.mp3",
      game_start: "/sounds/game-over.mp3",
      card_draw: "/sounds/jump.mp3",
      card_play: "/sounds/check.mp3",
      mana_charge: "/sounds/piece-move.mp3",
      trap_trigger: "/sounds/piece-promote.mp3",
    };
    expect(parseStored(JSON.stringify(allValid))).toEqual(allValid);
  });
});

describe("isAllowedSoundPath", () => {
  it("accepts all paths defined in SFX_FILES", () => {
    for (const key of SFX_EVENT_KEYS) {
      expect(isAllowedSoundPath(SFX_FILES[key])).toBe(true);
    }
  });

  it("rejects unknown paths", () => {
    expect(isAllowedSoundPath("/sounds/nonexistent.mp3")).toBe(false);
    expect(isAllowedSoundPath("/etc/passwd")).toBe(false);
    expect(isAllowedSoundPath("")).toBe(false);
    expect(isAllowedSoundPath("https://evil.com/x.mp3")).toBe(false);
  });
});
