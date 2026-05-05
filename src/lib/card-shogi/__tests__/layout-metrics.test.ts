import { describe, expect, it } from "vitest";

import {
  CARD_SHOGI_VIEWPORT_MATRIX,
  computeCardBoardSize,
  getShogiBoardOuterSize,
} from "../layout-metrics";

describe("card-shogi layout metrics", () => {
  it.each(CARD_SHOGI_VIEWPORT_MATRIX)("fits the central board stack in $name", (viewport) => {
    const result = computeCardBoardSize({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    });

    expect(result.requiredWidth).toBeLessThanOrEqual(result.availableWidth);
    expect(result.requiredHeight).toBeLessThanOrEqual(result.availableHeight);
    expect(result.squareSize).toBeGreaterThanOrEqual(26);
    expect(result.squareSize).toBeLessThanOrEqual(64);
  });

  it("accounts for grid gaps, border, labels, and the desktop left spacer", () => {
    const mobile = getShogiBoardOuterSize(32, "mobile");
    const desktop = getShogiBoardOuterSize(32, "largeDesktop");

    expect(mobile.gridWidth).toBe(32 * 9 + 8 + 2);
    expect(mobile.width).toBeCloseTo(mobile.gridWidth + 2 + mobile.labelSize);
    expect(desktop.width).toBeCloseTo(desktop.gridWidth + desktop.labelSize * 2 + 8);
  });

  it("uses the emergency floor only for genuinely tight viewports", () => {
    const roomy = computeCardBoardSize({ viewportWidth: 390, viewportHeight: 844 });
    const tight = computeCardBoardSize({
      viewportWidth: 320,
      viewportHeight: 420,
      availableWidth: 300,
      availableHeight: 320,
    });

    expect(roomy.usedEmergencyFloor).toBe(false);
    expect(tight.squareSize).toBeLessThan(32);
    expect(tight.usedEmergencyFloor).toBe(true);
  });
});
