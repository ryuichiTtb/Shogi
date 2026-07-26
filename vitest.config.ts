import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Issue #150: server-only は Client Component 経由 import を防ぐためのガード。
      // vitest 環境では Server Component と Client Component の区別がないため、
      // テスト時のみ no-op に置き換える。
      "server-only": path.resolve(__dirname, "./src/test-helpers/server-only-shim.ts"),
    },
  },
  test: {
    environment: "jsdom",
    // Issue #245 教材多様化 段1: scripts/ 配下にも純粋ロジック (ラベルの同一性キー・レシピ正規化) が
    // ある。そこが壊れると数十時間かけたラベル付けを取りこぼす / 別レシピの成果を混ぜるため、
    // テストを収集対象に含める (scripts をそのまま実行するわけではなく *.test.ts のみ)。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    globals: true,
  },
});
