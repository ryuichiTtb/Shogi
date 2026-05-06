import { describe, expect, it } from "vitest";

import { formatHistoryDateTime } from "@/lib/date-format";

describe("formatHistoryDateTime", () => {
  it("UTCの日時をJSTで表示する", () => {
    expect(formatHistoryDateTime("2026-01-01T00:05:00.000Z")).toBe("2026年1月1日 09:05");
  });

  it("Dateオブジェクトでも実行環境のタイムゾーンに依存しない", () => {
    expect(formatHistoryDateTime(new Date("2026-05-06T14:12:25.000Z"))).toBe(
      "2026年5月6日 23:12"
    );
  });
});
