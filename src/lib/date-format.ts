const JAPAN_TIME_ZONE = "Asia/Tokyo";

const historyDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JAPAN_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatHistoryDateTime(value: Date | string | number): string {
  return historyDateTimeFormatter.format(new Date(value));
}
