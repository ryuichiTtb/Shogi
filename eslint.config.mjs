import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Issue #235 S2d: L1 CardSpec registry の serialize 境界強制。
  // 関数を持つサーバ専用 registry (`card-spec-server`) を Client コンポーネント (`src/components/**`)
  // が import すると、(a) 関数バンドルの Client 流入、(b) CardSpec を props/RSC 境界で serialize しようと
  // して実行時エラー、のリスクがある。コンポーネントは meta-only の client-safe な `card-spec.ts` を使うこと。
  // 注: hooks (reducer 等) は world-kernel 経由で効果適用に registry を必要とするため対象外 (Client で実行
  // されるが props serialize は伴わない)。本ルールは現状違反ゼロの予防的ガード。
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/shogi/cards/card-spec-server",
                "**/cards/card-spec-server",
              ],
              message:
                "Client コンポーネントは card-spec-server (関数入り registry) を import 禁止。card 情報は meta-only の card-spec.ts を使用 (Issue #235 S2d serialize 境界)。",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
