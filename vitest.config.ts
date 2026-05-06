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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
  },
});
